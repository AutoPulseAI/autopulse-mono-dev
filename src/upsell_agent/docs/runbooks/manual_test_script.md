# Manual test script: the AI as a customer sees it

For testers. Replay these conversations in the **Debug UI** (http://localhost:5173) Simulator. Each one checks a problem found in manual testing, or a behaviour added to fix one. For each, compare what the AI says with **Good reply** and **Bad signs**, then confirm why it said it in the Debug UI.

## Before you start

1. `make ai-up` and `make ai-seed` (see `initial_setup.md`).
2. Check the banner at the top right of the Debug UI:
   - **"Offline model (rules, not AI)"**: the wording is fixed and simple. You're testing the flow, not how good the AI's writing is. The `#retry` / `#fallback` / `#reject` test tags are shown.
   - **"AI: gpt-4o-mini / gpt-4o"**: real models. Wording varies from run to run, so judge what it does, not the exact words. The test tags are hidden.
3. Use dealer **Sunrise Motors (dev)** (New York). Times in the Debug UI are Pakistan time (PKT). The Scheduler tab shows the dealer's own time.
4. Start each test with **+ New lead** so they don't affect each other.

**Where to look, for any reply:**
- **Load context** (click the step in the diagram): exactly what the AI read. That's the recent messages, the summary, what it knows about the customer, the dealer's details, and what it asked before.
- **Decide**: which rule fired, which question it answers, the one thing it asks next, and why it isn't asking something ("asked in our last message", "parked").
- **Guard**: whether the draft passed, and if not, why it was rewritten.
- **Conversation panel** (right of the Slots panel): what it has asked and how often, open questions, promises, and the summary.

---

## 1. A question in the middle is answered (the "rigid loop")

*Found in testing:* the AI asked "what's your model?", the customer asked "so far what do you know about me?", and the AI asked "what's your model?" again.

| Step | You type |
|---|---|
| New lead | sales, comments: `Interested in a used Ford F-150` |
| Reply | `so far what do u know about me?` |

**Good reply:** it answers first, from what it actually knows (used, Ford F-150; anything unsure is said as "I think…, but I still need to confirm that"). Then it asks **one** new question, not the one it just asked.

**Bad signs:** it ignores the question; repeats its last question; asks two or more things; states something you never said.

**Check:** Decide shows **answer** fired, with "Not asking … asked in our last message". The Conversation panel shows no open questions afterwards.

## 2. "Tomorrow" is a real day

*Found in testing:* the AI didn't know what "tomorrow" meant.

| Step | You type |
|---|---|
| New lead | sales, comments: `Hi, I saw your ad` |
| Reply | `I need it by tomorrow` |
| Reply | `actually next Friday` |
| Reply | `yes` |

**Good reply:**
- **After "tomorrow":** it says the date back with the weekday, e.g. "Got it - Wednesday, September 23 (tomorrow)", then moves on.
- **After "next Friday":** it checks the actual date ("Just to check, is that Friday, October 2?").
- **After "yes":** it carries on.

**Bad signs:** asks when you need it again; gives a wrong weekday or date; uses the Pakistan date instead of the dealer's; says "2026-09-23".

**Check:**
- **Slots panel:** "When they need it" shows the date in words, and "Timeline" is filled.
- **Validate step:** shows how the words became the date.
- **Scheduler tab:** shows the dealer's time. "Tomorrow" is relative to that, not to Pakistan time.

## 3. Replies are plain, and "what do you mean?" is explained

*Found in testing:* replies used dealership wording, and "what do you mean?" wasn't answered.

| Step | You type |
|---|---|
| New lead | **trade-in**, comments: `Trading my 2018 Honda Civic with 60,000 miles` |
| (AI asks about its condition) | |
| Reply | `what do you mean?` |
| Reply | `good` |

**Good reply:** everyday words, one question. After "what do you mean?" it explains the four conditions (excellent, good, fair, poor) simply, then asks the **same** question again, nothing new. "good" fills the trade-in condition.

**Bad signs:**
- internal words ("slot", "trade_in.condition", "lead type");
- more than one question;
- after "what do you mean?", moving on to a different question.

**Check:** Decide shows **clarify**, with the explanation it will use. The Slots panel shows "Trade-in condition: good".

## 4. Never silent: a handed-off lead still gets answered

*Found in testing:* sometimes the AI didn't reply at all.

Run this while the dealer is open (Scheduler tab → **Dealer time**). The staff check counts only opening hours, so outside them it waits for the next opening.

| Step | You type |
|---|---|
| New lead | sales, comments: `Hi, I saw your ad` |
| Reply | `Can a real person call me?` |
| Reply | `Also I'm free after 5` |
| Scheduler tab | **+1 hour** (the staff check fires) |
| Reply | `Hello?` |
| Scheduler tab | **+1 hour**, then **+1 hour** again |
| Reply | `Anyone there?` |

**Good reply:**
- **To "Can a real person call me?":** "I'm passing this to a member of our team…".
- **To "Also I'm free after 5":** no new message, because the customer was just told. The timeline shows a **held** turn saying why.
- **After the first +1 hour:** 30 opening minutes after the handoff, the customer gets "Sorry for the wait…" once, and the lead shows a staff alert. It's the staff check card in the Scheduler tab.
- **To "Hello?":** held again. The customer was told less than 2 hours ago.
- **To "Anyone there?":** 2 hours after the last notice, a holding reply ("Thanks, I've passed this to the team…").

The customer is told at most once every 2 hours; the "sorry for the wait" message counts.

**Bad signs:** a customer message with neither a reply nor a held turn explaining why; the AI starting to sell again while the lead is with staff.

**Check:**
- **Timeline:** shows "held" and "staff check" entries.
- **Held turn:** the Hold step gives the reason.
- **Metrics tab:** the go-live check "no customer message without a reply or a reason" passes.

## 5. Frustration gets an apology, not a handoff

| Step | You type |
|---|---|
| New lead | sales, comments: `Hi, I saw your ad` |
| Reply | `You keep asking the same thing!` |

**Good reply:** a short apology, no question, an invitation to say what they need. The lead stays **AI active**.

**Bad signs:** hands off; asks another question; argues.

**Check:** Decide shows **acknowledge**, with "The customer is frustrated with the conversation: no questions this time."

## 6. A customer who dodges isn't asked the same thing over and over

| Step | You type |
|---|---|
| New lead | sales, comments: `Hi, I saw your ad` |
| Reply (about 10 times) | `hmm`, `not sure`, `maybe`, … |

**Good reply:** each reply asks one thing, never the same thing twice in a row, and spreads its questions over everything it still needs. When every missing detail has been asked twice, it passes the lead to the team ("I've passed what we have to the team…"), and after that it asks nothing more.

**Bad signs:** the same question twice in a row; a detail asked 3+ times while another was never asked; asking again after passing the lead on.

**Check:** the Conversation panel shows each detail's count, with "just asked" and "asked out". The lead's status becomes **partly qualified**.

## 7. Questions about the dealership are answered from its real details

| Step | You type |
|---|---|
| New lead | sales, comments: `Hi, I saw your ad` |
| Reply | `When are you open on Saturday?` |
| Reply | `Where are you located?` |

**Good reply:** the dealer's real Saturday hours (9:00 AM to 5:00 PM for the dev dealer) and its address (120 Main St, Springfield, NJ). For a dealer that never entered them: "the team will confirm".

**Bad signs:** made-up hours or an address; hours for a dealer that has none; staff phone numbers.

**Check:** Load context → "Dealer details it may use" shows exactly what it had. Guard passed on the first draft.

## 8. Prices and stock stay with the team

| Step | You type |
|---|---|
| Reply | `How much is the RAV4?` |
| Reply | `Is the blue one in stock?` |

**Good reply:** "the team will confirm", recorded as a promise in the Conversation panel. No price, no "in stock".

**Bad signs:** any price, payment or discount; "in stock" / "available"; "approved".

## 9. A long conversation keeps its beginning (optional)

Send one early message with a personal detail (`It's for my daughter, she just passed her driving test`), then 15–20 long messages.

**Good reply:** later replies can still use the early detail.

**Check:** the Conversation panel's **Summary** mentions it once it has left the recent messages. The Timeline shows **summary** entries after some replies.

---

## Recording results

For each conversation, note the lead name, the models banner, **pass / fail**, and for a fail:
- the reply text;
- which step looked wrong (Decide rule, Guard reason, what Load context had).

Real-model runs vary, so run a failing case twice before reporting it.

The same behaviours are checked automatically by:
- the conversation evals: `make ai-evals`, `make ai-evals-report`;
- the scenarios: `make ai-scenarios`, or the Scenarios tab.

This script is for what a person notices that the automatic checks don't: tone, clarity, and whether a reply feels natural.
