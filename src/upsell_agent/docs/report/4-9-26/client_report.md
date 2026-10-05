# AutoPulse AI Conversation Layer: Status Report

**Date:** 4 October 2026

This report explains in plain language what the AI system can do today, what is still to come, and what we need from you. It follows our report of 29 September and covers the work done since then.

---

## The short version

- **The new-lead journey is built end to end.** The AI replies to a new lead within seconds, follows up on the schedule from your workflow blueprint, books the visit, confirms it, and handles no-shows. It does this while following the texting and email rules in your compliance document.
- **Everything built so far has been tested with a practice AI model**, not the live one. Tests with the real AI model and a real phone number are the next step. Your team starts trying it this week.
- **The "after the sale" part is mostly not built.** That covers the Sold Pending check-ins, the ownership lifecycle, maintenance reminders, recall alerts, birthdays and anniversaries. The system already records a manager's outcome pick and handles it safely. It does not yet send any of those messages.
- **Three smaller changes you asked for on 1 October are also not built yet.** They are state-by-state texting hours, service visits handled as requests, and sending a photo of the car instead of a link.

---

## 1. What is finished and working

### Talking to leads

| What it does | Status |
|---|---|
| Replies to new leads and customer messages within seconds, in plain English | Done |
| Answers questions about the dealership (hours, address, phone) from the dealership's own records | Done |
| Looks at the real, live vehicle stock and answers "do you have a red RAV4?" honestly | Done |
| Never names a car that has sold or isn't in stock. It re-checks stock right before sending | Done |
| Asks no more than two questions per message, and never asks the same thing three times | Done |
| Replies to a lead who writes at night or on a weekend, and carries on once the dealership opens | Done |
| Wording like "not interested" gets one "why?" question, then goes to a person. **Only a person can close a lead as lost** | Done |
| "Call me next week" is understood as a dated follow-up, and the AI checks back on that date | Done |

### Following up when a customer goes quiet

We built the follow-up schedule from your blueprint.

- **Day 1:** the first message arrives within seconds. A short "{Name}?" nudge follows a few hours later if there's no reply.
- **Days 2 to 7:** one touch per day, each with its own theme.
- **After that:** weekly touches on Days 14, 21 and 28, then monthly on Days 58 and 88.
- **Both channels:** every touch goes out by text and email together. If one channel is opted out, the other keeps working.
- **Day 91:** the lead closes as **Closed - Lost**. This closes the lead, not the customer. A new lead from the same person is worked fresh.
- **First message:** it always asks "what are you driving now?", unless a trade-in is already known.

### Booking and appointments

- The AI offers a visit as the main goal and books it into your existing booking system, with times offered from real availability.
- **Daily countdown messages** go out before the appointment.
- **Day before:** a "Reply Y to confirm" text goes out at 10:00 the day before. A "Y" confirms the booking. An "N" offers new times straight away.
- **No-show:** if the customer doesn't show, a message goes out one hour later. A "how did it go?" follows a day later. After two days the customer goes back into the follow-up schedule. A reply stops it.
- **Sales visit outcome:** after a visit, the manager picks **Sold Pending**, **Sold Delivered** or **Unsold**. The status screens on your platform now require this pick.
  - **Sold Pending and Sold Delivered:** the automated follow-ups stop. These are the starting points for the workflows in section 2.
  - **Unsold:** the lead goes back to follow-up for 90 days from that date. This is the answer you gave on 1 October.

### Staying within the rules

- **Opt-outs.** "STOP" and similar phrases stop everything the system starts, on that channel or on every channel, depending on what the customer asked for. If the customer writes again, the AI still replies. The system also recognises a customer opting back in.
- **Consent.** The system checks consent before every message. Texts the AI starts itself go out only inside the allowed hours, within the dealership's opening hours and the customer's own local time.
- **Wrong numbers and bounced emails.** A number that is not the customer's is marked invalid, nothing is sent back, and the team is notified. A bounced email is handled the same way and the text goes out instead. The customer's other channel keeps working.
- **Duplicate leads.** A second lead from the same person is linked to the first and not worked separately, so nobody gets double messages.
- **Staff call task.** When a touch gets no reply within 60 minutes, the system opens a call task for the team. It does this only if calling is allowed. Anyone who has replied or been taken over by staff is left alone. *The task screen on the platform side is not built yet. The data and endpoints are ready.*

### Platform changes

We changed your dealer platform in a few places, with approval: the manager outcome picker after "Visited", the new status labels in the lead lists, the dashboard sold count (it now includes Sold Pending and Sold Delivered), and the marketing-campaign check. The platform's own tests pass (66 of 66).

### How well it has been tested

- **Automated tests:** about 1,160 checks pass, plus 79 conversation-quality checks.
- **Live scenario runs:** roughly 63 of 65 scenarios pass in our test environment on the practice AI model. The two that don't run need the platform server running for a side-by-side comparison.
- **Load test:** 300 simultaneous conversations ran with no errors and a 2.6-second typical reply time.
- **Response speed.** Your blueprint asks for a first quality response within 60 seconds. With the real AI model, replies take about 8 to 10 seconds, well inside that.

---

## 2. What is not built yet

### 2a. The "after the sale" workflows (your two specs of 29 September)

These come from the SOLD PENDING and SOLD DELIVERED specs. **No messages go out for any of the following yet.**

| Piece | What it will do | Status |
|---|---|---|
| **Sold Pending check-ins** | Weekly warm check-ins for four weeks, then every two weeks indefinitely until the deal finalises or falls through. It never guesses at financing or delivery dates. | Not built |
| **Sold Delivered ownership status** | Tracks each customer as active or inactive, and each vehicle as owned or no longer owned. | Not built |
| **Day-3 check-in** | A friendly "how's it going?" about three days after delivery, with an offer to book the first service. | Not built |
| **Maintenance reminders** | Service reminders based on the vehicle's schedule. | Not built, waiting on the data source |
| **Safety recall alerts** | Checks the public vehicle recall database and warns customers with an open recall. | Not built, waiting on the data source |
| **Birthday message** | One per year, only with a verified birthday on file. | Not built |
| **Ownership anniversary** | "Do you still have your [car]?" once a year per vehicle for 10 years. A "no" closes the vehicle out and asks what they drive now, with no sales pitch. | Not built |

What *is* in place: the system recognises the two statuses and stops its other automatic messages when a manager picks one. The two closed outcomes, **Closed - Lost** and **Closed - No Longer Owns**, are agreed.

### 2b. Three changes you asked for on 1 October

1. **State-by-state texting hours.** Today the AI applies one cautious window everywhere: 8 AM to 8 PM, with a cap on marketing texts per day. That is safe, because it is stricter than most states. Your tables show some states allow less, for example later starts in Texas and Kentucky, and no Sundays in a few states. Building the per-state table will make the system match each state exactly. Until then it is stricter than the law in most places and may text a little less than it could.
2. **Service visits are requests, not bookings.** As you said, service appointments are *offered* in this phase, with notes taken, and booking is next phase. Today the AI can still create a real booking for a service lead, which is more than you asked for. The change makes it ask for a preferred day and time, record the notes, pass them to the service team, and never say "booked" or "confirmed".
3. **A photo of the car, not a link.** Your direction is to send a picture and share a link only if the customer asks. Today no replies carry a photo or a link. This is safe but less complete. The groundwork for choosing the right photo is done. Sending the actual picture is not.

### 2c. Smaller items still open

- **Birthday messages** and **GPT-5 as the test model** came up on the last call and are on the list.
- **Real-model testing.** Tests so far used the practice model. A full run against the real AI model and a real phone number is still to do, and the live-in-Docker runs for a few of the latest features have not been done yet.
- **Platform call-task screen:** a list screen with click-to-call. The data is ready and the screen is not built.
- **Customer can refer back to a car already shown** ("the silver one"). This is not understood yet. The AI treats it as an ordinary short reply.
- **"Sold" signal from stock feed:** the stock feed has no "sold" flag. A car disappears only when removed. Our re-check before sending protects against naming a sold car. A real sold signal would make it faster.
- **One live-week trial at one dealership** to confirm zero wrong vehicle facts. This can only happen once a dealer goes live in shadow mode.

---

## 3. What we need from you

| Item | Why it matters |
|---|---|
| **Vehicle Databases trial.** We start the 15-day sandbox only near the end of the build, as you asked, so it doesn't expire before we can test. Please confirm timing and access. | Needed for maintenance reminders and recall alerts. |
| **The third spec (service workflows).** You said it is coming. | It decides whether maintenance and recalls follow it or are built now on placeholder data. |
| **Written-consent states.** Your table says Florida, Oklahoma and Maryland require prior express written consent for automated texts. Today the system treats a customer's own inquiry as consent. | Your counsel should confirm this is enough, or we need to tighten it. |
| **Rows marked with an asterisk in the state table** (federal default, not individually verified). | Counsel should confirm them before we rely on them. |
| **MMS cost review.** Picture messages cost about three times a text. | Needed before we turn them on for live dealers. |
| **"Urgent need" and "different angle" lists.** These are our defaults. | Please confirm or change them. |
| **Test phone number access.** The team starts testing this week. | We'll send access details. |

---

## 4. Suggested next steps

1. Put the system in front of your team on a real test phone number, using the real AI model, and collect their feedback.
2. Build the three October-1 changes: state-by-state hours, service-visit requests, car photos.
3. Build the Sold Pending check-ins, the ownership status and the Day-3 message, since these need no outside data.
4. Add the birthday and anniversary messages.
5. Build maintenance reminders and recall alerts last, once the data source is settled.
6. Run one dealership in shadow mode for a week to confirm quality before going live.

---

## Summary

The new-lead conversation, follow-up schedule, appointment booking and confirmation, no-show handling and compliance controls are built and have passed our testing. The remaining work is the post-sale relationship and three refinements to what is already there. The next milestone is real-phone, real-model testing with your team.
