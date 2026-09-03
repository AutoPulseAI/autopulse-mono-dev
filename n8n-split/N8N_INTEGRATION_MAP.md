# n8n Integration Map (aidmvcs-be-dev)

Every place the app calls out to n8n, and every n8n workflow file in the repo — including
the ones nothing currently calls.

## API → functions called → n8n webhook

| # | Entry API | Function(s) called (file:line) | n8n webhook (env var) | Workflow file | Active? |
|---|---|---|---|---|---|
| 1 | `POST /api/system` (inbound email, enqueues `emailQueue`) | `app/api/system/route.js:1393` `emailQueue.add('processEmail', ...)` → `app/worker/emailWorker.js` `processEmail()` → (if local ADF parse fails/doesn't apply) `callOllama()` (`emailWorker.js:923`) | `N8N_EMAIL_API` → `/incoming-email-messages` | `n8n-split/AI_Email_Workflow_v8(Preferred Communication Mode).json` | `true` (but see note below — this file was overwritten mid-development by a local n8n export of a different, "TEST"-named workflow, so what's live may not match what's checked in here) |
| 1b | Same trigger, ADF-shortcut path | `emailWorker.js` `processEmail()` → `parseAdfLeadEmail()` / `parseAdfLeadFromAttachments()` (`app/lib/adfLeadParser.js`) succeed → Lead created locally → `callOllama()` still called for acknowledgement text only, `create_lead`/lead fields from the response are explicitly discarded | same as #1 | same as #1 | same as #1 |
| 2 | `POST /api/system/sms` (inbound SMS, enqueues `communicationQueue`) | `app/api/system/sms/route.js` → `communicationQueue.add(...)` → `app/worker/processSms.js` `processSMS()` → `callOllama()` (`processSms.js:653`) | `N8N_SMS_API` → `/incoming-sms-messages` | `n8n-split/AutoPulse AI_SMS_Workflow_v5 (Multi Leads From One No).json` | `true` |
| 3 | `POST /api/leads` (manual "Add Lead" form) | `app/api/leads/route.js:653` `leadQueue.add('processLead', ...)` → `app/worker/leadworker.js` `processLead()` → `callOllama()` (`leadworker.js:337`) | `N8N_LEAD_API` → `/bulk-upload` | `n8n-split/AutoPulse AI_BulkUpload_Workflow_v1.json` | `true` (node named "Email Trigger" despite the bulk-upload purpose — looks like a cloned/repurposed email workflow, not purpose-built) |
| 3b | `POST /api/leads/import` (CSV import) | `app/api/leads/import/route.js:151` `leadQueue.add('processLead', ...)` → same `leadworker.js` path as #3 | same as #3 | same as #3 | same as #3 |
| 4 | `POST /api/conversations/lead/draft` ("Write with AI" button, `app/dealer/components/WriteWithAIModal.js`) | `app/api/conversations/lead/draft/route.js:44` — direct HTTP call, no queue | `N8N_WRITE_WITH_AI_API` → `/write-with-ai` | `n8n-split/WriteWithAI.json` | `true` |
| 5 | `app/lib/serverTranslateOutgoing.js` (called from `app/api/conversations/lead/status/route.js`, `app/api/booking/route.js`, `app/lib/appointmentReminderService.js`) | `serverTranslateOutgoing.js:42` `getTranslateApiUrl()` → `:53` `fetch(translateUrl, ...)` | `TRANSLATION_THIRD_PARTY_URL` → `/translation` (not an `N8N_*`-named var, but same n8n host) | `n8n-split/Multilingual_translation.json` | `true` |
| 6 | `POST /api/conversations/translate` (inline UI translate) | Calls OpenAI's chat completions API directly | — none — | — no n8n workflow involved — | n/a |

## n8n workflow files present in the repo but not called by any application code found

These exist under `n8n-split/` as drafts/experiments/superseded variants. Nothing in `aidmvcs-be-dev` points at them.

| Workflow file | `active` flag | Notes |
|---|---|---|
| `AutoPulse AI_SMS_Workflow_v5 (Vehicle Similarity Search).json` | `false` | SMS variant with the same VIN-only inventory lookup as v5 "Multi Leads From One No"; similarity-search fallback logic isn't actually implemented |
| `AutoPulse AI_SMS_Workflow_v6 (CTA template addition).json` | `false` | Draft SMS variant |
| `AutoPulse AI_SMS_Workflow_v6 (VDP URL).json` | `false` | Draft SMS variant intended to add the vehicle VDP link into SMS replies; has a JS syntax bug in its `Format Inventory Summary` code node (missing comma) |
| `Walkthrough_Email Communication system.json` | `false` | Older/duplicate email workflow, same `/incoming-email-messages` path as the live one — inactive, presumably superseded |
| `My workflow.json` | `false` | Minimal test webhook, `GET /test`, no downstream processing |
| `My workflow 2.json` | `false` | 3-node scratch workflow |

## Known live-vs-checked-in discrepancy

`n8n-split/AI_Email_Workflow_v8(Preferred Communication Mode).json` was overwritten during this
dev session by a local n8n instance's own export/sync — its top-level shape changed from a single
object to a one-element array, and the workflow inside is named
`"TEST - AI Email Workflow v8 Preferred Communication Mode v2"` (id `yGlkdxswWafTDXUv`), not the
original `"AutoPulse AI_Email_Workflow_v8 (Preferred Communication Mode )"` (id `Wqh4xtn7HCuM10xV`).
The webhook path (`/incoming-email-messages`) is unchanged, so pathway #1/#1b above still routes
correctly — but what actually runs when it's hit depends on whichever workflow is live on that
local n8n instance right now, which may not match this file. Left as-is at the user's request;
noted here so it isn't mistaken for the production workflow definition.

## Current endpoint targets (`.env.local`)

All of these currently point at a **local** n8n instance (`http://127.0.0.1:5678`) rather than the
staging host (`n8nstage.autopulse.ai`, commented out just above each in `.env.local`), except
translation, which points at `n8n.autopulse.ai` directly:

```
N8N_EMAIL_API=http://127.0.0.1:5678/webhook/incoming-email-messages
N8N_SMS_API=http://127.0.0.1:5678/webhook/incoming-sms-messages
N8N_LEAD_API=http://127.0.0.1:5678/webhook/bulk-upload
N8N_WRITE_WITH_AI_API=http://127.0.0.1:5678/webhook/write-with-ai
TRANSLATION_THIRD_PARTY_URL=https://n8n.autopulse.ai/webhook/translation
```
