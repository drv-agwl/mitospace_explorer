"""
Tool registry for the MitoSpace chat agent.

We expose the deterministic compute functions (the same ones the old classifier
called) as OpenAI-style function-calling tools. The LLM picks which tools to
call, in what order, with what arguments — there is no keyword classifier in
the critical path. Tool RESULTS are deterministic; the LLM only narrates them.

Why tools rather than templates
-------------------------------
The previous architecture was a fixed pipeline:

    classify_query()  →  compute_*()  →  llm.narrate()

This worked for the ~10 phrasings we hand-coded, but it sounded like a 10-
template chatbot. Identical question → identical cached answer. Novel phrasing
→ "unsupported".

With tools, the LLM understands the *intent* (in any phrasing), composes
zero or more tool calls, and writes a fresh narration each time. The
compute functions stay exactly as deterministic as before, so the
groundedness guarantee is preserved.

Adding a new capability is just: add a function + a schema entry below. No
classifier work, no new templates.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, List, Optional

try:
    from . import query_handler
    from . import drug_knowledge
except ImportError:  # absolute imports when running from server/
    import query_handler  # type: ignore
    import drug_knowledge  # type: ignore


logger = logging.getLogger("mitospace.agent_tools")


# ─────────────────────────────────────────────────────────────────────────────
# Tool schemas (OpenAI / OpenRouter function-calling format)
# ─────────────────────────────────────────────────────────────────────────────


TOOL_SCHEMAS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "rank_drugs_by_feature",
            "description": (
                "Rank drugs by the mean value of a numeric feature across all "
                "cells in each drug condition. Returns top/bottom N drugs with "
                "mean, 95% CI, Cohen's d vs DMSO, and flags adjacent ranks "
                "whose CIs overlap as statistically indistinguishable. "
                "USE WHEN the user asks 'which drugs have the highest/lowest X?', "
                "'rank by X', 'what drug increases/decreases X most?'. "
                "DIRECTION HINT: in biology, 'depolarize' / 'collapse Δψm' / "
                "'lose membrane potential' means LOW TMRM Intensity; "
                "'hyperpolarize' means HIGH TMRM Intensity. "
                "'Increase motility' is HIGH Fragment Diffusivity."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "feature": {
                        "type": "string",
                        "description": (
                            "Feature name (human-friendly accepted: 'motility', "
                            "'membrane potential', 'fragment length', etc.). "
                            "Call list_features() first if unsure."
                        ),
                    },
                    "direction": {
                        "type": "string",
                        "enum": ["high", "low"],
                        "description": "'high' = top by mean (default); 'low' = bottom by mean.",
                    },
                    "top_n": {
                        "type": "integer",
                        "default": 10,
                        "description": "How many drugs to return (default 10, max 26).",
                    },
                },
                "required": ["feature"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_drugs",
            "description": (
                "Head-to-head comparison of 2+ drugs across all key features. "
                "For the 2-drug case, includes Welch's t-test p-values, Cohen's d, "
                "and a per-feature verdict (clearly_different / likely_different / "
                "indistinguishable). "
                "USE WHEN the user says 'compare X and Y', 'X vs Y', 'how does X "
                "differ from Y'. To compare a single drug to control, use "
                "drugs=['X', 'DMSO']."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "drugs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 2,
                        "maxItems": 5,
                        "description": (
                            "Drug names. 'DMSO' or 'control' refers to vehicle control."
                        ),
                    }
                },
                "required": ["drugs"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "correlate_features",
            "description": (
                "Pearson + Spearman correlation between two numeric features, "
                "across all cells (not grouped by drug). Returns r, 95% CI via "
                "Fisher z, p-value, and Spearman ρ. "
                "USE WHEN the user asks 'is X correlated with Y?', 'how do X and "
                "Y relate?'. Remember: with n>30000 cells, almost any correlation "
                "is statistically significant — what matters is magnitude (r² is "
                "the % of variance explained)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "feature1": {"type": "string"},
                    "feature2": {"type": "string"},
                },
                "required": ["feature1", "feature2"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "summarize_feature",
            "description": (
                "Distribution summary for a feature: mean, std, median, IQR, "
                "min/max, n. Optionally filter to a single drug. "
                "USE WHEN the user asks 'what's the average X?', 'what's the "
                "range of X for drug Y?', or wants to know the spread."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "feature": {"type": "string"},
                    "drug": {
                        "type": ["string", "null"],
                        "description": (
                            "Optional drug name to filter by. Omit / null for all cells."
                        ),
                    },
                },
                "required": ["feature"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_similar_drugs",
            "description": (
                "Find drugs whose mean phenotype (across the key features) is "
                "closest to a target drug. Distance is Euclidean in z-scored "
                "feature space. Returns neighbors with distance + which features "
                "drove agreement / disagreement. "
                "USE WHEN the user asks 'what drugs look like X?', 'phenocopy X', "
                "'similar to X', 'closest to X'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "drug": {"type": "string"},
                    "top_n": {"type": "integer", "default": 5},
                },
                "required": ["drug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_distinguishing_features",
            "description": (
                "Rank features by |Cohen's d| between two drugs — the features "
                "where the two drugs differ most strongly. "
                "USE WHEN the user asks 'what's different between X and Y?', "
                "'biggest difference between X and Y', 'which features "
                "distinguish X from Y'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "drug_a": {"type": "string"},
                    "drug_b": {"type": "string"},
                    "top_n": {"type": "integer", "default": 5},
                },
                "required": ["drug_a", "drug_b"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_drug_pharmacology",
            "description": (
                "Look up known mechanism, molecular target, pharmacological "
                "class, and expected mitochondrial phenotype for a drug. "
                "Returns null if unknown. USE WHEN you want to interpret data "
                "in light of mechanism, or when the user asks 'what does X do' / "
                "'what is X'."
            ),
            "parameters": {
                "type": "object",
                "properties": {"drug": {"type": "string"}},
                "required": ["drug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_features",
            "description": (
                "Return the list of measurable features in the dataset with "
                "their categories (morphology, dynamics, bioenergetics). USE "
                "WHEN the user asks 'what features are available?' or you need "
                "to confirm a feature name before calling another tool."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_drugs",
            "description": (
                "Return all drugs in the dataset with sample counts and (when "
                "known) pharmacological class. USE WHEN the user asks 'what "
                "drugs are in this dataset' or needs to confirm a drug name."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "dataset_overview",
            "description": (
                "Return high-level dataset facts: number of cells, number of "
                "drugs, list of feature categories. USE WHEN the user asks 'what "
                "is this dataset' or wants an introduction."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# Tool dispatcher
# ─────────────────────────────────────────────────────────────────────────────


def _resolve_feature(name: str) -> Optional[str]:
    """Map a user-facing feature name (e.g. 'motility') to the canonical
    feature_table column. Falls back to the input if no alias matches.
    """
    if not name:
        return None
    feat = query_handler.extract_feature_name(name)
    if feat:
        return feat
    return name


def _resolve_drug(name: str) -> str:
    """Normalise a drug name for the compute layer (legacy slug typos, etc.)."""
    return query_handler.normalize_drug_slug((name or "").strip())


def _list_features() -> Dict[str, Any]:
    """Return feature list grouped by category, with display names."""
    return {
        "morphology": [
            "Fragment Length", "Segment Length", "Fragment Diameter",
            "Fragment Tortuosity",
        ],
        "dynamics": [
            "Fragment Diffusivity (motility)", "Segment Diffusivity",
            "Node Diffusivity", "Fission Rate", "Fusion Rate",
        ],
        "bioenergetics": [
            "TMRM Intensity (membrane potential)",
            "MitoTracker Intensity (mitochondrial mass)",
        ],
        "notes": (
            "Aliases: 'motility' = Fragment Diffusivity; 'membrane potential' "
            "= TMRM Intensity (last frame); 'mitochondrial mass' = MitoTracker "
            "Intensity (last frame)."
        ),
    }


def _list_drugs() -> Dict[str, Any]:
    """Return the drugs in the dataset with sample counts + pharmacology class."""
    if query_handler.sample_metadata is None:
        return {"error": "Dataset not loaded"}
    counts = (
        query_handler.sample_metadata["drug"].value_counts().to_dict()
    )
    out = []
    seen: set = set()
    for d, n in counts.items():
        key = d.lower()
        if key in seen:
            continue
        seen.add(key)
        display = "DMSO (control)" if key in ("control", "dmso") else d
        if display in {"DMSO (control)"} and any(
            x[0] == display for x in out
        ):
            continue
        fact = drug_knowledge.get(d)
        out.append(
            {
                "drug": display,
                "n_cells": int(n),
                "pharm_class": fact.pharm_class if fact else None,
            }
        )
    # Merge control + DMSO if both somehow present (defensive).
    out.sort(key=lambda x: -x["n_cells"])
    return {"drugs": out, "total": len(out)}


def _get_drug_pharmacology(drug: str) -> Dict[str, Any]:
    """KB lookup. Returns null fields when unknown — never raises."""
    fact = drug_knowledge.get(drug)
    if fact is None:
        return {"drug": drug, "known": False}
    return {
        "drug": fact.display_name,
        "known": True,
        "pharm_class": fact.pharm_class,
        "target": fact.target,
        "mechanism": fact.mechanism,
        "expected_phenotype": fact.expected_phenotype,
    }


# Map tool name → callable.
def _run_tool_impl(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    if name == "rank_drugs_by_feature":
        feature = _resolve_feature(args.get("feature", ""))
        if not feature:
            return {"error": "Missing feature name"}
        direction = args.get("direction", "high")
        if direction not in ("high", "low"):
            direction = "high"
        top_n = int(args.get("top_n", 10))
        return query_handler.compute_ranking(feature, direction, top_n)

    if name == "compare_drugs":
        drugs = [_resolve_drug(d) for d in (args.get("drugs") or []) if d]
        if len(drugs) < 2:
            return {"error": "Need at least 2 drugs"}
        return query_handler.compute_drug_comparison(drugs)

    if name == "correlate_features":
        f1 = _resolve_feature(args.get("feature1", ""))
        f2 = _resolve_feature(args.get("feature2", ""))
        if not f1 or not f2:
            return {"error": "Need feature1 and feature2"}
        return query_handler.compute_correlation(f1, f2)

    if name == "summarize_feature":
        feature = _resolve_feature(args.get("feature", ""))
        if not feature:
            return {"error": "Missing feature name"}
        drug = args.get("drug")
        drug = _resolve_drug(drug) if drug else None
        return query_handler.compute_feature_stats(feature, drug)

    if name == "find_similar_drugs":
        drug = _resolve_drug(args.get("drug", ""))
        if not drug:
            return {"error": "Missing drug name"}
        return query_handler.compute_drug_similarity(drug, int(args.get("top_n", 5)))

    if name == "find_distinguishing_features":
        a = _resolve_drug(args.get("drug_a", ""))
        b = _resolve_drug(args.get("drug_b", ""))
        if not a or not b:
            return {"error": "Need drug_a and drug_b"}
        return query_handler.compute_top_differentiators(a, b, int(args.get("top_n", 5)))

    if name == "get_drug_pharmacology":
        return _get_drug_pharmacology(args.get("drug", ""))

    if name == "list_features":
        return _list_features()

    if name == "list_drugs":
        return _list_drugs()

    if name == "dataset_overview":
        return query_handler.compute_dataset_overview()

    return {"error": f"Unknown tool: {name}"}


def run_tool(name: str, raw_args: Any) -> Dict[str, Any]:
    """Thin wrapper that parses JSON-string args (the OpenAI tool-call format
    delivers arguments as a JSON string) and logs the call.
    """
    if isinstance(raw_args, str):
        try:
            args = json.loads(raw_args) if raw_args else {}
        except json.JSONDecodeError as exc:
            return {"error": f"Tool arguments not valid JSON: {exc}"}
    elif isinstance(raw_args, dict):
        args = raw_args
    else:
        args = {}

    try:
        result = _run_tool_impl(name, args)
    except Exception as exc:  # never let a tool blow up the agent loop
        logger.exception("agent_tools.tool_failed name=%s args=%s", name, args)
        return {"error": f"Tool '{name}' failed: {exc}"}

    logger.info(
        "agent_tools.tool_call",
        extra={
            "tool": name,
            "tool_args": args,
            "has_error": "error" in (result or {}),
        },
    )
    return result


def tool_names() -> List[str]:
    return [t["function"]["name"] for t in TOOL_SCHEMAS]
