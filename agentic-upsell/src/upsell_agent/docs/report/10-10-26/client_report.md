# Fix report: links sent by the AI (10 Oct 2026)

## The problem

A customer, Jean Silien, inquired about the 2023 Acura RDX. On Oct 9 Jean texted: *"Can you send me a link to look please."*

Jean got two replies, and neither was the RDX's page:

1. **7:08 PM (marked "Auto-reply")**: *"You can book here: https://www.autopulse.ai/booking/..."*, an AutoPulse booking link.
2. **11:15 PM (marked "AI")**: *"You can view our main site here: www.victorycarscentral.com. Would you like me to send the trade-in link or the specific vehicle page you saw?"* This sent the homepage instead of the car's page, and offered a "trade-in link" that doesn't exist.

The RDX does have its own page on victorycarscentral.com. We checked the inventory record, and the link is there.

## Root cause

**Reply 1: the AutoPulse booking link came from the old n8n system, not the new AI.**
The text "You can book here" and the autopulse.ai/booking link exist only in the old n8n workflows. The new AI has no code that produces AutoPulse links. An n8n workflow was still sending messages on Oct 9.

**Reply 2: the new AI had three gaps.**

1. **It didn't connect "a link" to the car the customer inquired about.** Jean didn't name the RDX in that message, so the AI didn't treat it as a request for the RDX's page.
2. **The homepage was always allowed through.** The AI's safety check accepted the dealership homepage in any message, with no conditions. So when the AI wasn't sure what to send, it fell back to the homepage.
3. **Nothing stopped it offering links that don't exist.** The "trade-in link" was made up by the AI.

## The fix

The AI no longer writes links itself. It works out what the customer wants a link for, and the system inserts the real link from the inventory or the dealer record.

| Customer asks… | The AI now sends |
|---|---|
| For a link while talking about one car (Jean's case) | That car's own page on the dealer website |
| For a specific car, clearly | That car's page only |
| For a link, but it's unclear which | The most likely car's page first, then politely mentions the main website, in one message |
| For a car whose page is missing in inventory | No link. It says honestly that it doesn't have an online page for that car right now, offers details or a visit, and the team gets a note to send it |
| For the dealership's website | The homepage |
| For something we have no link for (trade-in form, credit application) | No made-up link. It says so honestly and offers to help in the chat |
| For a link when we can't tell which car | It asks which car they mean |

**Two hard rules are now enforced on every message before it goes out:**
- No AutoPulse link of any kind.
- No link except the ones the system chose for that reply.

## Status

- The fix is built and has passed our automated tests, including a test that replays Jean's exact message.
- **Next step:** test with the live AI on a staging account before we put it live. We'll confirm here once it's deployed.

## What we need from your side

1. **The old n8n workflows:** we will make sure every n8n workflow is turned off. That stops the AutoPulse booking links for good.
2. **Booking link decision:** Betsy asked for no AutoPulse links at all, and the Autopulse team mentioned liking the booking link. The new AI now sends no booking links. Please confirm that's what you want.
3. **Trade-in, finance or service links:** if the dealership has real pages for these, send them to us and the AI can share them when customers ask.
