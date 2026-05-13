"""
The MitoSpace chat agent.

Architecture (in one paragraph)
------------------------------
The LLM is given the user's question + a small set of deterministic tools
(see `agent_tools.py`). Each turn the LLM decides whether to call tools, and
which ones. We execute the tool calls, feed the JSON results back as tool
messages, and let the LLM either call more tools (chain reasoning) or write
a final natural-language answer. There is no keyword classifier in the
critical path — the LLM understands intent in any phrasing, and the
deterministic compute layer guarantees grounded numbers.

Cost / latency control
----------------------
- `MAX_TOOL_ITERATIONS`: hard cap so a misbehaving model can't burn an
  unbounded number of LLM calls. We force a final answer on the last turn.
- Tool RESULT cache: identical tool calls within a session return the cached
  JSON. This keeps multi-step reasoning cheap.
- `temperature=0.6` (not 0): the same question gets natural variation in the
  narration without losing fidelity.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

try:
    from . import agent_tools
    from . import llm_client as _llm
except ImportError:
    import agent_tools  # type: ignore
    import llm_client as _llm  # type: ignore


logger = logging.getLogger("mitospace.agent")


MAX_TOOL_ITERATIONS = 6            # decide → tool → decide → tool → … (cap)
MAX_TOOL_CALLS_PER_TURN = 6        # defensive cap inside one assistant turn
MAX_TOOL_RESULT_CHARS = 8_000      # truncate huge tool outputs in messages
DEFAULT_TEMPERATURE = 0.6
DEFAULT_MAX_TOKENS = 900


@dataclass
class ToolInvocation:
    """One tool call made by the agent during a chat turn."""

    name: str
    arguments: Dict[str, Any]
    result: Dict[str, Any]
    latency_ms: float


@dataclass
class AgentResult:
    """The final answer plus everything that was computed to produce it."""

    answer: str
    tool_invocations: List[ToolInvocation] = field(default_factory=list)
    iterations: int = 0
    llm_latency_ms: float = 0.0
    finish_reason: Optional[str] = None
    request_id: Optional[str] = None
    # When True, every numeric token in `answer` is verifiable against the
    # union of tool results (enforced by the caller via `groundedness.check`).
    grounded: bool = True
    # Errors encountered during the loop (don't abort the run; the LLM gets
    # a chance to recover).
    errors: List[str] = field(default_factory=list)


def _tool_call_key(name: str, args: Any) -> str:
    """Stable hash for caching identical tool invocations in a single run."""
    blob = json.dumps({"n": name, "a": args}, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _truncate(s: str, limit: int = MAX_TOOL_RESULT_CHARS) -> str:
    """Avoid blowing up the context window on huge tool outputs."""
    if len(s) <= limit:
        return s
    return s[: limit - 50] + f"\n…(truncated {len(s) - limit + 50} chars)…"


def _serialize_tool_result(result: Any) -> str:
    """JSON-serialize a tool result for inclusion as a tool message."""
    try:
        return _truncate(json.dumps(result, default=str))
    except (TypeError, ValueError):
        return _truncate(str(result))


def _coerce_arguments(raw: Any) -> Dict[str, Any]:
    """Tool-call arguments arrive as a JSON string from OpenAI-compatible APIs."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw:
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def run(
    *,
    user_message: str,
    history: List[Dict[str, str]],
    system_prompt: str,
    request_id: str,
    max_iterations: int = MAX_TOOL_ITERATIONS,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> Optional[AgentResult]:
    """Run the tool-using agent for one user turn.

    Returns AgentResult on success, or None if the LLM was unreachable.
    The caller is responsible for groundedness checking and fallback paths.
    """
    client = _llm.get_llm_client()
    if client is None:
        return None

    started = time.perf_counter()
    invocations: List[ToolInvocation] = []
    errors: List[str] = []
    tool_cache: Dict[str, Dict[str, Any]] = {}

    # Build initial message list. The conversation history is replayed as-is;
    # the new user turn is appended.
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for turn in history:
        role = turn.get("role")
        content = turn.get("content")
        if not role or not content:
            continue
        if role not in ("user", "assistant"):
            continue
        messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message.strip()})

    llm_latency_total = 0.0
    finish_reason: Optional[str] = None

    for iteration in range(max_iterations):
        on_final_turn = iteration == max_iterations - 1
        # On the final allowed iteration, force the model to answer (no tools).
        assistant_msg, telemetry = client.chat(
            messages=messages,
            tools=None if on_final_turn else agent_tools.TOOL_SCHEMAS,
            tool_choice="auto" if not on_final_turn else "none",
            temperature=temperature,
            max_tokens=max_tokens,
            request_id=request_id,
        )
        llm_latency_total += telemetry.latency_ms or 0.0
        finish_reason = telemetry.finish_reason

        if assistant_msg is None:
            errors.append(f"LLM failure on iteration {iteration} ({telemetry.error_kind})")
            logger.warning(
                "agent.llm_failure",
                extra={
                    "request_id": request_id,
                    "iteration": iteration,
                    "error_kind": telemetry.error_kind,
                },
            )
            return None

        tool_calls = getattr(assistant_msg, "tool_calls", None) or []

        if not tool_calls:
            # Final natural-language answer.
            answer = (getattr(assistant_msg, "content", None) or "").strip()
            logger.info(
                "agent.final_answer",
                extra={
                    "request_id": request_id,
                    "iterations": iteration + 1,
                    "tool_invocations": len(invocations),
                    "llm_latency_ms": round(llm_latency_total, 1),
                    "total_latency_ms": round((time.perf_counter() - started) * 1000.0, 1),
                },
            )
            return AgentResult(
                answer=answer,
                tool_invocations=invocations,
                iterations=iteration + 1,
                llm_latency_ms=llm_latency_total,
                finish_reason=finish_reason,
                request_id=request_id,
                errors=errors,
            )

        # Append the assistant's tool-use turn (must preserve tool_calls payload
        # for the next round so the model sees its own decisions).
        assistant_serialized: Dict[str, Any] = {
            "role": "assistant",
            "content": getattr(assistant_msg, "content", None) or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in tool_calls
            ],
        }
        messages.append(assistant_serialized)

        # Execute each tool call, append a tool message per call. Defensive cap.
        for tc in tool_calls[:MAX_TOOL_CALLS_PER_TURN]:
            name = tc.function.name
            args = _coerce_arguments(tc.function.arguments)
            cache_key = _tool_call_key(name, args)

            tool_started = time.perf_counter()
            if cache_key in tool_cache:
                result = tool_cache[cache_key]
                cache_hit = True
            else:
                result = agent_tools.run_tool(name, args)
                tool_cache[cache_key] = result
                cache_hit = False
            tool_latency = (time.perf_counter() - tool_started) * 1000.0

            invocations.append(
                ToolInvocation(
                    name=name, arguments=args, result=result, latency_ms=tool_latency,
                )
            )
            logger.info(
                "agent.tool_invocation",
                extra={
                    "request_id": request_id,
                    "iteration": iteration,
                    "tool": name,
                    "cache_hit": cache_hit,
                    "latency_ms": round(tool_latency, 1),
                    "has_error": isinstance(result, dict) and "error" in result,
                },
            )

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": _serialize_tool_result(result),
                }
            )

    # Reached max_iterations without a final answer. Force one last narration.
    logger.warning(
        "agent.max_iterations",
        extra={"request_id": request_id, "iterations": max_iterations, "tools_run": len(invocations)},
    )
    final_msg, final_telemetry = client.chat(
        messages=messages + [
            {
                "role": "user",
                "content": (
                    "Please give a final natural-language answer now using the tool "
                    "results above. Do not call any more tools."
                ),
            }
        ],
        tools=None,
        tool_choice="none",
        temperature=temperature,
        max_tokens=max_tokens,
        request_id=request_id,
    )
    llm_latency_total += (final_telemetry.latency_ms or 0.0) if final_telemetry else 0.0
    if final_msg is None:
        errors.append("LLM failed on forced-final turn")
        return AgentResult(
            answer="",
            tool_invocations=invocations,
            iterations=max_iterations,
            llm_latency_ms=llm_latency_total,
            finish_reason=finish_reason,
            request_id=request_id,
            errors=errors,
        )
    return AgentResult(
        answer=(getattr(final_msg, "content", "") or "").strip(),
        tool_invocations=invocations,
        iterations=max_iterations,
        llm_latency_ms=llm_latency_total,
        finish_reason=getattr(final_telemetry, "finish_reason", None),
        request_id=request_id,
        errors=errors,
    )


def collected_tool_data(invocations: List[ToolInvocation]) -> Dict[str, Any]:
    """Aggregate every tool result this turn produced — used for the
    groundedness check and the `data` field of ChatResponse."""
    if not invocations:
        return {}
    if len(invocations) == 1:
        return {"tool": invocations[0].name, "result": invocations[0].result}
    return {
        "tools": [
            {"name": inv.name, "args": inv.arguments, "result": inv.result}
            for inv in invocations
        ]
    }


def tool_summary(invocations: List[ToolInvocation]) -> List[str]:
    """Short human-readable list of tools the agent called (for the UI)."""
    return [inv.name for inv in invocations]
