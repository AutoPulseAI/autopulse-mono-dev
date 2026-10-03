# Stream C2: staff AI screens in the CRM

These are new staff screens in the dealer portal (`aidmvcs-be-dev/app/dealer/ai/**`). They replace the Debug UI for dealership staff. They use the same layout as the other dealer pages (`page_content` / `page_head` / `page_body`, `w_card`, react-bootstrap tables, pills, badges and modals), the same token handling (`localStorage.dealertoken` sent as a Bearer token) and the same auth check (`loadAuthenticatedUser` + `isAuthorizedForDealer`).

## How the data flows

Browser → `/api/dealer-ai/*` (Next.js: checks the dealer session and that the user works for this dealer) → AI service, called server-side with `UPSELL_SERVICE_SHARED_SECRET` (`UPSELL_AGENT_API_URL`). The browser never calls the AI service itself. The shared helpers are in `app/api/dealer-ai/_lib/dealerAi.js`.

## How to see each screen

Run the dev stack as usual (CRM + `make ai-up`). Sign in as a dealer, or as staff with "Manage Leads" or "View Assigned Leads". The sidebar then shows an **AI Assistant** menu, with a red count of open alerts.

1. **AI panel on a lead.** Go to Leads, click a lead, and look under the lead info card. The same panel appears in the Lead Details drawer and in the "AI details" drawer on both AI pages.
2. **Call Tasks** at `/dealer/ai/call-tasks`. There are three tabs: To call now, Waiting for a reply (`?view=upcoming`) and Done (`?view=done`). "Call" opens `tel:` and then asks for the outcome. "Record outcome" opens the same prompt without dialling.
3. **AI Alerts** at `/dealer/ai/alerts`. Add `?all=1` to include handled alerts.
4. **AI Settings** at `/dealer/ai/settings`.

## Routes added

| CRM route | AI service |
|---|---|
| `GET /api/dealer-ai/leads/[id]` | `GET /v1/leads/{id}/profile` + `GET /v1/staff/leads/{id}/consent` |
| `POST /api/dealer-ai/leads/[id]/pause` and `/resume` | `lead-paused` / `lead-resumed` events (`@lib/ai/aiStaff`) |
| `GET /api/dealer-ai/call-tasks?view=open\|upcoming\|done` | `GET /v1/staff/call-tasks` |
| `POST /api/dealer-ai/call-tasks/[id]` `{action, outcome, note}` | `POST /v1/call-tasks/{id}/complete\|dismiss` |
| `GET /api/dealer-ai/alerts[?include_handled=1][&count_only=1]` | `GET /v1/staff/notices` |
| `POST /api/dealer-ai/alerts/handled` `{lead_id, source}` | `POST /v1/staff/notices/{lead_id}/handled` |
| `GET/PUT /api/dealer-ai/settings` | none (reads and writes the dealer `User` directly) |

New AI service file: `api/staff_view.py`, with tests in `tests/unit/test_staff_view.py`. It is registered in `main.py` with two lines. The AI keeps only the **latest** `staff_notice` on each lead. "Handled" is stored next to it as `handled_notices.<source>` and never on the notice itself, so a newer notice shows as unhandled again. The alerts list also includes the post-handoff `staff_alert`, open handoffs (`status: handoff`) and "not interested" reasons.

## Call outcome prompt

The call outcome is required: connected, no answer, voicemail, wrong number or other. The lead outcome is also required:

- **Appointment:** uses the existing booking flow (`PUT /api/conversations/lead/status`, "Appointment Booked" with a date and time).
- **Opted out:** sets the lead to DND through the same route.
- **Specific follow-up:** records the date, time, channel and notes.
- **No next step / no contact:** recorded only.

Every outcome is also saved as an internal note on the lead. The prompt can't be closed without an answer ("I didn't make the call" and "Won't call - dismiss" count as answers). A call started from the page that has no answer yet is kept in localStorage and asked again after a reload.

## Mocked / missing / open items

- **Specific follow-up is not given to the AI.** It is saved only as a note and in the call task's `note`. The AI needs a "staff set a next action" event (C1 / AI side) to schedule it.
- **Wrong number** on a call does not mark the phone invalid in `ai_consent`. **Opted out** sets DND, which pauses the AI, but it does not record a consent opt-out. Both need an AI-side event.
- **MMS switch:** this stores `User.mms_enabled`. It is written with `strict: false` because the field isn't in the `User` schema. Nothing reads it yet. The F3 stream should read this field (or rename it) and add it to the schema.
- **Who can change settings:** the dealer's main account, an admin, or a role with "Manage Follow-up setting". Everyone else sees the settings read-only. Changing the mode copies the admin ai-mode route's side effects: the cache is cleared, and pending FollowUpJobs are cleared when switching to live.
- **No assignment filtering yet:** staff with only "View Assigned Leads" still see every call task and alert for the dealer.
- **"Open lead" link:** this uses `/dealer/leads?selectedLead=true&leadId=…`, and the Leads list only selects the lead if it is on the current page. The "AI details" drawer always works.
- **Fields from other streams:** service-request notices with `preferred_time` / `notes`, and profile sections for SOLD PENDING ownership, customer status, recalls and maintenance, show up only once those streams send them (generic renderers, keyed in `EXTRA_SECTIONS` / `DETAIL_FIELDS`). `bucket` is shown if present.
