# AutoPulse SMS v8 Phase 1 — Regression Test Plan

## Test objective

Prove that the inactive modular v8 path preserves SMS v7 business behavior and terminal contracts while fixing the approved technical defects. Compare routing and facts, not exact LLM prose.

## Test setup

1. Import the seven child workflows, then import `AutoPulse AI_SMS_Workflow_v8`.
2. Relink every Execute Workflow node to the imported child with the same name.
3. Verify MongoDB and OpenAI credential references resolve without editing credential values.
4. Keep v7 active. Keep v8 inactive except for a controlled staging/manual test window. The v8 path is `POST /incoming-sms-messages-v8`.
5. Use a staging database snapshot or dealer-scoped synthetic fixtures. Do not send returned payloads to the production SMS delivery consumer.
6. Confirm the n8n host has `pdftotext` and `ffmpeg` installed and can reach the attachment fixture URLs.
7. Record for every run: input, v7 result, v8 result, v8 selected route, inventory status/warnings, terminal keys, response length, URLs, execution errors, and database query count.

Base request shape:

```json
{
  "currentMessage": {
    "content": "Is the 2022 Honda Civic still available?",
    "message_id": "v8-test-001",
    "sender": "+15550001001",
    "recipient": "+15550002000",
    "date": "2026-09-11T12:00:00.000Z",
    "dealer_id": "DEALER_ID_STRING",
    "attachments": []
  }
}
```

When calling the webhook, wrap this object under `body` only if the HTTP client or n8n webhook serialization does not already do so. The normalizer accepts both the v7 `body.currentMessage` form and direct manual-test form.

## Global assertions for every case

- All child workflow outputs before the final formatter use exactly the top-level envelope sections: `schema_version`, `channel`, `event`, `identity`, `context`, `intelligence`, `inventory`, `decision`, and `response`.
- `schema_version` is `8.0`; `channel` is `sms`.
- Mongo identifiers crossing workflow boundaries are strings or null, never BSON objects.
- No node contains pinned data.
- No secret appears in execution output or exported JSON.
- Exactly one deterministic route is selected from DND, ESCALATION, EMAIL_HANDOFF, INVENTORY, VISIT, BOOKING, GENERAL.
- Customer-visible URLs are a subset of `decision.allowed_links`.
- SMS output is at most 300 characters and no URL is partial.
- No inventory claim exceeds `inventory.status` or the supplied inventory fields.
- Terminal keys match the selected v7 branch; no field is renamed.
- `recipient_number` equals the inbound recipient, including DND and managerial branches.

## Core regression cases

### 1. New lead

- Fixture: valid dealer phone; no matching phone-pair email record, lead, or customer.
- Input: a normal sales question with a unique message ID.
- Expect: `create_lead=true`, `update_lead=false`, `lead_id=null`, parent ID based on the inbound message ID; terminal general/inventory shape uses `parent_message_id`.
- Parity: no bot reintroduction if any prior context exists; introduction is allowed only when context is empty.

### 2. Existing lead

- Fixture: phone-pair conversation linked to one lead and customer.
- Expect: string `lead_id` and `customer_id`, `create_lead=false`, `update_lead=true`; existing parent ID preserved; customer/vehicle fields may be filled from the linked lead without overwriting current-message facts.

### 3. General question

- Input: `What time do you close today?`
- Expect: GENERAL; answer uses configured store hours only; no inventory or VDP claim; terminal `lead_status=First Response Sent`.

### 4. VIN match

- Fixture: one dealer-scoped Vehicle with the requested VIN.
- Input: VIN plus availability question.
- Expect: inventory lookup uses exact VIN; `EXACT_AVAILABLE` only when authoritative availability is true, or legacy document-existence parity with `authoritative_availability=false` and the explicit warning. Output must not use another dealer's VIN record.

### 5. Make/model search

- Fixture: two or more matching dealer vehicles.
- Input: `Do you have a Honda Civic?`
- Expect: escaped, anchored case-insensitive model/make query; `ALTERNATIVES`; no more than three structured alternatives; response mentions no more than two.
- Injection check: repeat with model text containing `.*`, `(`, `)`, `[`, `]`, `+`, `?`, `^`, `$`, `{`, `}`, `|`, and `\\`; the query treats characters literally and does not broaden results.

### 6. No inventory match

- Input: valid VIN or make/model absent from inventory.
- Expect: `UNKNOWN` with `NO_INVENTORY_MATCH`; no positive availability claim; response asks for clarification/offers to help rather than inventing a vehicle.

### 7. Visit interest

- Input: `I'd like to come see it.`
- Expect: VISIT; existing refusal/history is respected; suggested times, if any, remain inside configured store hours; terminal visit shape uses journey intent as `lead_status`.

### 8. Booking/date-time

- Input: exact date and time inside store hours, with booking context.
- Expect: BOOKING; confirmation uses only supplied date/time; `booking_status=true`, `booking_date`, `booking_time`, `fe_lead_status=Appointment Booked`.
- Repeat with no date/time: ask for a day/time; do not fabricate a confirmed booking.

### 9. Refusal

- Fixture: prior assistant visit ask.
- Input: `No thanks, I don't want to visit.`
- Expect: existing v7 DND/not-interested interpretation is preserved; do not offer another visit. Verify no appointment-attempt state is introduced.

### 10. STOP

- Inputs: `STOP`, `stopall`, `unsubscribe`, and `please stop texting me`.
- Expect: DND; `lead_status=fe_lead_status=DND`, `response=null`, `send_user_response=false`, `send_manager_sms=true`; correct `recipient_number`; reason is opt-out in the manager message.

### 11. Already purchased

- Input: `I already bought a car elsewhere.`
- Expect: DND, matching v7's combined behavior; do not split into a new closed-won/closed-lost policy.

### 12. Manager request

- Input: `I need to speak to a manager.`
- Expect: ESCALATION; `response=null`, `send_user_response=true`, translated `user_response` if applicable, `send_manager_sms=true`, and no invented promise time.

### 13. Callback request

- Input: `Please call me back after 4.`
- Expect: ESCALATION under current v7 managerial rules; callback signal true; customer acknowledgement does not guarantee a precise callback time.

### 14. Email preference

- Input: `Email the details to test@example.com.`
- Expect: EMAIL_HANDOFF before managerial routing; `response_mode=email`, email HTML in `response`, `request` (not `request_query`), `parent_id`, and all three `preferred_communication_mode*` fields.
- Negative check: an email address without an explicit email preference must not force this route unless v7 does so for the same fixture.

### 15. Multilingual input

- Inputs: representative Spanish, French, and Hindi messages.
- Expect: language name/code/confidence are structured; customer response uses detected language when confidence is at least 0.50; manager notification remains operationally readable; low-confidence input defaults to English.

### 16. Campaign reply

- Fixture: delivered campaignlead records with duplicates plus two Campaign documents at different times.
- Input: a reply clearly aligned to the latest campaign.
- Expect: campaign IDs deduplicated; latest campaign chosen by `message_content.sent_at`, then `sent_at`, then `created_at`; subject/body/time are complete and structured; campaign does not override a clearly unrelated current intent.
- Defect check: campaign node executes without truncated/incomplete JavaScript.

### 17. Note precedence

- Fixture: public `is_note=true` note contradicting older SMS; another record uses `isNote=true`; an internal note is also present.
- Expect: both public naming variants are recognized; internal note excluded; lead notes are presented as highest precedence; the answer follows the public note rather than stale history.

## Attachment regression cases

Use unique externally reachable fixture URLs. Run two requests concurrently in the PDF and video cases and confirm paths cannot collide.

### 18. Image attachment

- Fixture: JPEG/PNG with `contentType`, then repeat with `content_type`.
- Expect: IMAGE route, normalized image insight, safe malformed-image fallback if needed, and no duplicate or dropped terminal response.

### 19. Text attachment

- Fixture: UTF-8 `.txt` and `.csv` containing known vehicle/customer facts.
- Expect: TEXT route, at most 20,000 decoded characters sent for analysis, structured document insight, and no guessed missing values.

### 20. PDF attachment

- Fixture: text PDF containing a known VIN.
- Expect: PDF route; execution-scoped `.pdf`/`.txt` names; structured insight; temp artifacts removed after aggregation.
- Failure variant: make `pdftotext` unavailable in an isolated test worker. Execution continues with no unsupported fact claims.

### 21. Video attachment

- Fixture: short MP4 with a visible vehicle.
- Expect: VIDEO route; execution-scoped video/frame paths; frame analysis aggregates into `context.attachments`; `frames_analyzed` is nonzero; temp artifacts removed.
- This specifically proves the v7 disconnected-video-context defect is fixed.

### 22. Unsupported attachment

- Fixture: ZIP, audio, DOCX, or unknown MIME type.
- Expect: structured attachment record with `analysis_status=unsupported`; workflow continues through intelligence, strategy, generation, and output.

### 23. No attachment

- Input: `attachments=[]` or omitted.
- Expect: no-attachment sentinel survives branch aggregation; `has_attachments=false`; exactly one final payload.

### 24. Mixed/multiple attachments

- Fixture: image + text + PDF + video + unsupported file in one message.
- Expect: all five results appear once, video insight included, unsupported item retained, one final envelope, one terminal response. Repeat on the deployed n8n version to validate Merge behavior.

## Failure and validation cases

### 25. Missing dealer

- Input: recipient phone not configured for any dealer.
- Expect: `DEALER_NOT_FOUND`, `decision.block_delivery=true`; terminal managerial shape has `send_user_response=false` and `send_manager_sms=false`; no Mongo query crosses into another dealer and no customer message is generated.

### 26. Ambiguous dealer

- Fixture: two dealer users with the same SMS conversion phone and no uniquely matching claimed dealer.
- Expect: `AMBIGUOUS_DEALER_PHONE`, blocked delivery, no arbitrary dealer selection.

### 27. Malformed intelligence output

- In staging, disable the Intelligence agent and temporarily insert a Set node returning malformed text such as `{bad json`; do not export pins or the test node.
- Expect: `intelligence.meta.parse_status=fallback`, warning `MALFORMED_INTELLIGENCE_JSON`, deterministic STOP/callback/email/VIN safeguards still work, and execution completes.

### 28. Malformed generator output

- In staging, replace generator output temporarily with prose or truncated JSON.
- Expect: `response.generation.status=fallback`, warning `MALFORMED_RESPONSE_JSON`, a route-safe fallback response, and a valid terminal object.

### 29. Unapproved URL

- Inject a generator candidate containing `https://unapproved.example/path` while `allowed_links` is empty.
- Expect: URL removed, validation warning recorded, no partial URL, output remains within the hard limit.

### 30. URL across length boundary

- Inject a candidate where an approved URL begins before character 300 and ends after it.
- Expect: validator removes the whole over-boundary URL from the truncated text; no URL fragment remains; length is at most 300.

### 31. False inventory claim

- Set inventory to UNKNOWN/EXACT_UNAVAILABLE and inject `It is available now.`
- Expect: claim replaced by a verification-safe response and warning `UNSUPPORTED_AVAILABILITY_CLAIM_REPLACED`.

## Terminal contract assertions

Assert exact key sets by branch (key order is irrelevant):

- GENERAL/INVENTORY: `lead_status`, `lead_name`, `lead_mail`, `lead_phone`, `source`, `response`, `message_id`, `request_query`, `create_lead`, `update_lead`, `parent_message_id`, `sender_number`, `recipient_number`, `fe_lead_status`, `user_language`, `appointment_cancellation_requested`.
- VISIT: same key set as GENERAL; `lead_status` is the visit intent.
- BOOKING: GENERAL key set plus `booking_status`, `booking_date`, `booking_time`; `fe_lead_status=Appointment Booked`.
- DND: managerial/DND shape with `parent_id`, `request_query`, `response=null`, `send_user_response=false`, `send_manager_sms=true`, and `manager_sms`; no field renaming.
- ESCALATION: DND shape plus `user_response`; normally both send flags true. Invalid dealer safety-block variants set both false.
- EMAIL_HANDOFF: uses `parent_id`, `request`, `response_mode`, `preferred_communication_mode_selected`, `preferred_communication_mode`, and `preferred_communication_mode_old_messageID`; it intentionally does not rename these fields.

## Exit criteria

- All cases pass twice: once individually and once as a mixed concurrent batch.
- No v7 workflow JSON diff exists.
- No v8 workflow is active in the exported files.
- Every imported child is correctly relinked in the top-level router.
- No unresolved inventory field is treated as authoritative.
- Stakeholders sign off on semantic parity for DND/already-purchased, managerial rules, booking labels, lead-status labels, and email output.
- Only after sign-off may the v8 test webhook be activated for controlled integration traffic; v7 remains untouched until a separate cutover approval.
