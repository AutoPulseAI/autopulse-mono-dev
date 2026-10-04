# Stream E: per-conversation cost and grammar measurement

Client (5 Oct 2026): "Calculate the cost - including when the AI extracts data and calls tools/APIs - in all
scenarios: e.g. 10 scenarios, 12-15 messages per conversation, across all the buckets." Plus: grammar was bad;
show grammar quality per conversation.

## What was built

- `evals/conversations/{credit,trade_in,general,service}.yaml`: 12 scripted conversations, 3 per bucket, 12-14
  customer messages each (plus the lead form). Lead sources are ones `agent/lead_bucket.py` knows (Capital One,
  700Credit, Credit Application; KBB, TrueCar SELL My Car, AccuTrade; CarGurus, AutoTrader, Facebook); service
  leads have no bucket. Covered: stock questions (inventory tool), price/payment, trade details and payoff,
  credit worries, booking and picking a time, rescheduling, an objection, "not interested" then a reason, an
  after-hours start (Tue 21:40), "can I talk to a person", short "ok"/"yes"/"k", two typo-heavy customers, and
  one Spanish-speaking customer (the system has no Spanish support: that conversation measures what such a
  customer gets today).
- `evals/conversation_cost.py` (`python -m evals.conversation_cost`): per conversation, a fresh mongomock
  database seeded with `devtools/seed.seed()` (dev dealers, platform dealer records, dev stock), a lead with the
  conversation's source, then `handlers.handle_lead_created` and one `handlers.handle_inbound_message` per
  customer message (2 minutes apart on the dev clock), the same path the worker and `evals/harness.py` use, with
  the fake channel driver and stub platform. A rolling-summary job a turn queues is run inline right after it.
  - AI calls are recorded by wrapping `pydantic_ai.Agent.run` (every pipeline call goes through it): step
    (extract / compose / retry = a second Compose in the same turn / summary / other), model, input, cached input
    (`usage.cache_read_tokens`, read defensively), output and reasoning tokens, latency, cost.
  - Tools: `StubInventorySource.search` (inventory queries, including VIN lookups and loosening steps),
    `StubPlatformClient.create_booking` / `update_booking` (booking calls), and the turn log's `search_stock`
    node (stock searches). The inventory tool's 60s cache is cleared before each turn (messages are minutes
    apart in real life).
  - Per turn from the turn log: outcome, guard retries, template fallback and reason, staff flag, after-hours
    mode; plus every outbound message text (`ai_messages`).
  - Cost: own price table (USD/1M: input, cached input, output; GPT-5, 4.1, 4o families); a 3-price row in
    `agent/llm.py PRICES_PER_MTOK` (stream G) wins; `--prices file.json` overrides both. Cached input is billed at
    the cached rate; reasoning tokens are part of output.
  - Grammar: stream G's judge if `evals/` has one (tries `evals.grammar`, `evals.grammar_judge`,
    `evals.metrics.grammar`, ... with `judge_conversation` / `judge_grammar` / `grade` ...; accepts a score, a
    dict with score/issues, or a list per reply); else a mechanical check in the guard if one exists; else a
    small LanguageTool-free heuristic (`heuristic_issues`: doubled words, lowercase sentence start / "i", spacing
    around punctuation, a/an, missing end punctuation, unfilled template slots). `--grammar off` gives "n/a".
  - Budget: stops when the spend so far, or the projection for the remaining conversations, passes `--budget`
    (default $5). An OpenAI authentication error stops the run (no retries).
  - Knobs for measuring a model before the pipeline is tuned for it: `--reasoning-effort` (GPT-5 only, applied
    only when the pipeline passes no model settings itself), `--extract-timeout`, `--compose-timeout`,
    `--max-messages`, `--only`.
- Reports in `evals/reports/conversation_cost/` (un-ignored in `.gitignore`): Markdown (client summary with
  monthly projections for 100 / 500 / 1,000 conversations per dealership, by bucket, by conversation, by AI step
  with calls over the production timeout, grammar flags, full transcripts), `_calls.csv` (one row per AI call),
  `_conversations.csv`, and the raw `.json`.

## How to run

    cd agentic-upsell
    python -m evals.conversation_cost --model-extract offline --model-compose offline --out evals/reports/conversation_cost
    python -m evals.conversation_cost --model-extract openai:gpt-5-mini --model-compose openai:gpt-5-mini \
        --reasoning-effort minimal --extract-timeout 15 --compose-timeout 20 --out evals/reports/conversation_cost

(With the worktree's own venv missing: `PYTHONPATH=src:. <repo>/agentic-upsell/.venv/bin/python -m ...`.)

## Results

Offline run (free): `evals/reports/conversation_cost/conversation_cost_offline_20261004-0026.md`, 12 conversations,
258 calls, proves the harness.

Real run, `openai:gpt-5-mini` for extract and compose, reasoning effort `minimal`, timeouts 15s/20s:
`evals/reports/conversation_cost/conversation_cost_openai-gpt-5-mini_20261004-0029.md` (+ CSVs, JSON). Spent $0.21.

| | All | credit | trade-in | general | service |
|---|---|---|---|---|---|
| Cost per conversation (as run) | $0.0176 | $0.0177 | $0.0237 | $0.0132 | $0.0159 |
| Cost per AI reply | $0.0026 | $0.0027 | $0.0027 | $0.0025 | $0.0025 |
| Cache hit (of input tokens) | 48.6% | 49.1% | 46.4% | 51.1% | 49.5% |

- A conversation the AI answers end to end (~14 replies, no handoff): about $0.037. 1,000 conversations/month per
  dealership: $18 as run, $37 upper bound. Cost is ~90% input tokens (~13k input tokens per turn across extract +
  compose); compose 51%, extract 39%, guard retries 11%. Tool/API calls (inventory, booking) cost no AI tokens.
- 81 replies for 156 customer messages: 11 of 12 leads went to staff mid-conversation (handoff, "not interested",
  template fallback twice -> flagged for staff); after that the AI makes no calls. 8 template fallbacks, 15 guard
  retries.
- Latency: extract p50 1.7s / p95 2.9s, compose p50 3.1s / p95 5.7s; whole turn p50 5.2s / p95 10.2s. With the
  production timeouts (3s / 5s) 14 of 176 calls would have timed out. With the model's default reasoning effort
  (a trial before the run) every extract call timed out at 3s: the build needs stream G's reasoning-effort setting
  and timeouts before gpt-5-mini can go live.
- Grammar: the mechanical heuristic flags almost nothing (1 false positive); the problems are coherence and
  repetition, not spelling. Examples (verbatim): "Hello Helen from Sunrise Motors ... I am excited to help you with
  your purchase. What year, make and model is your vehicle? Tell me, what are you driving now?" (service lead);
  "The 2022 Toyota RAV4 XLE we have is a 2022 Toyota RAV4 XLE, used, Blue, 31,200 miles (VIN DEV77104D87E42D2C)";
  "Just to confirm — your vehicle model is Wrangler Unlimited Sahara, right?" (five turns in a row); "Is that your
  final payoff owed, $24,000?" (Carvana offer misread as payoff); "this is Alex from the sales team" (invented
  name); "We have a few 3-row options. A 2025 Toyota RAV4 XLE Hybrid ..." (RAV4 is not 3-row); "Yes — possible ...
  our finance team works with credit scores around 580"; fallback "Are you looking at new or used?" right after the
  customer said used; the Spanish customer got one English template and then nothing.

## Open items

- Stream G's grammar judge: the harness imports it defensively; rerun with `--grammar judge` once it lands (its
  function name should match one the adapter tries, see `_find_grammar_judge`).
- Cadence follow-up touches (Day 1-90) and the summary job are not in these numbers (no conversation was long
  enough to trigger a summary); a run with longer threads would add them.
- The many staff handoffs make "cost per conversation" low; the end-to-end figure is the safer number to quote.
