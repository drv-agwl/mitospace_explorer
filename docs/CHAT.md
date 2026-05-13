# MitoSpace Chat — reference

Canonical doc for the in-app chat. Replaces `OPENROUTER_INTEGRATION.md`,
`CHAT_SYSTEM_COMPLETE.md`, and `CHAT_UI_IMPROVEMENTS.md` (all of which had
drifted from code).

---

## 1. What it does

MitoSpace Chat is a grounded scientific Q&A panel for the dataset. Users can
ask:

- **Rankings** — "Which drugs increase motility?" (with SEM, 95% CI, Cohen's d
  vs DMSO, and auto-flagging of statistically indistinguishable adjacent ranks)
- **Drug comparisons** — "Compare Rotenone and CCCP" (Welch's t-test + Cohen's
  d + plain-English verdict per feature for the 2-drug case)
- **Feature correlations** — "Is motility correlated with segment length?"
  (Pearson r with Fisher-z 95% CI, plus Spearman ρ and p-values)
- **Summary stats** — "What's the mean fragment length for Rotenone?"
- **Feature info** — "What is membrane potential?"
- **Dataset overview** — "What features are available?"
- **Drug similarity** — "What drugs look most like Rotenone?" (Euclidean
  distance in z-scored mean-phenotype space, with which-features-drove-it)
- **Top differentiators** — "What differs most between Rotenone and DMSO?"
  (features ranked by |Cohen's d|)
- **Multi-turn follow-ups** — "what about for membrane potential?",
  "and CCCP?"

Every LLM-narrated answer is enriched with a **drug-knowledge block** when the
question touches one of the 26 known compounds (Complex I inhibitors,
uncouplers, K+/H+ antiporters, microtubule depolymerisers, etc.). The model is
prompted to integrate this mechanism context with the statistics, so answers
feel like talking to a colleague rather than a SQL terminal.

Each answer ships with up to 3 **suggested follow-up chips** (rule-based per
query type, de-duped against prior turns) so users can keep exploring with one
click.

The chat does NOT execute code, control the UI, or invent numbers. It
narrates *statistics computed deterministically by the backend* from the
loaded dataset.

---

## 2. Architecture

```
User
  │  question + last N turns + dataset version
  ▼
FastAPI /api/chat (rate-limited, validated)
  │
  ├─► query_handler.classify_query()        ← rule-based intent classifier
  │       │
  │       ▼
  │   query_type ∈ {ranking, drug_comparison, correlation,
  │                feature_stats, feature_description,
  │                dataset_overview, drug_similarity,
  │                top_differentiators, greeting, thanks,
  │                help, unsupported}
  │
  ├─► query_handler.compute_statistics()    ← deterministic pandas/numpy
  │       │
  │       ▼
  │   stats: dict (the *only* source of numbers in the answer)
  │
  ├─► (cache check) chat_extras.chat_response_cache
  │       │   keyed on (msg, last 4 turns, version, model). LRU, ttl=1h.
  │       │   → return immediately with cached=True on hit.
  │
  ├─► drug_knowledge.context_block(drugs in scope)
  │       │   for each known compound mentioned in this turn or recent history,
  │       │   inject mechanism + target + expected phenotype into the prompt.
  │
  ├─► llm_client.LLMClient.generate()       ← OpenRouter, with retries
  │       │   system prompt: build_system_prompt(version, n, n_drugs,
  │       │                                       pharmacology_block=…)
  │       │   messages   : [system, …history…, user(question + stats JSON)]
  │       │
  │       ▼
  │   candidate answer  +  telemetry (model, latency, tokens)
  │
  ├─► groundedness.check()                  ← every number in answer must
  │                                           appear in stats (within ε)
  │
  ├─► if ungrounded or LLM failed: _fallback_answer()  ← deterministic text
  │
  ▼
ChatResponse {
  answer, data, query_type, request_id,
  grounded, source,         // 'llm' | 'fallback'
  suggestions: string[],    // up to 3 follow-up chips
  cached: bool              // true if served from response cache
}
```

Key invariant: **every numeric token in the rendered answer is verifiably
present in `data`** — directly OR as a simple derivation of literal values
(pairwise ratios, differences, percentages, squares, square roots). Hallucinated
numbers are dropped, never displayed, and the answer falls back to the
deterministic narrator.

---

## 3. Production guarantees

| Concern | Mechanism |
|---|---|
| Cost control | Per-IP rate limit on `/api/chat` (`CHAT_RATE_LIMIT`, default `20/minute`); in-memory LRU response cache for repeat questions (instant + free on hit) |
| DoS / oversize input | Pydantic `min_length=1`, `max_length=2000` on `message`; history capped at last 12 turns, each ≤ 2000 chars |
| Transient OpenRouter failures | tenacity exponential backoff on 429/5xx/timeout, max 3 attempts |
| Hard timeouts | 45 s server-side per attempt, 60 s end-to-end on the client |
| Hallucinated numbers | `groundedness.check` against the stats envelope, accepting literal values + simple derivations (ratios, differences, percentages, squares, sqrt) |
| Scientific depth | SEM, 95% CIs, Welch's t-test, Cohen's d, Spearman ρ on every relevant query; statistically-indistinguishable adjacent ranks auto-flagged |
| Biological grounding | `drug_knowledge.context_block` injects mechanism / target / expected phenotype for the 26 known compounds into the LLM prompt when the question mentions them |
| Guided exploration | `chat_extras.suggested_followups` returns up to 3 rule-based, context-aware chips per answer |
| LLM outage | Deterministic `_fallback_answer` for every supported query type, consuming the same statistical envelope |
| Multi-turn | Full prior conversation passed to the LLM (not just the latest turn) |
| Version awareness | `?version=v1\|v3` (or body field) routes to the matching chat dataset |
| Observability | Structured key=value logs with `request_id` for every LLM call, chat request, cache hit/miss, and groundedness reject |
| Frontend UX | AbortController + Stop button, Retry on transient failures, copy answer, char counter, source badge for deterministic answers, cached badge, clickable suggestion chips |
| Tests | `python -m unittest discover -s server/tests -v` — 56 tests, no network |

---

## 4. Configuration

`server/.env` (copy from `server/.env.example`):

```bash
OPENROUTER_API_KEY=sk-or-v1-...        # required; get one from https://openrouter.ai/keys
OPENROUTER_MODEL=anthropic/claude-haiku-4.5   # default; any OpenRouter id works
CHAT_RATE_LIMIT=20/minute              # optional; slowapi syntax
LOG_LEVEL=INFO                         # optional; DEBUG/INFO/WARNING/ERROR
CORS_ORIGINS=https://example.com       # optional; CSV of additional origins
```

Frontend (`.env` or build-time):

```bash
VITE_API_URL=https://api.example.com   # backend base URL; defaults to http://127.0.0.1:8000
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

# Health (includes which versions are loaded + active LLM model)
curl -s http://127.0.0.1:8000/api/health | jq

# Send a chat (no auth required)
curl -s -X POST http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"which drugs increase motility?","version":"v3"}' | jq
```

---

## 6. Choosing a model

We default to `anthropic/claude-haiku-4.5` because it is strongest at strict
grounding + refusal at the cost tier we want (~$1 / $5 per Mtok). Other
sensible options on OpenRouter:

| Model | Strength | Approx cost / chat |
|---|---|---|
| `anthropic/claude-haiku-4.5` (default) | grounding, refusals, concise prose | ~$0.001 |
| `openai/gpt-4o-mini` | cheapest decent option | ~$0.0002 |
| `openai/gpt-4o` | nuance and instruction following | ~$0.003 |
| `deepseek/deepseek-chat` | great value, occasional drift | ~$0.0004 |
| `meta-llama/llama-3-70b-instruct` | cheapest | ~$0.0008 |

Swap by setting `OPENROUTER_MODEL` and restarting the backend.

---

## 7. Adding a new query type

1. Add classifier branch in `query_handler.classify_query`.
2. Add stats function (`compute_*`) and route in `compute_statistics`.
3. Add a fallback branch in `_fallback_answer` (so we still answer when the
   LLM is down).
4. Add a `unittest` case in `server/tests/test_chat.py`.
5. The system prompt does NOT need changes for new query types — the LLM
   only narrates whatever JSON it receives.

---

## 8. Security

- The OpenRouter key lives only in `server/.env`. Never commit. Never paste
  into docs. `.gitignore` already excludes `server/.env`.
- If a key has ever been written to disk anywhere unencrypted, **rotate it**
  on `https://openrouter.ai/keys`.
- `/api/chat` is unauthenticated by design (the data is public). The rate
  limiter is what stops cost abuse. If you ever expose the API beyond your
  trusted network, add a shared bearer token check in `chat()`.
- The system prompt explicitly rejects prompt-injection attempts
  (`"ignore previous instructions"`, role-overrides, etc.) and the
  groundedness check provides a second line of defence.
