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
import math
import re
from typing import Any, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger("mitospace.groundedness")


# Pulled out so tests can extend it if needed.
#
# A "number" for our purposes is one of:
#   - a plain decimal: -0.5 or 0.5
#   - a number with thousands separators: 34,718 or 1,234,567
#   - a scientific-notation number: 1.5e-3
# We allow Unicode minus (U+2212) and en-dash (U+2013) as well as ASCII '-'
# because the LLM frequently uses pretty typography (`−0.106`, `–0.106`).
_NUMBER_RE = re.compile(
    r"""
    (?<![A-Za-z_])               # not part of an identifier
    [-\u2212\u2013]?             # optional sign (ASCII -, U+2212 minus, U+2013 en-dash)
    \d{1,3}(?:,\d{3})+           # >=4-digit integer with thousands separators
    (?:\.\d+)?                   # optional decimal part
    (?:[eE][+-]?\d+)?            # optional exponent
    |
    (?<![A-Za-z_])
    [-\u2212\u2013]?
    \d+
    (?:\.\d+)?
    (?:[eE][+-]?\d+)?
    """,
    re.VERBOSE,
)


def _parse_number(token: str) -> Optional[float]:
    """Normalise a captured token to a float, returning None if it isn't one."""
    s = token.replace(",", "").replace("\u2212", "-").replace("\u2013", "-")
    try:
        return float(s)
    except ValueError:
        return None


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
        # Confidence-level labels ("95% CI", "99% CI", "90% CI", etc.). These
        # are not statistical values, just headers that scientists always cite.
        90.0, 95.0, 99.0,
        # Effect-size threshold conventions (Cohen): d > 0.2 small,
        # 0.5 medium, 0.8 large; r² thresholds; z-scores.
        0.2, 0.8, 1.96,
        # Round percentages people quote (e.g. "50% of variance", "10x higher")
        50.0,
        # Years that show up in narrative context (kept conservative).
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
            parsed = _parse_number(obj.strip())
            if parsed is not None:
                out.append(parsed)


def _extract_numbers_from_answer(answer: str) -> List[float]:
    nums: List[float] = []
    for tok in _NUMBER_RE.findall(answer or ""):
        parsed = _parse_number(tok)
        if parsed is not None:
            nums.append(parsed)
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


# Cap on how many literal stats values we try to combine when computing the
# derived (ratios/differences/percentages) allowlist. With N literal values we
# generate O(N^2) derived candidates; N=60 → 3600 pairs which is still fast,
# and real stats envelopes rarely exceed this.
_MAX_DERIVED_BASE = 60


def _expand_with_derived(literal: Sequence[float]) -> List[float]:
    """Expand the allowed set with pairwise ratios, differences, and
    percentage-change expressions of the literal stats numbers.

    Why: LLMs often add useful color commentary like "3.7× higher than DMSO
    (114.2)" or "40% above baseline". These numbers don't appear in the
    stats JSON literally but are *derived from* numbers that do, so we want
    to admit them as grounded. By contrast, a true hallucination is unlikely
    to coincidentally equal the ratio of two real values.

    Set built:
      - all literal values (already in)
      - a / b and b / a for every pair
      - a - b and b - a
      - (a - b) / b * 100 and (b - a) / b * 100  (percent change)
      - a * 100 and a / 100                       (unit shifts, percentages)
    """
    base = [v for v in literal if v != 0 and -1e15 < v < 1e15]
    # Keep deterministic and bounded.
    if len(base) > _MAX_DERIVED_BASE:
        # Pick the most "interesting" values (largest by magnitude).
        base = sorted(base, key=lambda x: -abs(x))[:_MAX_DERIVED_BASE]

    derived: List[float] = list(literal)
    for a in base:
        derived.append(a * 100.0)
        derived.append(a / 100.0)
        # Unary derivations that scientists routinely write:
        #   r²  → variance explained
        #   √|x| → magnitude of an effect or noise
        #   |x| → absolute value (drop the sign in narration)
        derived.append(a * a)
        derived.append(a * a * 100.0)  # "% variance explained"
        if a >= 0:
            derived.append(math.sqrt(a))
        derived.append(abs(a))
        for b in base:
            if a is b:
                continue
            if b != 0:
                derived.append(a / b)
            derived.append(a - b)
            derived.append(a + b)
            if b != 0:
                derived.append((a - b) / b * 100.0)
    # Drop anything non-finite that fell out of the math.
    return [d for d in derived if d == d and abs(d) != float("inf")]


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
    allow_derived: bool = True,
) -> Tuple[bool, List[float]]:
    """Return (is_grounded, unsupported_numbers).

    `is_grounded` is True when every numeric token in the answer can be
    matched to a number derivable from `stats` within the given tolerances.

    When `allow_derived=True` (default), the allowed set is expanded with
    pairwise ratios, differences and percentage changes of the literal stats
    values — so the LLM can legitimately write "3.7× higher" or "40% above
    baseline" without tripping the check. Set to False for paranoid mode
    (purely literal match).
    """
    literal: List[float] = []
    _collect_numbers(stats, literal)
    allowed = _expand_with_derived(literal) if allow_derived else literal

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
