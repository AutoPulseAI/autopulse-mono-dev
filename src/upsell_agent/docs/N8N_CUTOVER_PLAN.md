# Replacing n8n's reply-generation role with this service

Scope: the three live n8n call sites that generate a reply and a lead-status
decision — `N8N_EMAIL_API`, `N8N_SMS_API`, `N8N_LEAD_API` (see
`docs/architecture/architecture.md §6` and `N8N_INTEGRATION_MAP.md`). **Write
with AI** (`N8N_WRITE_WITH_AI_API`) and **Translation** (`TRANSLATION_THIRD_PARTY_URL`)
are explicitly out of scope — they're simple, single-shot, low-stakes calls
with no memory/hallucination risk, and there's no reason to migrate what n8n
already does adequately.

## What actually changes, and what doesn't

| Stays exactly as-is | Moves from n8n to this service |
|---|---|
| Inbound capture (`/api/system`, `/api/system/sms`), S3/.eml handling, Twilio webhook | "What should we say back, and what's the lead's new status" |
| Sending the reply (SMTP/SES/Mailgun, Twilio) | |
| `Lead`/`Email`/`Customer` persistence | |
| Follow-up scheduling (`FollowUpJob`) | |
| DealerSocket work notes | |
| Appointment booking/reminders | |

The Node worker files (`emailWorker.js`, `processSms.js`, `leadworker.js`)
keep every responsibility they have today **except** the `callOllama()` call
(the function name is a leftover misnomer — it calls n8n, not Ollama; see
`docs/architecture/architecture.md`'s Known Caveats). That one call is
replaced with a call to this service.

## New contract (draft — needs review before any Node code changes)

n8n's current response shape (`create_lead`, `update_lead`, `fe_lead_status`,
`response`, `preferred_communication_mode(_selected)`, `preferred_communication_mode_old_messageID`,
...) is exactly the JSON `emailWorker.js`/`processSms.js` already parse. Two
options:

1. **Match n8n's existing response shape exactly.** Zero changes to the
   Node-side parsing logic — only the URL/payload sent to reach it changes.
   Lowest-risk cutover, but locks this service into a JSON shape optimized for
   n8n's node graph, not for this service's own (arguably clearer) domain
   model (`AgentState`, `qualification.py`'s types).
2. **Define a new, cleaner contract** (closer to `AppointmentOffer`/`CustomerObjective`
   than to n8n's flat fields), and update the three Node call sites to parse
   it. Cleaner long-term, but touches live message-sending code in three
   places at once.

**Recommendation: option 1 for the cutover itself, option 2 as a follow-up
refactor once the new service is proven in production.** Don't couple "swap
the AI backend" with "redesign the API contract" in one risky change — do them
sequentially. Concretely: `api/routes.py` gains a response-shaping layer that
translates this service's internal `AgentState`/`AppointmentOffer` into
n8n's exact existing JSON keys, so `emailWorker.js` et al. need only their URL
changed, not their parsing logic.

## Rollout — per-dealer shadow mode, not a flag day

Given the stakes (this generates the actual message sent to a customer), a
big-bang cutover is the wrong risk profile. Recommended sequence:

1. **Shadow mode.** For every inbound message, call BOTH n8n and this service.
   Send n8n's response as today (nothing customer-facing changes). Log this
   service's response alongside it (Langfuse trace + a comparison record) but
   don't act on it. Run for long enough to compare reply quality, latency, and
   grounding-check trigger rate across real traffic before anyone reads the
   Python-generated replies as "real."
2. **Per-dealer opt-in.** A `User.dealer_account_information` flag (or similar
   — matches the existing per-dealer settings pattern, e.g.
   `setting.autoReplyEnabled`) lets specific dealers' traffic route to this
   service for real, while every other dealer keeps using n8n. Start with one
   low-volume, engaged dealer who'll actually read and flag bad replies.
2. **Compare against the eval suite continuously**, not just once before
   launch — every dealer added to the new path is effectively new production
   traffic the hallucination/quality evals should be re-run against.
3. **Keep n8n as the fallback path** (not deleted, not deactivated) until
   confidence is high across enough dealer-months of real traffic. The
   `callOllama()` call site becomes a simple branch: this service if the
   dealer's flag is on, n8n otherwise — trivial to revert per-dealer if
   something goes wrong.
4. Only after that: decide whether to decommission the three n8n workflows,
   or keep them as a documented disaster-recovery fallback.

## Why not touch the Node worker files yet

They're live, they send real customer messages, and the new service doesn't
have a proven contract or graph implementation yet (see `agent/graph.py`'s
TODOs). Wiring the cutover before the graph nodes are real and tested would
mean shipping `NotImplementedError` into the customer-reply path. The correct
order is: finish the graph → eval it → shadow-mode it → THEN touch
`emailWorker.js`/`processSms.js`/`leadworker.js`.
