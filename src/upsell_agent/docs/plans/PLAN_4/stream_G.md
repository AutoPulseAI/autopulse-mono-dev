# Stream G: grammar quality, prompt caching, and the GPT-5 switch

Client, 5 Oct 2026: "The AI was using very bad grammar. Not the context, it asks the right questions and deals
with the right people, but the grammar was bad. Caching should be there 100% in all workflows wherever AI is
involved." The team switched to GPT-5 mini.

## 1. Model switch (config.py, agent/llm.py)

- `MODEL_EXTRACT` / `MODEL_COMPOSE` default to `openai:gpt-5-mini` (env still overrides).
- GPT-5 is a reasoning model. Pydantic AI 2.49's `openai_reasoning_effort` is set per call by
  `llm.model_settings()`. The env vars are `REASONING_EFFORT_EXTRACT` and `REASONING_EFFORT_COMPOSE`, both
  defaulting to `minimal`, and they go only to reasoning models (`llm.reasons()`: gpt-5* except gpt-5-chat,
  and the o-series). No sampling parameters are sent. Pydantic AI also drops them for reasoning models.
- Reasoning tokens count as output. `run_agent` adds `REASONING_HEADROOM_TOKENS = 1500` to a reasoning
  model's output budget. Before this, Compose at `low` (600-810 output tokens) would have exceeded the old
  600-token limit and fallen back to the template.

### Measured latency (real gpt-5-mini, 4 Oct 2026, eval harness, cache warm)

| step | effort | per-call ms | output tokens |
|---|---|---|---|
| Extract | minimal | 1800-4700 (median ~2200) | 85-167 |
| Compose | minimal | 2340-3200 | 186-251 |
| Compose | low | 5700-7700 | 604-812 |
| Summary | minimal | 1430-1830 | 57-65 |

Whole turns (Extract + Compose + the rest) took 3.4-5.7 s, and 8.3 s when the guard asked for a rewrite.

Decision: Compose runs at `minimal`. At `low` it was 2-3x slower, and in one first reply it dropped a sentence
of Touch 1's required opening. New defaults: `EXTRACT_TIMEOUT_S` 3 -> 6, `COMPOSE_TIMEOUT_S` 5 -> 8,
`FIRST_REPLY_DEADLINE_S` 8 -> 15. With the old 3/5/8, ordinary turns would have gone out as the template.
`REPLY_DEADLINE_S` stays at 20. **Open item:** the 8 s first-reply deadline was a product decision, so the
client should confirm 15 s.

### Prices (`PRICES_PER_MTOK`: input / cached input / output, $ per 1M tokens)

gpt-5 1.25 / 0.125 / 10.00; gpt-5-mini 0.25 / 0.025 / 2.00; gpt-5-nano 0.05 / 0.005 / 0.40. The table keeps
the 4o / 4.1 rows and adds their cached prices. Source: OpenAI's published API pricing as known on 4 Oct
2026. **These must be checked against platform.openai.com/docs/pricing** (a comment in the code says so).

## 2. Caching

### Model prompt cache (OpenAI automatic prefix caching)

| agent | static prefix (tiktoken o200k) | cached on a warm call | notes |
|---|---|---|---|
| extract | 1748 instructions + ~1776 output schema | 4352 of ~4540 input tokens | |
| compose | 4305 instructions + ~749 output schema (writing rules included) | 4480 of ~6200 | |
| summary | 268 + ~91 (about 506 input tokens in total) | 0 | under OpenAI's 1024-token minimum |

- **Prefix order:** all three agents have fully static `instructions` (a unit test checks they contain no
  `{...}` placeholders), and the output tool schema is static. The only per-call text is the JSON user message,
  which comes last: customer text, context pack, `now`, names. Nothing had to move.
- **`prompt_cache_key`:** each agent sends a stable `openai_prompt_cache_key` (`autopulse-extract`,
  `autopulse-compose`, `autopulse-summary`; the prefix comes from `PROMPT_CACHE_KEY_PREFIX`).
- **Summary is not padded.** Its whole prompt is about 500 tokens and it runs once every few messages, so it
  costs about $0.0001-0.0002 a call either way. Padding it past 1024 tokens to get cache hits would save
  almost nothing and would add text the model doesn't need.
- **Proof** (cached tokens on repeat calls with the same prefix): the first Compose call after the instructions
  changed had `tokens_cached` 0, and every later call had 4480. Extract had 0 on the first call, then 2432 (a
  partial prefix match during the first run), then 4352 on every call. Example costs: Compose 0.00206 ->
  0.00098 USD, Extract 0.00147 -> 0.00043 USD.
- **Where the numbers are recorded:** `ModelCall.cached_input_tokens` comes from Pydantic AI's
  `RunUsage.cache_read_tokens`. It appears as `tokens_cached` in each step's metrics (shown in the Debug UI's
  Metrics tab as "Cached input"), in the turn log summary, in the summary run log and in `/metrics` `cost_usd`.
  Cost bills cached tokens at the cached price (`llm._cost`).

### Non-model caches that already exist (none added)

- Inventory search: 60 s TTL (`tools/inventory_tool.py CACHE_TTL_S`, cleared by the `clear_inventory_cache` job).
- Dealer profile: 60 s (`integrations/dealer_profile.py`).
- Dealer sending identity: 60 s (`channels/dealer_identity.py`).
- NHTSA recalls: 24 h per vehicle (`integrations/nhtsa.py`).
- State hours rules: `lru_cache` (`compliance/state_hours.py`).
- Agents and settings: `lru_cache` (`agent/llm.py`, `config.py`).

I found nothing that is fetched again on every turn without a cache.

## 3. Grammar

- **Compose instructions** have a new "Writing" block: complete grammatical sentences, agreement, articles,
  capitalization, final punctuation, spacing, American spelling, no all-caps, emoji or text-speak,
  contractions allowed, and one idea per sentence in an SMS. It also says the fixed wording is never
  "corrected", and gives a good and a bad example. Other prompt changes:
  - British spellings in the prompts are now American ("colour", "apologise").
  - The example "want details?" fragment was rewritten.
  - New rule: always write both `sms_text` and `email_body`. gpt-5-mini left `sms_text` empty for an email lead,
    so the guard rejected it twice and the template went out.
  - New rule: no second salutation above Touch 1's intro.
- **Guard** (`guardrails/grammar.py`, wired into `agent/nodes/guard.py` as check `grammar`): a deterministic,
  conservative rule set. It checks for:
  - a lowercase sentence or line start;
  - doubled words;
  - a space before punctuation;
  - a missing space after a sentence end or a comma;
  - a missing final punctuation mark (SMS only);
  - "i" on its own;
  - unbalanced parentheses or quotes;
  - a/an errors from known lists.

  Links, email addresses, abbreviations, inch marks and list markers are masked before checking. The client's
  mandated wording (`touch1.intro`, `touch1.ending`, `touch.fixed_text`) is exempt (`guard.mandated_wording`).
  A failure goes through the existing one-rewrite-then-template path. The spy run over all unit tests and
  evals flagged 0 offline drafts.
- **New guard check `touch1_opening_first`:** the SMS and the email must start with Touch 1's intro word for
  word. gpt-5-mini sometimes wrote "Hello Maria,\n\nHello Maria, greetings from..." and the offline model
  always did ("Hi Maria,\n\nHello Maria..."). The offline model is fixed.
- **Fixed / template text proofread.** Mandated wording was quote-checked against the PDFs with `pdftotext`
  and left unchanged: the Touch 1 intro and ending, "{FirstName}?", the day-before Y/N text, the no-show texts,
  Birthday, the anniversary question, "Thanks for letting me know! What are you driving now?" and the Sold
  Pending Week-4 recommended intent.
  - `templates.py`: commas before "and" in compound sentences. "Are you looking at new or used?" ->
    "Are you looking for a new or a used vehicle?" (SMS and email). The colon before the email's question
    became a comma.
  - `appointment.py`: "Perfect, thank you, {first}!" (vocative comma).
  - `sold_delivered.py`: "a day and time that suit you" (3 places).
  - `sold_pending.py`: the Week 2 run-on "...from us, and have any questions come up...?" is now two questions.
  - `cadence.touch1_intro` with no agent name: "Hello Maria from Sunrise Motors." read as if Maria were from the
    store. It is now "Hello Maria, greetings from Sunrise Motors in ...". With an agent name, the client's
    exact text is unchanged. Tests and architecture.md #150 are updated.
  - `offline_model.py`: fragments and Britishisms fixed:
    - "Worth a look?" -> "Would you like to take a look?"
    - "Anything I can help with?" -> "Is there anything I can help with?"
    - "a hand with" -> "help with"; "proper look" -> "good look"
    - "in one go" / "suit you" -> "all at once" / "works for you"
    - "Checking back in like you asked" -> "I'm checking back in, as you asked"
    - "cancelled. Happy to find another time whenever works." -> "canceled. I'm happy to find another time
      whenever it works for you."
  - `slots/schema.py`: two fragment explanations rewritten.
  - The opt-out confirmation and after-hours text were already correct.
  - `tests/unit/test_grammar_guard.py` runs every fixed message through the guard rule, along with good and bad
    examples, real AI lines from `docs/data/conversations.md` and a real gpt-5-mini reply.
- **Grammar eval** (`evals/test_grammar.py`): it runs 9 reply cases through the whole pipeline. Each reply is
  scored by a DeepEval G-Eval judge on grammar, spelling and punctuation only (`GRAMMAR_JUDGE_MODEL`, default
  gpt-4.1-mini, because G-Eval needs logprobs; `GRAMMAR_THRESHOLD` 0.8) and by the guard's mechanical rule.
  Offline it is skipped. The real run passed: G-Eval 0.83-0.92 across the 9 cases.
- **Harness fix:** `evals/harness.py` clears the cached agents for each case. Every case runs in its own event
  loop, and a cached OpenAI client failed with "Event loop is closed". Real-model evals were silently judging
  the template on some cases.

## Spend

About $0.10 of real calls in total (latency runs about $0.02, three grammar-eval runs, cache proofs, judge).

## Open items

- The client should confirm `FIRST_REPLY_DEADLINE_S` 15 s (was 8 s).
- Check `PRICES_PER_MTOK` against OpenAI's pricing page.
- Run the full real-model eval suite on gpt-5-mini (only the grammar eval and the measurement cases ran here).
- Add a per-day cache-hit rate to `/metrics` if wanted (tokens_cached / tokens_in is there now).
- `compose.yml` comments still name gpt-4o. I didn't touch them because the main checkout has uncommitted
  changes to that file.
