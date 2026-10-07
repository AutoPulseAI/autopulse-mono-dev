# agentic-upsell — Architecture

> **Revision 6.** Rewritten around the four jobs this service actually has.
> Earlier revisions designed a reply-only chatbot with inventory lookup,
> booking and upselling. Those are out of scope for now (§11).

---

## 1. What this service does

AutoPulse is the AI and automation layer for dealers. It has four jobs:

| # | Job                                   | In one line                                                                                           |
| - | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1 | **Instant first reply**         | A new lead arrives by SMS or email, and we reply straight away on the same channel.                   |
| 2 | **Collect customer info**       | We ask questions until the customer's profile slots are filled. Code decides what to ask, not the AI. |
| 3 | **Reply to campaign responses** | The dealer creates and sends a campaign. When a customer replies, the AI answers.                     |
| 4 | **Switch channel on silence**   | No reply after 1 day, so we send the same message on the other channel.                               |

**Boundaries:**

- **The DMS is inbound only.** It sends us leads (sales, service, trade-in) and they are already saved in the database. We never write back to the DMS.
- **Outbound goes through Twilio (SMS) and SendGrid (email)** and nothing else.
- **Campaigns belong to the dealer.** The dealer picks the leads, writes the campaign and sends it. The AI only handles the replies.

---

## 2. The main rule: code decides, AI writes

The AI is good at two things: understanding messy customer text and writing
natural messages. Everything else is plain code, so it behaves the same way
every time.

| Decision                                                             | Who makes it                                        |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| Which lead type this is                                              | Code, from the lead source. AI only as a tie-break. |
| Which slot to ask about next                                         | **Code**                                      |
| Whether the profile is complete                                      | **Code**                                      |
| What value the customer gave ("about 60k miles" →`mileage=60000`) | AI extracts it,**code validates it**          |
| The wording of the message                                           | AI                                                  |
| When to send, on which channel, whether to resend                    | **Code**                                      |
| Whether a message makes up a price, approval or trade value          | **Code** (already built)                      |

---

## 3. The big picture

```
 DMS ── new lead ───────────┐
 Twilio / SendGrid ─ reply ─┤   (customer replies, incl. campaign replies)
                            ▼
                 ┌──────── Queue (Redis) ────────┐
                 ▼                               │
        ┌─────────────────┐   schedule/cancel   ┌┴──────────────┐
        │ LEAD HANDLER    │◀──────────────────▶│  SCHEDULER    │
        │ (code, one lead │                     │  1-day check, │
        │  at a time)     │                     │  channel swap │
        └───────┬─────────┘                     └───────────────┘
                ▼
        ┌─────────────────┐     ┌─────────────────┐
        │ SLOT ENGINE     │────▶│ MESSAGE WRITER  │
        │ (code)          │     │ (AI + checks)   │
        └─────────────────┘     └────────┬────────┘
                                         ▼
                                ┌─────────────────┐
                                │ SENDER          │── Twilio (SMS)
                                │ (code)          │── SendGrid (email)
                                └─────────────────┘

   MongoDB holds everything. Every record and every query carries dealer_id.
```

---

## 4. Job 1 — Instant first reply

1. A new-lead event arrives from the DMS.
2. We load what the database already knows about this customer (§5.2).
3. The Slot Engine picks the first missing slot to ask about.
4. The AI writes one short message: acknowledge the lead, answer what they
   asked if we can, and ask at most two questions (MASTER_PLAN_3 Bq).
5. We send it on the **same channel the lead came from**, and schedule the
   1-day follow-up (§7).

**Speed:** the message goes out immediately, with no waiting for business
hours. The first reply uses **one AI call**. If the AI is slow (over 5s) or
fails, a prepared template for that lead type goes out instead. A new lead
never waits.

---

## 5. Job 2 — Collect customer info (slots)

### 5.1 The slots

The profile covers the customer's vehicles and their history with **any**
dealer, not only this one. If they say "I bought it at Smith Toyota", that's
saved as a value (`dealer_name = "Smith Toyota"`). It never gives us access
to another dealer's data.

| Group                                      | Slots                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Vehicles owned** (one per vehicle) | year, make, model, trim, mileage, purchase date, bought from (dealer), new/used when bought |
| **Service history** (per vehicle)    | service type, date, done at (dealer)                                                        |
| **Trade-in**                         | has trade (yes/no), which vehicle, mileage, condition, payoff owed                          |
| **What they want now**               | lead type, new/used, model, budget or monthly payment, timeline                             |
| **Appointments**                     | date, purpose, dealer                                                                       |
| **Contact**                          | preferred channel, best time to reach                                                       |

Past leads and communications are already recorded by the platform. We
**read** them for context and don't ask for them.

### 5.2 Required slots per lead type

| Lead type | Must be filled before handing to the dealer                        |
| --------- | ------------------------------------------------------------------ |
| Sales     | new/used, model, budget or payment, timeline, has trade            |
| Trade-in  | trade vehicle (year/make/model), mileage, condition, payoff        |
| Service   | vehicle (year/make/model), mileage, service needed, preferred time |
| General   | lead type becomes clear, then follow that row                      |

"Has trade" is asked on **every** sales lead. If it's yes, the trade-in slots
are required too.

### 5.3 How one turn fills slots

1. **Start from what we have.** Load the database record and existing slots. Never ask for something already known and current.
2. **Extract.** The AI reads the customer's message and returns values in a fixed typed format.
3. **Validate (code).** Check types, allowed values and ranges (year 1980–next year, mileage ≥ 0, and so on). Invalid or unsure values aren't saved. The next message asks the customer to confirm.
4. **Save** with its source (§8). A newer value replaces an older one, and the old one is kept as history.
5. **Pick the next step (code), in order:**
   1. The customer asked something, so answer it (honestly, §8).
   2. A required slot is missing, so ask for it (at most 2 questions per message).
   3. All required slots are filled, so mark the lead **qualified** and notify the dealer.
6. **Write.** The AI phrases the message for that step.

The same input always leads to the same next question. That's what
"deterministic" means here.

---

## 6. Job 3 — Replying to campaign responses

- The dealer creates the campaign in the platform, picks the leads and sends it. The AI takes no part in that.
- Each campaign message is stored with its campaign ID and goal.
- When a customer replies, the Lead Handler sees the reply belongs to a campaign. The AI then gets the **campaign message and goal** as context, together with the customer's slots.
- From there it's a normal conversation: answer, then keep filling slots (§5.3).
- **Bursts:** a campaign to 1,000 leads can bring hundreds of replies in minutes. Replies wait in the queue, and each dealer has a cap on how many run at once. So one dealer's burst can't slow down the others. Replies can slow down for a few minutes, but they don't fail.

---

## 7. Job 4 — Switching channel on silence

- After every message we send, the Scheduler saves one record: `{lead, due = now + 1 day, message, from_channel}`.
- When it's due and the customer **hasn't replied on any channel**, we send the same message on the other channel (SMS ↔ email). This only happens if we have that contact and the customer hasn't opted out.
- **Any reply from the customer cancels all pending follow-ups for that lead.** One rule, in code.
- A message is switched **once**. We don't bounce back and forth.
- The Scheduler checks only records that are due, using an index on `due`. It never scans all leads.

---

## 8. Safety rules (kept from earlier revisions)

- **Never invent** prices, trade-in values, finance approvals or availability. Those numbers always come from the dealer's team. This check is already built (`guardrails/never_invent.py`). If a message fails it, the AI rewrites once. If it fails again, a safe template goes out and the lead is flagged for a human.
- **Only the customer's words become slot values.** The AI's own messages and guesses are never saved as facts. Every slot records whether the customer said it, the AI extracted it (linked to the exact message), or it came from the database.
- **Customer text is data, not instructions.** "Ignore your rules and…" doesn't change behavior.
- **Hand to a human** when the customer asks for a person, is upset, or we hit a limit.
- **Hard limits per message:** AI calls, time and cost are capped. Hitting a cap means the safe template plus a flag, never a silent failure.
- **Dealer isolation:** every database read and write goes through one layer that requires `dealer_id`. A test tries to read another dealer's customer and must fail.
- **Opt-out:** STOP (SMS) and unsubscribe (email) are respected before every send, including follow-ups.

---

## 9. Where data lives

| Store                           | What                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| MongoDB `customer_slots`      | Slot values with source, time, and "replaced by" history                                                                  |
| MongoDB `messages`            | Every inbound and outbound message, saved as it happens, with channel and campaign ID                                     |
| MongoDB `scheduled_followups` | Pending 1-day follow-ups (indexed on `dealer_id` + `due`)                                                             |
| MongoDB `ai_turn_log`         | What the AI saw, extracted and wrote, plus cost, for every turn                                                           |
| Redis                           | The work queue, and LangGraph's latest state per conversation (expires after 7 days idle, rebuilt from MongoDB if needed) |

---

## 10. Tech choices

| Choice                                                                                   | Why                                                                                                        |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **LangGraph** for one reply turn (extract → validate → decide → write → check) | Clear steps, saved state, easy to trace.                                                                   |
| **Plain code + MongoDB** for the lead lifecycle and scheduler                      | These live for days. They're timers and records, not graph steps.                                          |
| **Two models**                                                                     | A cheap, fast model for extraction. A stronger one only for writing messages. This is the main cost lever. |
| **Langfuse**                                                                       | A trace of every turn, also copied to `ai_turn_log`.                                                     |
| No vector DB, no MCP                                                                     | Every lookup is "this customer at this dealer", and only this service uses the tools.                      |

---

## 11. Not in scope now

Upselling, inventory search, booking appointments through the bot, pricing and
finance offers, sending or targeting campaigns, and writing to the DMS. The
older multi-stage reply checks (support score, behavior check) are also out
until real traffic shows they're needed.

---

## 12. Status

**Built:**

- Fact model with source and replace-history (`agent/qualification.py`)
- Never-invent check
- Service-to-service auth
- Latest-only Redis state with idle expiry
- Dealer-scoped Mongo layer (in progress)

**To build:**

- Slot schema and Slot Engine (§5)
- First-reply path with template fallback (§4)
- Campaign reply context (§6)
- Scheduler (§7)
- Twilio and SendGrid sender and inbound webhooks
- Per-dealer queue limits

**Needs changing:** `LeadType` in `agent/qualification.py` still has the old
types (`credit`, `price_payment`, `service_interval`). Change it to
sales / trade-in / service / general.

---

## 13. Open questions

1. **Sending outside business hours.** "Immediately" includes nights. US TCPA rules limit texts before 8am and after 9pm in the customer's time zone. This needs a legal answer before launch.
2. **After the channel switch.** If they still don't reply on the second channel, do we stop, or keep following up on some schedule?
3. **Campaign messages and the 1-day switch.** Does a campaign message the customer never answered also get re-sent on the other channel?
