# Master Plan 4: Real-model timing

> **What this is:** on 29 Sept 2026, the OpenAI key was replaced with a working one, and the AI pipeline
> ran against real GPT models for the first time in this project. That run measured real latency and found
> the pipeline's own internal timeouts were tighter than real models need - every real-model turn was
> silently falling back to the template. This plan records that finding and what to do about it.
>
> **Scope rule for this file (set by the user, 29 Sept):** only write down a requirement here if the client
> actually stated it somewhere in `docs/client/` or `docs/data/`. Anything below that isn't a client
> requirement is labelled as ours, not theirs.

---

## What was found

Timing a real Extract call (`openai:gpt-4o-mini`) and a real Compose call (`openai:gpt-4o`) directly, from
inside the running `ai-api` container, with the actual production prompts:

| Step | Measured | The pipeline's old budget | Result |
|---|---|---|---|
| Extract | 3.1-3.7s model time | `EXTRACT_TIMEOUT_S` = 3.0s | Timed out almost every time |
| Compose | ~3.1s model time | `COMPOSE_TIMEOUT_S` = 5.0s | Passed, but with little margin |
| Both together, first reply | ~8.2s wall time | `FIRST_REPLY_DEADLINE_S` = 8.0s | Over budget |

`EXTRACT_TIMEOUT_S` / `COMPOSE_TIMEOUT_S` / `FIRST_REPLY_DEADLINE_S` were set in MASTER_PLAN_2 (architecture
decisions on AI call budgets), before this project ever had a working OpenAI key to test against. They were
never wrong on paper; they had simply never been checked against a real model's actual speed until now.

**Fixed already (29 Sept), in `agentic-upsell/.env` only, no code change:**
```
EXTRACT_TIMEOUT_S=8
COMPOSE_TIMEOUT_S=8
FIRST_REPLY_DEADLINE_S=20
```
With these, a real first reply completes end to end (`load_context → extract → validate → search_stock →
decide → compose → guard → send → schedule`) instead of falling back to the template.

---

## Is there a client-stated speed requirement? Yes - and it isn't 8 seconds

Checked every client document (`docs/data/conversations.md`, `conversation_2.md`, `conversation_3.md`,
`pdf_dump.txt`, both TCPA/omnichannel PDFs, `docs/client/autpulse.workflowblueprint.png`) for any mention of
required speed. One exists, and it's from the client's own blueprint image, section **3A, "NO-RESPONSE
CADENCE," Day 1 Touch 1**:

> **"Within 60 Seconds - First Quality Response"**

That is the client's actual, stated requirement: the first reply must go out within 60 seconds of the lead
arriving, not within 8. `FIRST_REPLY_DEADLINE_S = 8.0` was never a client number - it was this project's own
internal engineering target, set in MASTER_PLAN_2 before either a real model or a client speed requirement
existed to check it against. Nothing else in any client document mentions seconds, response time, latency,
or an SLA of any kind.

**What this means in practice:** the ~8-10 second real-model latency measured above is comfortably inside
the client's real 60-second bar, with roughly 5-6x headroom. The tension raised earlier in this session (raise
`FIRST_REPLY_DEADLINE_S` and accept ~8-10s, vs. keep 8s and use faster models, vs. keep 8s and let it fall
back to the template) turns out to be a false choice created by an internal number that was never the actual
requirement. There is no need to choose a faster model or accept more template fallbacks to hit 8 seconds,
because 8 seconds isn't what the client asked for.

---

## Decided

1. **`FIRST_REPLY_DEADLINE_S` is raised from 8.0 to 20.0** (already done, in `.env`). This is comfortably
   inside the client's 60-second requirement even accounting for network variance, the send step, and a
   guard rewrite. **Not raised all the way to 60s**: the 20s ceiling still leaves the system itself well
   under the client's bar rather than running right up against it, and it matches MASTER_PLAN_2's existing
   "20s for replies after the first" budget, so first replies and later replies now share one number instead
   of needing two.
2. **`EXTRACT_TIMEOUT_S` = 8, `COMPOSE_TIMEOUT_S` = 8** (already done, in `.env`). Each real call measured at
   3.1-3.7s, so this is roughly 2x headroom per call for a slow response, a retry, or a longer conversation's
   larger prompt - without letting one slow call alone burn through the whole 20s reply budget.
3. **The client's 60-second requirement should be the one written into `architecture.md`'s decisions and
   `docs/report/`**, replacing the internal 8-second figure wherever it's quoted as if it were a client
   promise. That correction is not made in this file; it's listed here as a follow-up so it's not lost.

## Not decided, needs the client (or a deliberate internal call, not a quiet one)

- Whether 20 seconds is the right internal ceiling, versus something else under 60. This plan sets 20s as a
  reasonable buffer, not as a re-derived client number - nothing in any client document names a number
  between 8 and 60.
- Whether the *template* fallback (used when even 20s isn't enough - a slow provider, a network issue) is
  still an acceptable "first quality response" under the client's 60-second rule, or whether it should count
  only once a real AI reply goes out. Today's design already tries to guarantee something is sent well inside
  60s either way (template replies typically go out in under 2 seconds); this is a policy question, not a
  timing one.

## Not in this plan

- Re-timing Compose for longer or more complex conversations (only the first-reply case was measured here).
- Any change to the guard, retry, or grounding logic - this plan is purely about the three timeout settings
  above and what the client actually asked for regarding speed.
