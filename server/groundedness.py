"""
Groundedness verification for chat responses.

Rule: the LLM is told to only narrate numbers from the JSON envelope we hand
it. Models occasionally drift (especially on follow-ups or with retries), so
after each generation we extract every numeric token from the LLM's text and
verify that each one appears (within a small tolerance) in the JSON envelope.

If anything fails, we don't try to "fix" the answer — we mark it ungrounded
and let the caller fall back to the deterministic answer builder. Trying to
edit a partially-hallucinated answer in-place is worse than replacing it.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Iterable, List, Sequence, Tuple

logger = logging.getLogger("mitospace.groundedness")


# Pulled out so tests can extend it if needed.
_NUMBER_RE = re.compile(
    r"""
    (?<![A-Za-z_])           # not part of an identifier
    -?                       # optional sign
    \d+                      # integer part
    (?:\.\d+)?               # optional decimal
    (?:[eE][+-]?\d+)?        # optional exponent
    """,
    re.VERBOSE,
)


# Numbers <= this are treated as "structural" (years, counts, list indexes,
# percentages, common constants) and skipped. Stat values are always larger
# than 0 and usually decimal, while structural numbers like "Top 5", "p < 0.05",
# "2025 dataset", or "20-frame time series" should never trigger a flag.
_STRUCTURAL_ALLOWLIST: frozenset[float] = frozenset(
    {
        0.0, 0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0,
        20.0, 100.0, 1000.0,
        # Common percentile / p-value labels:
        0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99,
        # Years that show up in narrative context (kept conservative)
        2024.0, 2025.0, 2026.0,
    }
)


def _collect_numbers(obj: Any, out: List[float]) -> None:
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        try:
            out.append(float(obj))
        except (ValueError, TypeError):
            pass
        return
    if isinstance(obj, dict):
        for v in obj.values():
            _collect_numbers(v, out)
        return
    if isinstance(obj, (list, tuple, set)):
        for v in obj:
            _collect_numbers(v, out)
        return
    # Strings: try to parse if they're a pure number, otherwise ignore.
    if isinstance(obj, str):
        m = _NUMBER_RE.fullmatch(obj.strip())
        if m:
            try:
                out.append(float(obj))
            except ValueError:
                pass


def _extract_numbers_from_answer(answer: str) -> List[float]:
    nums: List[float] = []
    for tok in _NUMBER_RE.findall(answer or ""):
        try:
            nums.append(float(tok))
        except ValueError:
            continue
    return nums


def _matches(needle: float, haystack: Sequence[float], rel_tol: float, abs_tol: float) -> bool:
    """True iff `needle` is within tolerance of any value in `haystack`.

    We allow:
      - exact match,
      - the same value rounded to fewer significant figures
        (since the JSON often has 4 decimals and the model trims to 2–3),
      - small relative tolerance for floating-point noise.
    """
    if needle in _STRUCTURAL_ALLOWLIST:
        return True
    for v in haystack:
        if v == needle:
            return True
        # Both zero already handled above; protect against div-by-zero.
        denom = max(abs(v), abs(needle), 1e-12)
        if abs(v - needle) <= abs_tol or abs(v - needle) / denom <= rel_tol:
            return True
        # Tolerate the model rounding to fewer decimal places (e.g. 0.001 vs
        # 0.0012). Round both to the needle's apparent precision and compare.
        decimals = _trailing_decimals(needle)
        if decimals >= 0:
            if round(v, decimals) == needle:
                return True
    return False


def _trailing_decimals(x: float) -> int:
    """How many decimal places `x` was likely written to, max 6."""
    s = repr(x)
    if "." not in s or "e" in s.lower():
        return 0
    frac = s.split(".", 1)[1]
    return min(len(frac), 6)


def check(
    answer: str,
    stats: Any,
    *,
    rel_tol: float = 0.05,
    abs_tol: float = 0.005,
) -> Tuple[bool, List[float]]:
    """Return (is_grounded, unsupported_numbers).

    `is_grounded` is True when every numeric token in the answer can be
    matched to a number in `stats` within the given tolerances.

    Tolerances are intentionally permissive — the goal is to catch
    *hallucinations*, not punish reasonable rounding.
    """
    allowed: List[float] = []
    _collect_numbers(stats, allowed)

    found = _extract_numbers_from_answer(answer)
    unsupported = [n for n in found if not _matches(n, allowed, rel_tol, abs_tol)]
    return (len(unsupported) == 0), unsupported


def check_and_log(
    answer: str,
    stats: Any,
    *,
    request_id: str,
    query_type: str,
) -> bool:
    """Convenience wrapper that emits a structured log on failure."""
    ok, unsupported = check(answer, stats)
    if not ok:
        logger.warning(
            "groundedness.failed",
            extra={
                "request_id": request_id,
                "query_type": query_type,
                "unsupported_numbers": unsupported[:10],
                "answer_preview": (answer or "")[:240],
            },
        )
    return ok


__all__ = ["check", "check_and_log"]
