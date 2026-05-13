"""
Unit + integration tests for the chat pipeline.

Runs with the stdlib `unittest` runner (no pytest required):

    python -m unittest discover -s server/tests -v

The tests cover:
  - `groundedness.check`: catches hallucinated numbers and ignores structural
    ones (years, list indexes, rounded values).
  - `query_handler.classify_query`: greetings, rankings, comparisons,
    correlations, follow-ups.
  - `query_handler.compute_*`: ranking + correlation + feature_stats produce
    well-shaped dicts on a tiny synthetic dataset.
  - `/api/chat` end-to-end with a mocked LLMClient (no network).
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure `server/` is importable when this file is run as `python -m unittest`
# from the project root.
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "server"))

import numpy as np
import pandas as pd

import groundedness  # noqa: E402
import llm_client  # noqa: E402
import query_handler  # noqa: E402
import drug_knowledge  # noqa: E402
import chat_extras  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# Synthetic dataset (small, deterministic)
# ─────────────────────────────────────────────────────────────────────────────


def _seed_query_handler() -> None:
    """Populate `query_handler` globals with a tiny synthetic dataset that
    exercises every compute_* path without touching disk."""
    n = 60
    rng = np.random.default_rng(0)
    drugs = (["DMSO"] * 20) + (["Rotenone"] * 20) + (["CCCP"] * 20)
    df = pd.DataFrame(
        {
            "Fragment Length": np.concatenate(
                [
                    rng.normal(3.0, 0.4, 20),  # DMSO
                    rng.normal(2.0, 0.4, 20),  # Rotenone (lower)
                    rng.normal(2.5, 0.4, 20),  # CCCP
                ]
            ),
            "Segment Length": np.concatenate(
                [
                    rng.normal(1.0, 0.05, 20),
                    rng.normal(0.95, 0.05, 20),
                    rng.normal(0.98, 0.05, 20),
                ]
            ),
            "Fragment Diffusivity": np.concatenate(
                [
                    rng.normal(0.001, 0.0002, 20),
                    rng.normal(0.0008, 0.0002, 20),
                    rng.normal(0.0009, 0.0002, 20),
                ]
            ),
            "TMRM Intensity": np.concatenate(
                [
                    rng.normal(80.0, 10.0, 20),
                    rng.normal(50.0, 10.0, 20),
                    rng.normal(40.0, 10.0, 20),
                ]
            ),
        }
    )
    meta = pd.DataFrame(
        {
            "id": [f"p{i}" for i in range(n)],
            "drug": drugs,
            "dose": "10 nM",
            "time": "1h",
            "phenotype": drugs,
        }
    )
    query_handler.feature_table = df
    query_handler.sample_metadata = meta
    query_handler._DATASETS["v3"] = query_handler.ChatDataset(
        version="v3", feature_table=df, sample_metadata=meta
    )


# ─────────────────────────────────────────────────────────────────────────────
# Groundedness
# ─────────────────────────────────────────────────────────────────────────────


class TestGroundedness(unittest.TestCase):
    def test_exact_match_is_grounded(self):
        stats = {"feature": "TMRM", "mean": 0.123, "std": 0.045, "n": 200}
        ok, _ = groundedness.check("Mean is 0.123 with std 0.045 (n=200).", stats)
        self.assertTrue(ok)

    def test_rounded_match_is_grounded(self):
        stats = {"correlation": 0.7321}
        ok, _ = groundedness.check("The correlation r=0.73 is strong.", stats)
        self.assertTrue(ok)

    def test_structural_numbers_are_allowed(self):
        stats = {"correlation": 0.5}
        ok, _ = groundedness.check(
            "Listing top 5 drugs over 100 samples in the 2025 dataset; r=0.5.",
            stats,
        )
        self.assertTrue(ok)

    def test_hallucinated_number_is_flagged(self):
        stats = {"correlation": 0.5, "n_samples": 200}
        ok, bad = groundedness.check("Correlation is r=0.92 (n=200).", stats)
        self.assertFalse(ok)
        self.assertIn(0.92, bad)

    def test_nested_stats_match(self):
        stats = {"rankings": [{"drug": "Rotenone", "mean": 0.005, "std": 0.001}]}
        ok, _ = groundedness.check("Rotenone mean was 0.005 (std 0.001).", stats)
        self.assertTrue(ok)

    def test_unicode_minus_is_grounded(self):
        # LLMs (esp. Claude) prefer the typographic minus U+2212.
        stats = {"correlation": -0.106, "n_samples": 34718}
        ok, _ = groundedness.check(
            "Pearson r = \u22120.106 across n = 34,718 cells.",  # incl. comma separator
            stats,
        )
        self.assertTrue(ok)

    def test_en_dash_minus_is_grounded(self):
        stats = {"delta": -2.5}
        ok, _ = groundedness.check("The change was \u20132.5 units.", stats)
        self.assertTrue(ok)

    def test_thousands_separator_is_grounded(self):
        stats = {"n": 1234567}
        ok, _ = groundedness.check("Across 1,234,567 cells we saw...", stats)
        self.assertTrue(ok)

    def test_derived_ratio_is_grounded(self):
        # 427.6 / 114.2 ≈ 3.7 — Claude writes "3.7× higher" as legitimate color.
        stats = {"a": 427.6, "b": 114.2}
        ok, _ = groundedness.check("Roughly 3.7× higher than DMSO (114.2).", stats)
        self.assertTrue(ok)

    def test_derived_percent_change_is_grounded(self):
        # (3.72 - 2.81) / 2.81 * 100 ≈ 32.4 — "32% longer" should pass.
        stats = {"rot": 3.72, "cccp": 2.81}
        ok, _ = groundedness.check(
            "Rotenone fragments are ~32% longer than CCCP (3.72 vs 2.81).",
            stats,
        )
        self.assertTrue(ok)

    def test_confidence_level_label_is_grounded(self):
        # "95% CI" is structural — 95 shouldn't be flagged even if absent from stats.
        stats = {"correlation": -0.21, "ci95_low": -0.22, "ci95_high": -0.19}
        ok, _ = groundedness.check(
            "Pearson r = -0.21 (95% CI: -0.22 to -0.19, p < 0.001).",
            stats,
        )
        self.assertTrue(ok)

    def test_effect_size_thresholds_are_grounded(self):
        # Cohen's d ≥ 0.8 = large. These threshold numbers shouldn't be flagged.
        stats = {"cohens_d": 1.2}
        ok, _ = groundedness.check(
            "Cohen's d = 1.2 (above the 0.8 threshold for a large effect).",
            stats,
        )
        self.assertTrue(ok)

    def test_r_squared_is_grounded(self):
        # r² = "% variance explained" is a natural scientific addendum.
        # r=-0.205 → r²=0.042 → 4.2% variance. All three should pass.
        stats = {"correlation": -0.205, "n": 34718}
        ok, _ = groundedness.check(
            "Pearson r = -0.205, explaining about 4.2% of the variance (r² = 0.042).",
            stats,
        )
        self.assertTrue(ok)

    def test_absolute_value_is_grounded(self):
        # "|d| = 1.4" when stats has d = -1.4 should be allowed.
        stats = {"cohens_d": -1.4}
        ok, _ = groundedness.check("|d| = 1.4 indicates a large effect.", stats)
        self.assertTrue(ok)

    def test_pure_hallucination_still_rejected(self):
        # Even with derived allowed, a fully fabricated value should fail.
        stats = {"a": 1.0, "b": 2.0, "c": 3.0}
        ok, bad = groundedness.check("The headline figure was 9876.5.", stats)
        self.assertFalse(ok)
        self.assertIn(9876.5, bad)

    def test_paranoid_mode_rejects_derived(self):
        # Same input as the ratio test, but with allow_derived=False.
        stats = {"a": 427.6, "b": 114.2}
        ok, bad = groundedness.check(
            "Roughly 3.7× higher than DMSO (114.2).",
            stats,
            allow_derived=False,
        )
        self.assertFalse(ok)
        self.assertIn(3.7, bad)


# ─────────────────────────────────────────────────────────────────────────────
# Classifier
# ─────────────────────────────────────────────────────────────────────────────


class TestClassifier(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _seed_query_handler()

    def test_greeting(self):
        self.assertEqual(query_handler.classify_query("hi there")["type"], "greeting")
        self.assertEqual(query_handler.classify_query("Hello!")["type"], "greeting")

    def test_help(self):
        self.assertEqual(query_handler.classify_query("what can you do?")["type"], "help")

    def test_dataset_overview(self):
        self.assertEqual(
            query_handler.classify_query("what features are available?")["type"],
            "dataset_overview",
        )

    def test_ranking_high(self):
        out = query_handler.classify_query("which drugs increase motility the most?")
        self.assertEqual(out["type"], "ranking")
        self.assertEqual(out["params"]["direction"], "high")
        self.assertEqual(out["params"]["feature"], "Fragment Diffusivity")

    def test_ranking_low(self):
        out = query_handler.classify_query("which drugs decrease membrane potential?")
        self.assertEqual(out["type"], "ranking")
        self.assertEqual(out["params"]["direction"], "low")

    def test_comparison_explicit(self):
        out = query_handler.classify_query("compare Rotenone and CCCP")
        self.assertEqual(out["type"], "drug_comparison")
        self.assertEqual(sorted(out["params"]["drugs"]), ["CCCP", "Rotenone"])

    def test_correlation_two_features(self):
        out = query_handler.classify_query(
            "is fragment length correlated with motility?"
        )
        self.assertEqual(out["type"], "correlation")
        self.assertEqual(len(out["params"]["features"]), 2)

    def test_similarity_with_adverb(self):
        # Regex should catch "look most like", "looks a lot like".
        for q in (
            "what drugs look most like Rotenone?",
            "drugs that looks a lot like CCCP",
            "find compounds that look very much like DMSO",
        ):
            out = query_handler.classify_query(q)
            self.assertEqual(out["type"], "drug_similarity", f"Failed for: {q!r}")

    def test_clarification_routes_with_prior_context(self):
        ctx = {
            "last_query_type": "ranking",
            "last_feature": "Fragment Diffusivity",
            "last_drugs": [],
            "last_user_message": "which drugs increase motility?",
        }
        for q in (
            "are you sure?",
            "is that correct?",
            "double-check those numbers",
            "doesn't look right",
            "why?",
            "explain that",
            "are you certain these are accurate",
            "are these correct",
        ):
            out = query_handler.classify_query(q, context=ctx)
            self.assertEqual(
                out["type"], "clarification",
                f"Expected clarification for {q!r}, got {out['type']}",
            )

    def test_clarification_without_prior_falls_through(self):
        # No prior turn → don't hijack a question that might be standalone.
        out = query_handler.classify_query("are you sure?", context=None)
        self.assertNotEqual(out["type"], "clarification")
        out = query_handler.classify_query("are you sure?", context={"last_user_message": None})
        self.assertNotEqual(out["type"], "clarification")

    def test_context_extractor_skips_meta_messages(self):
        # A chain of clarifications should still point back at the original Q.
        import main  # noqa: E402
        from main import HistoryMessage  # noqa: E402

        history = [
            HistoryMessage(role="user", content="Which drugs increase motility?"),
            HistoryMessage(role="assistant", content="Top drugs ranked..."),
            HistoryMessage(role="user", content="are you sure these are correct?"),
            HistoryMessage(role="assistant", content="Yes, deterministic."),
            HistoryMessage(role="user", content="doesn't look right"),
            HistoryMessage(role="assistant", content="Let me elaborate."),
        ]
        ctx = main._extract_context_from_history(history)
        self.assertEqual(ctx["last_user_message"], "Which drugs increase motility?")

    def test_clarification_routes_with_prior_user_message_only(self):
        # Frontend may not echo query_type back; last_user_message is enough.
        ctx = {
            "last_query_type": None,
            "last_feature": None,
            "last_drugs": [],
            "last_user_message": "which drugs increase motility?",
        }
        out = query_handler.classify_query("are you sure?", context=ctx)
        self.assertEqual(out["type"], "clarification")

    def test_compute_clarification_recovers_ranking(self):
        out = query_handler.compute_clarification("which drugs increase motility?")
        self.assertTrue(out["prior_recoverable"])
        self.assertEqual(out["prior_query_type"], "ranking")
        self.assertIn("rankings", out["prior_stats"])

    def test_compute_clarification_unrecoverable(self):
        out = query_handler.compute_clarification(None)
        self.assertFalse(out["prior_recoverable"])
        out = query_handler.compute_clarification("hello")
        self.assertFalse(out["prior_recoverable"])

    def test_differentiator_two_drugs(self):
        out = query_handler.classify_query("what differs most between Rotenone and CCCP?")
        self.assertEqual(out["type"], "top_differentiators")
        self.assertEqual({out["params"]["drug_a"], out["params"]["drug_b"]}, {"Rotenone", "CCCP"})

    def test_followup_uses_context(self):
        ctx = {
            "last_query_type": "ranking",
            "last_feature": "Fragment Diffusivity",
            "last_drugs": [],
            "last_user_message": "which drugs increase motility?",
        }
        out = query_handler.classify_query("what about for membrane potential?", context=ctx)
        self.assertEqual(out["type"], "ranking")
        self.assertEqual(out["params"]["feature"], "TMRM Intensity")


# ─────────────────────────────────────────────────────────────────────────────
# Compute helpers
# ─────────────────────────────────────────────────────────────────────────────


class TestComputeStatistics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _seed_query_handler()

    def test_ranking_orders_correctly(self):
        out = query_handler.compute_ranking("Fragment Length", direction="high", top_n=3)
        self.assertEqual(out["feature"], "Fragment Length")
        means = [r["mean"] for r in out["rankings"]]
        self.assertEqual(means, sorted(means, reverse=True))

    def test_drug_comparison_has_both_drugs(self):
        out = query_handler.compute_drug_comparison(["Rotenone", "DMSO"])
        self.assertIn("Rotenone", out)
        # DMSO is normalised to "DMSO (control)" in the output.
        self.assertTrue(any("DMSO" in k for k in out.keys()))

    def test_correlation_shape(self):
        out = query_handler.compute_correlation("Fragment Length", "Fragment Diffusivity")
        self.assertIn("correlation", out)
        self.assertIn("interpretation", out)
        self.assertGreater(out["n_samples"], 0)

    def test_feature_stats_scoped_to_drug(self):
        out = query_handler.compute_feature_stats("TMRM Intensity", drug="Rotenone")
        self.assertEqual(out["feature"], "TMRM Intensity")
        self.assertIn("Rotenone", out["scope"])

    def test_ranking_has_cis_and_effects(self):
        out = query_handler.compute_ranking("Fragment Length", direction="high", top_n=3)
        for entry in out["rankings"]:
            self.assertIn("ci95_low", entry)
            self.assertIn("ci95_high", entry)
            # First-place entry has no `_vs_dmso` if it IS DMSO; otherwise must.
            if entry["drug"] != "DMSO (control)":
                self.assertIn("cohens_d_vs_dmso", entry)
                self.assertIn("effect_vs_dmso", entry)

    def test_drug_comparison_has_welch_inference(self):
        out = query_handler.compute_drug_comparison(["Rotenone", "DMSO"])
        self.assertIn("_inference", out)
        pair_key = next(iter(out["_inference"]))
        # We engineered Rotenone to have a smaller TMRM mean — Cohen's d should
        # be large and the verdict should be 'clearly_different'.
        cmp = out["_inference"][pair_key].get("TMRM Intensity") or {}
        self.assertIn(cmp.get("verdict"), ("clearly_different", "likely_different"))
        self.assertGreater(abs(cmp.get("cohens_d", 0.0)), 0.5)

    def test_correlation_has_ci_and_spearman(self):
        out = query_handler.compute_correlation("Fragment Length", "Fragment Diffusivity")
        for k in ("ci95_low", "ci95_high", "spearman", "p_value"):
            self.assertIn(k, out)

    def test_drug_similarity_returns_neighbours(self):
        out = query_handler.compute_drug_similarity("Rotenone", top_n=2)
        self.assertEqual(out["target_drug"], "Rotenone")
        self.assertEqual(len(out["neighbors"]), 2)
        for n in out["neighbors"]:
            self.assertGreaterEqual(n["distance"], 0)
            # `most_similar_on` and `most_different_on` must be disjoint sets.
            sim = set(n["most_similar_on"])
            dif = set(n["most_different_on"])
            self.assertEqual(sim & dif, set())

    def test_ranking_fallback_calls_out_dmso_in_top(self):
        # Import here so this test can read the fallback formatter directly.
        import main  # noqa: E402

        stats = {
            "feature": "Fragment Diffusivity",
            "direction": "high",
            "rankings": [
                {"drug": "myls22", "mean": 0.0011, "n": 1130, "ci95_low": 0.001, "ci95_high": 0.0012, "cohens_d_vs_dmso": 0.1, "effect_vs_dmso": "negligible"},
                {"drug": "oligomycin", "mean": 0.0011, "n": 1521, "ci95_low": 0.001, "ci95_high": 0.0012, "cohens_d_vs_dmso": 0.08, "effect_vs_dmso": "negligible", "indistinguishable_from_prev": True},
                {"drug": "cccp", "mean": 0.0011, "n": 1098, "ci95_low": 0.001, "ci95_high": 0.0012, "cohens_d_vs_dmso": 0.05, "effect_vs_dmso": "negligible", "indistinguishable_from_prev": True},
                {"drug": "mitomycinc", "mean": 0.0011, "n": 2449, "ci95_low": 0.001, "ci95_high": 0.0012, "cohens_d_vs_dmso": 0.05, "effect_vs_dmso": "negligible", "indistinguishable_from_prev": True},
                {"drug": "tiron", "mean": 0.0011, "n": 1427, "ci95_low": 0.001, "ci95_high": 0.0012, "cohens_d_vs_dmso": 0.04, "effect_vs_dmso": "negligible", "indistinguishable_from_prev": True},
                {"drug": "DMSO (control)", "mean": 0.001, "n": 1480, "ci95_low": 0.0009, "ci95_high": 0.0011},
            ],
        }
        text = main._fallback_answer("ranking", stats)
        # Headline must call out DMSO's position and 'barely separated'.
        self.assertIn("DMSO (control)", text)
        self.assertIn("position 6", text)
        # And mention that ranks are indistinguishable.
        self.assertIn("indistinguishable", text)

    def test_clarification_fallback_explains_provenance(self):
        import main  # noqa: E402

        text = main._fallback_answer("clarification", {
            "prior_recoverable": True,
            "prior_query_type": "ranking",
            "prior_question": "which drugs increase motility?",
        })
        self.assertIn("deterministic", text.lower())
        self.assertIn("ranking", text.lower())

    def test_top_differentiators_sorted_by_effect(self):
        out = query_handler.compute_top_differentiators("Rotenone", "DMSO", top_n=5)
        ds = [abs(r["cohens_d"]) for r in out["top_differentiators"]]
        # Sorted descending by |d|.
        self.assertEqual(ds, sorted(ds, reverse=True))


# ─────────────────────────────────────────────────────────────────────────────
# Drug knowledge base
# ─────────────────────────────────────────────────────────────────────────────


class TestDrugKnowledge(unittest.TestCase):
    def test_known_drug_lookup(self):
        self.assertIsNotNone(drug_knowledge.get("rotenone"))
        self.assertIsNotNone(drug_knowledge.get("ROTENONE"))
        self.assertIsNotNone(drug_knowledge.get("  Rotenone  "))
        self.assertIn("Complex I", drug_knowledge.get("rotenone").pharm_class)

    def test_aliases_resolve_to_control(self):
        for alias in ("DMSO", "ctrl", "vehicle", "untreated"):
            f = drug_knowledge.get(alias)
            self.assertIsNotNone(f, f"Alias {alias!r} should resolve")
            self.assertEqual(f.display_name, "DMSO (vehicle control)")

    def test_unknown_drug_returns_none(self):
        self.assertIsNone(drug_knowledge.get("madeupcompound42"))
        self.assertIsNone(drug_knowledge.get(""))
        self.assertIsNone(drug_knowledge.get(None))

    def test_context_block_dedupes_and_skips_unknowns(self):
        block = drug_knowledge.context_block(["rotenone", "ROTENONE", "unknown", "cccp"])
        self.assertIsNotNone(block)
        # Each known drug appears exactly once.
        self.assertEqual(block.count("Rotenone — "), 1)
        self.assertEqual(block.count("CCCP — "), 1)

    def test_context_block_empty_when_nothing_recognised(self):
        self.assertIsNone(drug_knowledge.context_block(["unknown1", "unknown2"]))


# ─────────────────────────────────────────────────────────────────────────────
# Suggested follow-ups + response cache
# ─────────────────────────────────────────────────────────────────────────────


class TestSuggestedFollowups(unittest.TestCase):
    def test_ranking_suggests_opposite_direction(self):
        out = chat_extras.suggested_followups(
            query_type="ranking",
            params={"feature": "motility", "direction": "high"},
            stats={"rankings": [{"drug": "Nigericin"}]},
        )
        self.assertTrue(any("decrease" in s.lower() for s in out))
        self.assertTrue(any("nigericin" in s.lower() for s in out))

    def test_similarity_suggests_compare(self):
        out = chat_extras.suggested_followups(
            query_type="drug_similarity",
            stats={"target_drug": "Rotenone", "neighbors": [{"drug": "Antimycin A"}]},
        )
        self.assertTrue(any("compare" in s.lower() for s in out))

    def test_dedupes_against_history(self):
        # Suggestion identical to a past user message must be filtered.
        out = chat_extras.suggested_followups(
            query_type="ranking",
            params={"feature": "motility", "direction": "high"},
            stats={"rankings": [{"drug": "Nigericin"}]},
            recent_user_messages=["Which drugs decrease motility?"],
        )
        self.assertFalse(any("decrease motility" in s.lower() for s in out))

    def test_max_three_suggestions(self):
        out = chat_extras.suggested_followups(
            query_type="drug_comparison",
            params={"drugs": ["Rotenone", "CCCP"]},
            stats={},
        )
        self.assertLessEqual(len(out), 3)


class TestResponseCache(unittest.TestCase):
    def test_hit_after_put(self):
        cache = chat_extras.ResponseCache(capacity=4, ttl_seconds=60)
        cache.put(message="hello", history=[], version="v3", model="m", response={"a": 1})
        got = cache.get(message="hello", history=[], version="v3", model="m")
        self.assertEqual(got, {"a": 1})
        stats = cache.stats()
        self.assertEqual(stats["hits"], 1)

    def test_miss_on_different_version(self):
        cache = chat_extras.ResponseCache()
        cache.put(message="x", history=[], version="v3", model="m", response={"a": 1})
        got = cache.get(message="x", history=[], version="v1", model="m")
        self.assertIsNone(got)

    def test_lru_eviction(self):
        cache = chat_extras.ResponseCache(capacity=2)
        cache.put(message="a", history=[], version="v3", model="m", response="A")
        cache.put(message="b", history=[], version="v3", model="m", response="B")
        cache.put(message="c", history=[], version="v3", model="m", response="C")
        # 'a' should have been evicted (oldest).
        self.assertIsNone(cache.get(message="a", history=[], version="v3", model="m"))
        self.assertIsNotNone(cache.get(message="b", history=[], version="v3", model="m"))
        self.assertIsNotNone(cache.get(message="c", history=[], version="v3", model="m"))


# ─────────────────────────────────────────────────────────────────────────────
# /api/chat end-to-end with mocked LLM
# ─────────────────────────────────────────────────────────────────────────────


class TestChatEndpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient  # local import: test-only dep

        os.environ["OPENROUTER_API_KEY"] = "sk-test-dummy"
        _seed_query_handler()

        import main  # noqa: E402

        # Force LLM to be "available" with a controllable fake.
        cls.fake_llm = MagicMock()
        cls.fake_llm.model = "test/model"
        llm_client._llm_client = cls.fake_llm

        cls.client = TestClient(main.app)
        cls.main = main

    def setUp(self):
        # Clear all per-test state so tests are independent of each other.
        chat_extras.chat_response_cache._store.clear()
        chat_extras.chat_response_cache.hits = 0
        chat_extras.chat_response_cache.misses = 0
        self.fake_llm.reset_mock()

        # Default: LLM returns a perfectly grounded answer for ranking.
        def _default(**kwargs):
            telemetry = llm_client.LLMTelemetry(request_id="t", model="test/model")
            telemetry.success = True
            return ("Top drugs ranked.", telemetry)

        self.fake_llm.generate.side_effect = _default

    def test_greeting_short_circuit(self):
        r = self.client.post("/api/chat", json={"message": "hello"})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["query_type"], "greeting")
        self.assertEqual(body["source"], "fallback")
        self.fake_llm.generate.assert_not_called()

    def test_ranking_calls_llm_and_grounded(self):
        r = self.client.post(
            "/api/chat",
            json={"message": "which drugs increase motility the most?"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["query_type"], "ranking")
        self.assertTrue(self.fake_llm.generate.called)
        self.assertIn(body["source"], ("llm", "fallback"))

    def test_ungrounded_response_falls_back(self):
        def _bad(**kwargs):
            telemetry = llm_client.LLMTelemetry(request_id="t", model="test/model")
            telemetry.success = True
            # 8675309.1234 — Jenny's number with extra decimals so it can't
            # possibly arise from any pairwise ratio/diff/percent of the
            # ranking stats (which contain small means and small counts).
            return ("The headline statistic is 8675309.1234.", telemetry)

        self.fake_llm.generate.side_effect = _bad
        r = self.client.post(
            "/api/chat",
            json={"message": "which drugs increase motility?"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["source"], "fallback")
        self.assertTrue(body["grounded"])

    def test_llm_failure_falls_back(self):
        def _fail(**kwargs):
            telemetry = llm_client.LLMTelemetry(request_id="t", model="test/model")
            telemetry.success = False
            return (None, telemetry)

        self.fake_llm.generate.side_effect = _fail
        r = self.client.post(
            "/api/chat",
            json={"message": "compare Rotenone and CCCP"},
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["source"], "fallback")

    def test_request_validation_rejects_empty(self):
        r = self.client.post("/api/chat", json={"message": "   "})
        # FastAPI returns 422 for the empty string after pydantic min_length=1
        # for blank we strip later, so accept either 200 (treated as unsupported)
        # or 422 — but never a 500.
        self.assertIn(r.status_code, (200, 422))

    def test_response_carries_suggestions(self):
        r = self.client.post(
            "/api/chat",
            json={"message": "which drugs increase motility?"},
        )
        body = r.json()
        # Suggestions are rule-based, so a ranking response must produce some.
        self.assertIsInstance(body.get("suggestions"), list)
        self.assertGreaterEqual(len(body["suggestions"]), 1)

    def test_cache_hit_on_repeat_question(self):
        # Reset cache and force LLM to return a stable grounded answer.
        chat_extras.chat_response_cache._store.clear()

        def _grounded(**kwargs):
            telemetry = llm_client.LLMTelemetry(request_id="t", model="test/model")
            telemetry.success = True
            return ("OK answer.", telemetry)

        self.fake_llm.generate.side_effect = _grounded
        question = {"message": "which drugs increase motility the most?"}
        r1 = self.client.post("/api/chat", json=question).json()
        # First hit calls the LLM.
        first_calls = self.fake_llm.generate.call_count
        r2 = self.client.post("/api/chat", json=question).json()
        # Second identical question must be cached and NOT call the LLM again.
        self.assertEqual(self.fake_llm.generate.call_count, first_calls)
        self.assertTrue(r2.get("cached"))
        self.assertEqual(r1["answer"], r2["answer"])

    def test_drug_similarity_query_routes(self):
        r = self.client.post(
            "/api/chat",
            json={"message": "what drugs look like rotenone?"},
        )
        body = r.json()
        self.assertEqual(body["query_type"], "drug_similarity")

    def test_top_differentiator_query_routes(self):
        r = self.client.post(
            "/api/chat",
            json={"message": "what differs most between Rotenone and CCCP?"},
        )
        body = r.json()
        self.assertEqual(body["query_type"], "top_differentiators")


if __name__ == "__main__":
    unittest.main()
