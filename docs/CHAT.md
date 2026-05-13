# MitoSpace Chat — reference

Canonical doc for the in-app chat.

---

## 1. What it does

MitoSpace Chat is a grounded scientific Q&A panel for the dataset. It feels
like talking to a careful colleague at the microscope, not a 10-template
chatbot. Concretely:

- **Open-ended phrasing works.** "Show me the standout drug for membrane
  potential collapse" and "Find a drug similar to Rotenone but with a
  different mechanism" both produce thoughtful answers — there is no keyword
  classifier in the critical path.
- **Multi-step reasoning.** The LLM may chain several deterministic compute
  tools in one turn ("rank by TMRM low → look up mechanism for the top hit
  → narrate"), so questions that require *combining* sources just work.
- **Statistical literacy by default.** SEM, 95% CIs, Welch's t-test,
  Cohen's d, Spearman ρ, indistinguishable-rank flags — the agent has access
  to all of these and the system prompt instructs it to lean on magnitude
  (Cohen's d), not p-values, given the large n.
- **Biological grounding.** A drug-knowledge tool exposes mechanism /
  molecular target / expected phenotype for the 26 known compounds, so the
  agent can interpret data ("near-zero TMRM is consistent with CCCP's
  protonophore mechanism") instead of just listing numbers.
- **Self-correction.** Meta-questions ("are you sure?", "why?", "doesn't
  look right") cause the agent to re-run the relevant tool and either defend
  or amend its prior answer.
- **Variation.** Identical questions return *varied phrasings* of the same
  underlying numbers (no cached canned response).
- **Grounded.** Every numeric token in the rendered answer must be present
  in the union of tool results (or a simple derivation thereof — pairwise
  ratios, differences, percentages, squares, sqrt). Hallucinations are
  dropped and the answer falls back to a deterministic narrator.

---

## 2. Architecture (agent path)

```
User
  │  question + last N turns + dataset version
  ▼
FastAPI /api/chat (rate-limited, validated)
  │
  │  Primary path (LLM available)
  │  ─────────────────────────────
  │
  ├─► agent.run()                   ← tool-using LLM loop (max 6 iterations)
  │       │
  │       │  iter 0: send [system, …history…, user] + tool schemas → LLM
  │       │         LLM returns either:
  │       │           (a) tool_calls   → execute via agent_tools.run_tool,
  │       │                              append tool messages, loop;
  │       │           (b) final text   → return.
  │       │  …
  │       │  iter N: force final answer (tools=None, tool_choice=none).
  │       │
  │       ▼
  │   AgentResult { answer, tool_invocations[], iterations, … }
  │
  ├─► groundedness.check(answer, union of tool results)
  │
  ▼
ChatResponse {
  answer, data, query_type='agent', request_id,
  grounded, source='agent',
  suggestions: string[],
  cached: false,
  tools_used: ['rank_drugs_by_feature', 'get_drug_pharmacology', …]
}
```

When the LLM is unreachable (no API key, OpenRouter down, authentication
failure, repeated transient errors), the request falls through to the
**legacy classifier path** below so the chat is *always* usable.

### Fallback path (LLM unavailable)

```
classify_query()  →  compute_statistics()  →  _fallback_answer()
                                                 │
                                                 ▼
                                         ChatResponse(source='fallback')
```

The fallback path still produces insightful answers — ranking fallback
calls out DMSO position + indistinguishable ranks, comparison fallback
leads with a verdict summary.

### Tools the agent can call (`server/agent_tools.py`)

| Tool | Returns |
|---|---|
| `rank_drugs_by_feature` | Top/bottom N drugs by mean(feature), with 95% CI, Cohen's d vs DMSO, indistinguishable-rank flags |
| `compare_drugs` | Per-feature head-to-head incl. Welch's t-test + Cohen's d + verdict (clearly_different / likely_different / indistinguishable) |
| `correlate_features` | Pearson r (Fisher-z 95% CI) + Spearman ρ + p-value |
| `summarize_feature` | Distribution stats; optional drug filter |
| `find_similar_drugs` | Drugs nearest a target in z-scored mean-phenotype space, plus which-features-drove-it |
| `find_distinguishing_features` | Features ranked by \|Cohen's d\| between two drugs |
| `get_drug_pharmacology` | Known mechanism / target / expected phenotype lookup |
| `list_features` | All measurable features by category |
| `list_drugs` | All drugs in the dataset with sample counts + class |
| `dataset_overview` | High-level facts (n cells, n drugs, etc.) |

Adding a new capability = add a function + one schema entry. No classifier
work needed.

---

## 3. Production guarantees

| Concern | Mechanism |
|---|---|
| Cost control | Per-IP rate limit on `/api/chat` (`CHAT_RATE_LIMIT`, default `20/minute`); per-turn cap of 6 agent iterations; tool-result cache within a single turn |
| DoS / oversize input | Pydantic `min_length=1`, `max_length=2000` on `message`; history capped at last 12 turns, each ≤ 2000 chars; tool results truncated at 8 KB before re-entering the LLM context |
| Transient OpenRouter failures | tenacity exponential backoff on 429/5xx/timeout, max 3 attempts per LLM call |
| Hard timeouts | 45 s server-side per LLM attempt, 60 s end-to-end on the client |
| Hallucinated numbers | `groundedness.check` against the union of tool results, accepting literal values + simple derivations |
| Misbehaving LLM | Hard iteration cap forces a final answer; tools that error are surfaced to the LLM as `{"error": …}` so it can recover, not crash |
| LLM outage | Agent path falls through to the legacy classifier + deterministic narrator |
| Multi-turn | Full prior conversation passed to the LLM each turn — agent rebuilds context naturally |
| Version awareness | `?version=v1\|v3` (or body field) routes to the matching chat dataset |
| Observability | Structured key=value logs with `request_id` for every chat request, LLM call, tool invocation, and groundedness reject |
| Frontend UX | AbortController + Stop, Retry on transient failures, copy answer, char counter, source badge, tools-used chip |
| Tests | `python -m unittest discover -s server/tests` — 63 tests, no network |

---

## 4. Configuration

`server/.env`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...                  # required
OPENROUTER_MODEL=anthropic/claude-haiku-4.5       # default; any tool-capable id
CHAT_RATE_LIMIT=20/minute                         # optional; slowapi syntax
LOG_LEVEL=INFO                                    # optional
CORS_ORIGINS=https://example.com                  # optional CSV
```

Frontend:

```bash
VITE_API_URL=https://api.example.com              # defaults to http://127.0.0.1:8000
```

---

## 5. Run / verify locally

```bash
# Backend
cd server
conda activate deeplearning
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000

# Frontend
npm install
npm run dev

# Tests
python -m unittest discover -s server/tests -v

# Health
curl -s http://127.0.0.1:8000/api/health | jq

# Chat
curl -s -X POST http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"find a drug similar to Rotenone but with a different mechanism","version":"v3"}' | jq
```

---

## 6. Choosing a model

The agent path requires a model that supports OpenAI-style function calling
on OpenRouter. Tested defaults:

| Model | Strength | Notes |
|---|---|---|
| `anthropic/claude-haiku-4.5` (default) | strong grounding + tool use | best balance |
| `openai/gpt-4o-mini` | cheapest tool-capable model | fine for shorter chains |
| `openai/gpt-4o` | most reliable chained reasoning | ~3× the cost |
| `anthropic/claude-sonnet-4.5` | longer chains, richer narration | ~5× the cost |

Swap by setting `OPENROUTER_MODEL` and restarting. If the chosen model does
*not* support tools, `/api/chat` will degrade to the legacy classifier path
(answers still work; phrasing is templated).

---

## 7. Adding a new capability

1. Add a `compute_*` function in `query_handler.py`.
2. Register it in `server/agent_tools.py` with:
   - A `TOOL_SCHEMAS` entry (name + clear "USE WHEN" description + JSON parameters).
   - A branch in `_run_tool_impl()` that calls your `compute_*`.
3. Add a `unittest` case in `server/tests/test_chat.py`.
4. *No* classifier change required — the LLM picks up the new tool automatically.
5. (Optional) Add a fallback branch in `_fallback_answer` so the deterministic path also supports it when the LLM is down.

---

## 8. Security

- The OpenRouter key lives only in `server/.env`. Never commit. Never paste
  into docs. `.gitignore` excludes `server/.env`.
- Rotate keys at `https://openrouter.ai/keys` if a key has ever leaked.
- `/api/chat` is unauthenticated by design (the data is public). The rate
  limiter is what stops cost abuse. If you ever expose the API beyond your
  trusted network, add a shared bearer token check in `chat()`.
- The agent system prompt explicitly rejects prompt-injection
  (`"ignore previous instructions"`, role-overrides) and the groundedness
  check is the second line of defence against hallucinated numbers.
- Tools are explicit and read-only — there is no `execute_sql`, no `eval`,
  no filesystem access. The worst a misbehaving agent can do is loop until
  it hits the iteration cap.
