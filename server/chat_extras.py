"""
Chat conversational extras: suggested follow-ups + response cache.

These are intentionally small, focused utilities so the main `/api/chat`
endpoint stays readable.

`suggested_followups(...)`
    Given the just-answered query type and the entities extracted from it,
    propose 2-3 natural next-step questions a scientist would actually ask.
    Rule-based: cheap, deterministic, and shape-aware (we don't suggest a
    follow-up that's already been asked in the current conversation).

`ResponseCache`
    Tiny LRU cache keyed by (message, last-N history snapshot, version, model).
    Misses cost ~$0.001 + 2-4 s on OpenRouter; hits are free and instant.
    Capped to ~256 entries to bound memory; LRU eviction on insert.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence


# ─────────────────────────────────────────────────────────────────────────────
# Suggested follow-ups
# ─────────────────────────────────────────────────────────────────────────────


def _shortlist(history_messages: Sequence[str]) -> set[str]:
    """Lowercased recent user messages (for de-duping suggestions)."""
    return {m.strip().lower() for m in history_messages if m}


def suggested_followups(
    *,
    query_type: str,
    params: Optional[Dict[str, Any]] = None,
    stats: Optional[Dict[str, Any]] = None,
    recent_user_messages: Sequence[str] = (),
) -> List[str]:
    """Return up to 3 follow-up questions tuned to the current answer.

    Designed to feel like a colleague saying "would you also like to look at…?"
    rather than a chatbot reciting boilerplate. Each branch keeps the
    suggestions specific (with concrete drug / feature names from the query)
    so they're one-click useful.
    """
    params = params or {}
    stats = stats or {}
    asked = _shortlist(recent_user_messages)
    suggestions: List[str] = []

    if query_type == "ranking":
        feature = params.get("feature") or stats.get("feature") or "this feature"
        direction = params.get("direction", "high")
        top = (stats.get("rankings") or [])[:1]
        leader = top[0]["drug"] if top else None
        opposite_dir = "decrease" if direction == "high" else "increase"
        suggestions.append(f"Which drugs {opposite_dir} {feature}?")
        if leader and leader != "DMSO (control)":
            suggestions.append(f"How does {leader} compare to DMSO across all features?")
            suggestions.append(f"What other drugs phenotype like {leader}?")
        else:
            suggestions.append(f"Are any of these statistically indistinguishable at this n?")

    elif query_type == "drug_comparison":
        drugs = params.get("drugs") or []
        if len(drugs) >= 2:
            suggestions.append(f"What differs most between {drugs[0]} and {drugs[1]}?")
            suggestions.append(f"How does {drugs[0]} compare to DMSO?")
            suggestions.append(f"What other drugs look like {drugs[0]}?")
        elif drugs:
            suggestions.append(f"How does {drugs[0]} compare to DMSO?")
            suggestions.append(f"What other drugs look like {drugs[0]}?")

    elif query_type == "correlation":
        f1 = stats.get("feature1")
        f2 = stats.get("feature2")
        if f1 and f2:
            suggestions.append(f"Which drugs have the highest {f1}?")
            suggestions.append(f"Is {f2} also correlated with membrane potential?")
            suggestions.append(f"Show me drugs where {f1} and {f2} diverge.")

    elif query_type == "feature_stats":
        feature = params.get("feature") or stats.get("feature")
        drug = params.get("drug")
        if drug and feature:
            suggestions.append(f"How does {drug}'s {feature} compare to DMSO?")
            suggestions.append(f"Which drugs have the highest {feature}?")
            suggestions.append(f"Is {feature} correlated with membrane potential?")
        elif feature:
            suggestions.append(f"Which drugs increase {feature} the most?")
            suggestions.append(f"Which drugs decrease {feature} the most?")
            suggestions.append(f"Is {feature} correlated with fragment length?")

    elif query_type == "drug_similarity":
        target = stats.get("target_drug")
        neighbours = (stats.get("neighbors") or [])[:1]
        nearest = neighbours[0]["drug"] if neighbours else None
        if target and nearest:
            suggestions.append(f"Compare {target} and {nearest} directly.")
            suggestions.append(f"What differs most between {target} and {nearest}?")
        if target:
            suggestions.append(f"How does {target} compare to DMSO?")

    elif query_type == "top_differentiators":
        a = stats.get("drug_a")
        b = stats.get("drug_b")
        top = (stats.get("top_differentiators") or [])[:1]
        feat = top[0]["feature"] if top else None
        if a and b:
            suggestions.append(f"Run a full comparison between {a} and {b}.")
        if feat:
            suggestions.append(f"Which drugs have the highest {feat}?")
        if a:
            suggestions.append(f"What drugs phenotype like {a}?")

    elif query_type == "feature_description":
        feature = params.get("feature") or stats.get("feature")
        if feature:
            suggestions.append(f"Which drugs increase {feature}?")
            suggestions.append(f"Is {feature} correlated with membrane potential?")

    elif query_type in {"dataset_overview", "help", "greeting", "thanks", "unsupported"}:
        suggestions += [
            "Which drugs increase motility the most?",
            "Compare Rotenone and CCCP.",
            "What drugs look like Nigericin?",
        ]

    # De-dup and exclude anything substantively asked already.
    out: List[str] = []
    for s in suggestions:
        sl = s.strip().lower().rstrip("?.")
        if not s.strip():
            continue
        if any(sl in a or a in sl for a in asked):
            continue
        if any(s == prev for prev in out):
            continue
        out.append(s)
        if len(out) >= 3:
            break
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Response cache
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class _CacheEntry:
    response: Any
    inserted_at: float


class ResponseCache:
    """Tiny thread-safe LRU cache for chat responses.

    Keying strategy
    ---------------
    We hash the lowercased / stripped user message together with the LAST
    `history_window` turns (also lowercased) plus the version and model. This
    way:
      - Identical question with identical recent context → cache hit.
      - Same question after a different conversation thread → cache miss
        (because the multi-turn context that the LLM saw would have been
        different anyway).

    Entries past `ttl_seconds` are treated as misses on read but kept until
    LRU eviction picks them up.
    """

    def __init__(self, capacity: int = 256, ttl_seconds: int = 60 * 60, history_window: int = 4):
        self.capacity = capacity
        self.ttl_seconds = ttl_seconds
        self.history_window = history_window
        self._store: "OrderedDict[str, _CacheEntry]" = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def _key(
        self,
        *,
        message: str,
        history: Sequence[Dict[str, Any]],
        version: str,
        model: str,
    ) -> str:
        tail = list(history)[-self.history_window :]
        normalised = {
            "m": (message or "").strip().lower(),
            "h": [
                {"r": (t.get("role") or "").lower(), "c": (t.get("content") or "").strip().lower()[:1000]}
                for t in tail
            ],
            "v": version,
            "model": model,
        }
        blob = json.dumps(normalised, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()

    def get(
        self,
        *,
        message: str,
        history: Sequence[Dict[str, Any]],
        version: str,
        model: str,
    ) -> Optional[Any]:
        key = self._key(message=message, history=history, version=version, model=model)
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self.misses += 1
                return None
            if time.time() - entry.inserted_at > self.ttl_seconds:
                self.misses += 1
                self._store.pop(key, None)
                return None
            self._store.move_to_end(key)  # mark MRU
            self.hits += 1
            return entry.response

    def put(
        self,
        *,
        message: str,
        history: Sequence[Dict[str, Any]],
        version: str,
        model: str,
        response: Any,
    ) -> None:
        key = self._key(message=message, history=history, version=version, model=model)
        with self._lock:
            self._store[key] = _CacheEntry(response=response, inserted_at=time.time())
            self._store.move_to_end(key)
            while len(self._store) > self.capacity:
                self._store.popitem(last=False)

    def stats(self) -> Dict[str, int]:
        with self._lock:
            return {
                "size": len(self._store),
                "capacity": self.capacity,
                "hits": self.hits,
                "misses": self.misses,
            }


# Module-level singleton — easy to import from main.py.
chat_response_cache = ResponseCache()
