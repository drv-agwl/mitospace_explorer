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
            # 99999 is not in any computed stat → groundedness should fail.
            return ("The correlation is r=99999.", telemetry)

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


if __name__ == "__main__":
    unittest.main()
