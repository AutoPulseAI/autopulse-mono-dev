# Plan 3 notes: 29 September 2026

Branch `plan_3b`. Final Part B readiness check. Recorded in `docs/architecture/architecture.md` §15 (decision 66 corrected, decisions 72–73) and `docs/plans/PLAN_3/MASTER_PLAN_3.md` (B3 item 7, C1 item 3). Follows `docs/report/28-9-26/NOTES.md`.

## Decided today

### 1. Campaign texts: the platform sends, the AI service only checks (decision 66, corrected)

- **Correction:** the 28 Sept wording had the AI service sending campaign texts and writing the result onto the platform's `CampaignLead`. That was wrong. Campaign texts are the dealer's, sent by the platform as today. They only pass through the send check first.
- **Why it matters:** when the platform's campaign worker sends, it also records the Twilio message id and sets the delivery callback that updates "delivered" / "failed" on the campaign report. If the AI service sent instead, it would have to write those platform records. We don't let the AI service change platform data.
- **How it works:**
  1. When a campaign fires, the platform's campaign worker writes one check request per lead into a shared queue collection.
  2. The AI service runs the full send check and writes its answer onto **that queue entry only**.
  3. The worker reads the answer:
     - **ALLOW:** it sends exactly as today;
     - **HOLD:** it re-queues that lead for the given time;
     - **BLOCK:** it marks the lead "blocked" with the reason on the campaign report.
- An ALLOW counts toward the 3-per-24-hours limit as soon as it's given, so two senders can't both slip in before the real send.
- If the AI service is down, requests wait in the queue.
- The campaign report changes from 28 Sept are unchanged: `held` / `blocked` statuses, the time and the reason.

### 2. REVIEW is kept, and resolved without a new screen (decision 72)

- **Did the client ask for it? Yes.** The TCPA spec says: "If a statement may reasonably be an opt-out, stop automated marketing and route to REVIEW rather than letting the AI persuade the customer" (p.2, "Ambiguity"), and "If context makes revocation ambiguous, use REVIEW and stop automated marketing while unresolved" (§3). Its required `can_contact` returns `ALLOW | HOLD | REVIEW | BLOCK`.
- **How it's resolved (the platform has no review screen, and none is built):**
  - staff get a notification quoting the customer's message;
  - marketing stays stopped until the customer writes again with something that isn't an opt-out (our reply to them is allowed anyway), or an admin uses the existing "resume AI" action on that lead;
  - if staff decide it really was an opt-out, they set the lead to "DND", which counts as do-not-contact (decision 68).

### 3. Consent-ask email: withdrawn for now (decision 73)

Confirms decision 67. The client never asked for it. Contacts without texting consent get email only.

## C1 readiness review (later today)

C1 is the compliance engine: the one send check every message goes through. Four decisions were open; all are now recorded (architecture.md decisions 74–77, MASTER_PLAN_3 C1 and B0.4).

### 1. Detecting natural-language opt-outs (decision 74)

- Today only a message that is exactly a keyword ("STOP") is caught.
- Added: a fixed phrase list in code ("don't text me", "leave me alone", "take me off your list", "stop contacting me", …). A match is an opt-out.
- The Extract step flags a *possible* opt-out with a confidence, and code sends it to REVIEW. The model can only make things stricter, so it never grants consent.
- "I'm not interested" is an objection, not an opt-out (TCPA spec §3).

### 2. What an opt-out covers, and the confirmation (decision 75)

- **The question:** why not make "stop contacting me" or "leave me alone" channel-only too?
- **Answer:** those phrases don't name a channel.
  - If the customer texts "leave me alone" and we keep emailing them, we're contacting someone who told us to stop. That's the complaint the rule exists to prevent.
  - The TCPA spec says to suppress immediately on these exact phrases (§3).
  - The FCC's 2024 rule lets a customer revoke consent "by any reasonable means"; they don't have to use our channel or our words.
  - When the customer *does* name a channel ("don't text me", "stop emailing me"), we follow it and stop only that channel.
- **Recorded:**
  - keyword STOP and channel-named phrases stop that channel only;
  - general phrases stop all channels;
  - **flagged:** if you still prefer channel-only for general phrases, it's a one-line change to the rule.
- **Confirmation (agreed):** a natural-language opt-out gets one plain, non-marketing message on its channel ("Understood, we won't contact you again."). A keyword STOP gets none from us, because the carrier already sends one. Counsel reviews the wording later.

### 3. The AutoTrader consent flag (decision 76)

- A bare `TCPAOptIn: true` is kept as evidence with status "review required", not counted as consent. The client's spec says not to rely on a third-party yes/no alone (§6).
- This only affects platform campaigns: follow-ups on the customer's own inquiry are still allowed. `TCPAOptIn: false` still blocks.

### 4. Record keeping (decision 77)

- Consent and the per-send compliance log are add-only: a change adds a new entry and never edits an old one. Today consent is overwritten in place.
- Both are kept for 5 years, longer than the TCPA's 4-year window for lawsuits. Counsel may change this.

**C1 verdict:** ready to build, after Part A (the agreed build order). The only flag is the opt-out scope above.

## C1 shipped (evening)

C1 is built, with B2 (inbound or outbound) and B3 (the US sending rules) inside it. Every message now goes through one send check before it leaves. The check answers **send now**, **wait until a time**, **needs review**, or **blocked**, and gives the reason. Details: `progress_3.md` "Phase C1"; decisions 78–86 in architecture.md.

### What you asked before I built it

- **Scope:** all of B2 and B3 go into C1.
- **ZIP → time zone:** a pip package (`zipcodes`). `phonenumbers` handles area codes.
- **A possible opt-out:** a plain reply, no questions, no offers.
- **The handoff check's "sorry for the wait":** transactional. It needs no marketing consent and doesn't count toward the limit.
- **REVIEW threshold:** 0.5.
- **The 3-a-day limit:** texts only.
- **Platform files:** I may edit Prashanth's four campaign files, for this change only.

### What the send check does now

- **Night-time replies.** A customer who wrote to us gets an answer at any hour when they started the conversation (a web lead). When we started it (a campaign reply, a DealerVault contact), a night-time reply asks nothing and says the team picks up at 8:00.
- **Our own texts** (the 24-hour switch to the other channel, the handoff check) wait until it's 8:00 where the customer lives and the dealership is open.
  - The customer's time zone comes from their DealerVault ZIP, else their state, else their phone's area code.
  - If none of those is known, the text waits until it's 8:00 in every US time zone. That's 11:00 New York.
- **Consent for marketing texts:**
  - the customer texted the dealer (the platform's opt-in flag); or
  - it's our follow-up on their own inquiry (within 91 days).
  - A lead-form "yes" alone needs review. With none of these: blocked, and email still goes.
- **At most 3 marketing texts a day per customer**, counting the AI and campaigns together.
- **Opt-outs:**
  - "stop contacting me" or "leave me alone" stops every channel;
  - "don't text me" stops only texts;
  - each of these gets one "Understood, we won't contact you again."
  - STOP gets nothing from us (the carrier confirms).
  - "I'm not interested" is not an opt-out.
- **Records:** consent is now a history that's never edited. Every decision is logged with its reason and kept 5 years.

### The platform changes (aidmvcs-be-dev), as you asked to see them listed

| File | Owner | Change |
|---|---|---|
| `app/worker/campaignWorker.js` | Prashanth (approved) | Before each campaign **text**, asks the send check and waits up to 20 s. Allowed: sends exactly as before. Wait: the lead becomes "held" and is tried again at that time. Blocked or needs review: the lead becomes "blocked" with the reason, nothing is sent. No answer yet: tried again in 60 s. A held lead counts as not finished, so the campaign isn't marked complete early. |
| `app/models/CampaignLead.js` | Prashanth (approved) | Status can also be `held` or `blocked`; new fields `held_until` and `block_reason`. |
| `app/api/campaigns/[id]/report/route.js` | Prashanth (approved) | Counts held and blocked leads; each lead carries its held time and reason. |
| `app/dealer/campaigns/[id]/report/page.js` | Prashanth (approved) | Two new count cards ("Held until…", "Blocked"), badge colours, both in the status filter, the time or reason on each lead, and two new CSV columns. |
| `app/lib/ai/aiSendCheck.js` | new file | Writes the request into the shared `ai_send_checks` collection and waits for the answer. |
| `test-ai-send-check.js` | new file | Tests for the above; added to `make platform-test`. |

The AI service never sends campaign texts and never writes platform records. It only writes its answer onto the request.

### Things I decided while building (please look at these)

1. **Email is never held for time of day**, not even for dealer hours. B3 says "email: no time limit", but decision 24 says messages we start follow dealer hours. I followed B3.
2. **`sms_opt_in: false` now only stops our marketing texts.** A reply to the customer still goes (the rule agreed on 27 Sept). Before today it stopped every text.
3. **The REVIEW notice for staff** is saved on the AI's record of the lead, not shown on a platform screen. Showing it there needs another platform change.
4. **Campaign emails are not checked**, only campaign texts (decision 66's wording).
5. **The real lead sources couldn't be read.** The local database only has test leads. The inbound/outbound list follows what the platform code writes. Anything unknown counts as outbound and is listed in `GET /v1/metrics` under "unmapped lead sources".
6. **Dev test customers have fake 555 numbers and no ZIP**, so in the Debug UI their texts wait for 11:00 New York time. One scenario (`p2_handoff_timeout`) now starts at 11:30 instead of 10:00 because of this.

## Verdict

**Part B's decisions are complete. Nothing in Part B is open.** It is ready to build once C1 (the compliance engine, which contains B2 and B3) is built.
- **Build order:** C1 (**done, evening**) → Bq (two questions per message) → B1 → B5 → B4.
- **Known gaps (accepted, see 28 Sept NOTES):** old platform reminders after an AI move or cancel (until C5); a cancelled booking leaves the lead "Appointment Booked" (until the platform fix).
- **Steps during building, not decisions:**
  - pull the real `Lead.source` values from the dev database for the inbound/outbound table;
  - set up the ZIP and area-code time-zone lookup tables.

## C1 closed provisionally (later, evening)

Testing C1 in the Debug UI (online mode, real OpenAI models) surfaced a bug: after an opt-out, the customer gets no reply at all, not just no more marketing — `events/handlers.py` puts the whole lead into `SILENT_STATUSES` (the same bucket as staff handoff/pause), so even "wait nevermind" gets silence, indefinitely, until the literal keyword `START` or a staff resume. That's stricter than the TCPA PDF's own wording on file ("stop automated marketing", decision 74), which only calls for suppressing marketing, not the conversation.

**Decided: close C1 provisionally. The bug is real but doesn't block C1 or the rest of Part B, and is left for later**, together with a related gap raised in the same review: today only three exact keywords (`start`, `unstop`, `yes`) reverse an opt-out, on one channel only, with no way to opt back into just marketing or just follow-ups.

**Planned, not built** (written up as the "C1 extension" under Phase C1 in `MASTER_PLAN_3.md`, architecture.md decision 87):
- four opt-out tiers — marketing-only, follow-up-only, full marketing+follow-up (today's behaviour, once the reply bug is fixed), total no-contact (the only tier that should still silence replies) — crossed with the existing channel scope;
- a matching natural-language opt-in, scoped the same two ways, to reverse into any one tier/channel instead of only a full, single-channel reversal;
- flagged before building: how to detect which tier an ambiguous phrase means (most real phrasing doesn't cleanly say), and that bare `"yes"` as a standing opt-in keyword risks reversing an opt-out by accident when it's really just answering an unrelated question.

Nothing in this section is shipped. The AI service still fully silences a lead after any channel-matching or all-channel opt-out today.
