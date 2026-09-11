# AutoPulse SMS v8 Phase 1 — Implementation Notes

## Deliverables and dependency order

Import and relink in this order:

1. `SMS - 01 Normalize + Resolve.json`
2. `SMS - 02 Context Builder.json`
3. `Sales - 10 Conversation Intelligence.json`
4. `Sales - 11 Inventory Resolver.json`
5. `Sales - 16 Response Strategy.json`
6. `SMS - 20 Response Generator.json`
7. `SMS - 21 Validator + Output Formatter.json`
8. `AutoPulse AI_SMS_Workflow_v8.json` — the top-level workflow implementing the logical `SMS - 00 Inbound Router`

All eight exports are inactive and contain no pinned data. The v7 export is unchanged and remains the production reference.

After import, open `AutoPulse AI_SMS_Workflow_v8` and relink each Execute Workflow node to the imported child with the same cached name. Exported workflow IDs are placeholders because deployed n8n IDs are allocated by the target instance and were not available in this repository.

## Phase 1 boundary

This implementation establishes modular inbound processing while retaining v7 behavior. It does not add no-response cadence, attempt counters, third-rejection state, durable-state redesign, DMS enrichment, learning/A-B testing, a new Service flow, TCPA/customer-timezone behavior, or cross-channel orchestration.

The internal boundary contract is:

```json
{
  "schema_version": "8.0",
  "channel": "sms",
  "event": {},
  "identity": {},
  "context": {},
  "intelligence": {},
  "inventory": null,
  "decision": {},
  "response": {}
}
```

Mongo ObjectIds are serialized to strings before leaving the normalization/resolution workflow. Mongo queries convert them back only at the node that needs ObjectId comparison.

## Workflow details

### AutoPulse AI_SMS_Workflow_v8 (logical `SMS - 00 Inbound Router`)

- Purpose: receive the test-only inbound webhook and synchronously orchestrate the seven Phase 1 child workflows.
- Trigger: `POST /incoming-sms-messages-v8`; response mode is the last node, matching v7's webhook behavior.
- Input: unchanged v7 request shape, primarily `body.currentMessage` with `content`, `message_id`, `sender`, `recipient`, `date`, `dealer_id`, and `attachments`.
- Output: the terminal v7-compatible object produced by `SMS - 21 Validator + Output Formatter`.
- Nodes moved from v7: `SMS Trigger` becomes the v8 test webhook; the old monolith's control flow becomes synchronous Execute Workflow nodes.
- Email reuse: no. This is an SMS channel entry point.

### SMS - 01 Normalize + Resolve

- Purpose: normalize the inbound SMS and resolve dealer, conversation, lead, and linked customer.
- Trigger: Execute Sub-workflow Trigger with pass-through input.
- Input: raw v7 webhook item or an already-unwrapped `currentMessage` object.
- Output: canonical envelope with normalized `event`, string-only IDs in `identity`, dealer/lead/customer summaries, and `context.resolution` diagnostics.
- Nodes moved/refactored from v7: `Input Extraction`, `Extract Attachments`, dealer lookup, `Check DB for existing query`, `Set Parent_Id`, `Check DB for VIN of the lead`, and `Create or Update Lead Status`.
- Behavior: dealer identity is resolved by the configured SMS conversion number; the inbound `dealer_id` is treated as a claim used to disambiguate matching records, not as authority by itself. Zero or multiple matches set resolution errors and later block delivery.
- Email reuse: no, because normalization and phone-pair resolution are SMS-specific.

### SMS - 02 Context Builder

- Purpose: load and structure dealer configuration, store hours, SMS history, email history, visible lead notes, latest campaign, and attachment-derived context.
- Trigger: canonical envelope from Normalize + Resolve.
- Input/output: canonical envelope; only `context` is enriched.
- Nodes moved/refactored from v7: `Extract AI Bot Name & Store No`, `Set Bot Name & Store No & Store Address`, `Find available slots`, `Format Store Hours`, both history queries/extractors, campaign lookup/dedup/latest extraction, `Safe Context Extractor`, and the attachment branch.
- Context remains structured. It is not flattened into a single prompt string.
- Note filtering accepts both legacy `isNote` and canonical `is_note`; internal notes are excluded and `use_replies_for_ai` is honored when explicitly false.
- Attachment content type accepts `contentType` and `content_type`. Image, plain text/CSV, PDF, and video paths remain supported. Video insight now reaches the aggregate. Unsupported/no-attachment inputs emit a result instead of ending the execution.
- PDF/video temporary paths include n8n execution and item indexes and are removed after aggregation. Runtime hosts still need `pdftotext` and `ffmpeg`, as v7 did.
- Email reuse: partially. The structured context assembly is reusable, but the phone-pair history query and attachment ingress assumptions require a channel adapter.

### Sales - 10 Conversation Intelligence

- Purpose: make one structured classification/extraction call for customer, vehicle, language, inquiry, journey intent/sentiment, communication preference, DND, escalation, appointment signal, and response/link signals.
- Trigger: context-complete canonical envelope.
- Input/output: canonical envelope; only `intelligence` is populated.
- Nodes moved/refactored from v7: `Customer & Vehicle & Language Details Extractor`, `Communication Preference Detection`, `Inquiry Classifier`, `Intent & Sentiment Analysis`, `DND Detection`, `DND Extract`, and the appointment-status interpretation needed for terminal status.
- The LLM does not select a route. Explicit STOP/opt-out, already-purchased, not-interested, callback, supplied email, and supplied VIN patterns have deterministic safety overrides/fallbacks.
- Malformed model JSON is caught and replaced with a conservative structured fallback; it does not crash JSON parsing.
- Original source/bucket attribution is not overwritten. Phase 1 does not add new attribution state that v7 did not carry.
- Email reuse: yes. The classifier is channel-neutral apart from its current SMS history vocabulary.

### Sales - 11 Inventory Resolver

- Purpose: perform dealer-scoped exact VIN and escaped make/model lookup and return one of `EXACT_AVAILABLE`, `EXACT_UNAVAILABLE`, `ALTERNATIVES`, or `UNKNOWN`.
- Trigger: intelligence-complete envelope. An internal deterministic gate skips database lookup when no vehicle/inventory signal exists.
- Input/output: canonical envelope; `inventory` is replaced with a structured result.
- Nodes moved/refactored from v7: `Check DB for VIN of the lead`, `Extracting the VIN`, `Find Vehicles in Inventory`, `Format Inventory Summary`, `Has Vehicle Model`, `Build Vehicle Match Query`, `Find Vehicles by Make & Model`, `Format Similar Vehicles Summary`, `Merge Inventory Search`, and `Safe Inventory Extractor`.
- All model-derived regex text is escaped and exact-anchored before interpolation.
- Availability uses an explicit availability/sold/status field when one exists. The current Vehicle schema has no authoritative field. To preserve v7 behavior, a VIN document with no such field is emitted as `EXACT_AVAILABLE` with `authoritative_availability: false` and warning `AVAILABILITY_INFERRED_FROM_DOCUMENT_EXISTENCE_FOR_V7_PARITY`.
- Email reuse: yes.

### Sales - 16 Response Strategy

- Purpose: deterministically choose one route and assemble allowed facts, allowed links, CTA, tone, language, and response objective without writing customer-facing prose.
- Trigger: inventory-resolved envelope.
- Input/output: canonical envelope; `decision` is populated.
- Nodes moved/refactored from v7: DND/email/manager/visit/booking IF nodes, Intent Response Bank, CTA Templates Bank decision intent, VDP link rules, and trade/finance/booking link rules.
- Route priority preserves v7: invalid resolution safety block, DND, email preference, escalation, booking, visit, inventory, general.
- Link allow-list rules preserve v7: VDP only for photos/video/details/specs/features/trim/accessories/listing/history-detail requests; trade/finance only for their complex intents; booking link only for where/how-to-book requests; store address only for location requests.
- Email reuse: yes. The selected route can be consumed by an email-specific generator later.

### SMS - 20 Response Generator

- Purpose: generate wording from the selected strategy and approved facts only.
- Trigger: strategy-complete envelope.
- Input/output: canonical envelope; `response.candidate` receives SMS text or the legacy email-preference subject/body plus booking date/time fields.
- Nodes moved/refactored from v7: general, visit, booking, managerial translation, and email response generators plus their JSON extraction logic.
- DND and invalid dealer resolution bypass the model. Malformed JSON returns a safe route-specific fallback.
- Generator prompts target v7's stated 160-character ideal. The validator retains v7's effective 300-character hard limit for parity.
- Email reuse: the core strategy is reusable; this workflow remains SMS-owned but preserves v7's embedded email-preference branch in Phase 1.

### SMS - 21 Validator + Output Formatter

- Purpose: validate model output, remove unapproved URLs, reject unsupported positive availability claims, truncate without splitting a URL, and format the exact legacy branch payload.
- Trigger: generated envelope.
- Input: canonical envelope with `response.candidate`.
- Output: one of the current v7 terminal payload shapes. Existing inconsistent names remain: `parent_message_id` for general/visit/booking, `parent_id` for DND/manager/email, `request_query` except `request` for email.
- Nodes moved/refactored from v7: response extractors, three character-limit nodes, FE appointment/status mapping, HTML wrapping, and all terminal formatting nodes.
- The `receiver_number` defect is corrected to `recipient_number` while retaining the output field name `recipient_number`.
- Email reuse: no. The formatter intentionally emits the existing AutoPulse SMS endpoint contract.

## Intentional Phase 1 differences from v7

1. The workflow is split into seven synchronous child workflows behind a separate inactive webhook.
2. Dealer resolution is validated and blocked when missing or ambiguous. v7 could silently fan out or fail later. The blocked result uses the managerial terminal shape with both send flags false so downstream delivery is safe.
3. LLM classification is consolidated into one call, so exact wording/classification can vary even though category and routing rules are retained.
4. Business routing is deterministic and no longer delegated to sequential LLM/IF combinations.
5. Malformed LLM JSON produces structured fallback output instead of a failed execution.
6. Inventory facts are structured and fact-checked. Legacy document-existence availability is explicitly warned rather than hidden.
7. Attachment field normalization, concurrency-safe paths, connected video aggregation, unsupported pass-through, and cleanup correct the listed implementation defects.
8. URLs are allow-listed and 300-character truncation is URL-safe. v7 could split links.
9. The two DND/manager output branches now populate `recipient_number` from the normalized recipient rather than the nonexistent `receiver_number`.

## Behavior deliberately preserved

- STOP, already purchased, and not interested all follow the v7 DND branch. These are not split in Phase 1.
- Email preference is checked before managerial review, matching v7 branch order.
- Booking is inferred from the same current-message/conversation signals; no booking API call or new state machine is introduced.
- Lead-status labels and branch-specific terminal field names remain unchanged.
- The v7 FE-status comparison of boolean `create_lead` to string `"true"` is retained in the general/visit formatter, which means the effective fallback remains `Contacted`. Changing that would alter lead-status semantics and requires approval.
- v7's stated 160-character generation target and effective 300-character limiter are both represented: 160 is the generation target, 300 is the hard parity limit.
- No persistence node was added. Downstream AutoPulse behavior remains responsible for storing the inbound/outbound result as in v7.

## Unresolved behavior / configuration TODOs

- **Authoritative inventory availability:** no stable field is defined on the flexible Vehicle schema. Configure/standardize a field before removing the v7 parity inference warning.
- **Imported child workflow IDs:** relink the seven Execute Workflow nodes after n8n assigns IDs.
- **Dealer ambiguity:** there is no approved tiebreaker for two users sharing an SMS conversion phone. v8 blocks delivery rather than inventing one.
- **Lead ambiguity:** if multiple leads match the same parent ID, there is no approved authoritative ordering field. The workflow warns and uses the first returned record, matching the practical v7 limitation.
- **Customer resolution without a linked lead:** Phase 1 follows existing linkage. It does not create a new phone/email customer-resolution policy.
- **Attachment binaries:** n8n hosts must provide network access to attachment URLs plus `pdftotext` and `ffmpeg`. Office documents, audio, archives, and unknown types remain unsupported; they are preserved as structured unsupported records.
- **Appointment slot truth:** v7 only supplies configured store hours, not authoritative slot availability. v8 must not describe generated suggestions as confirmed bookings.
- **Service inquiries:** retained as an inquiry category and answered with current general behavior; no new Service workflow is invented.
- **Layer 1 TCPA/after-hours gate:** explicitly deferred by the Phase 1 request, even though Layer 1 requires it for future outbound outreach.

## Known compatibility risks

- Execute Workflow node parameters may be migrated by older/newer n8n releases on import. Test on a staging instance matching production before activation.
- Mongo node Extended JSON ObjectId support must match the current production n8n Mongo node; it is the same pattern used by v7.
- Consolidating LLM calls changes stochastic outputs and token composition. Golden tests should compare route and contract semantics, not exact prose.
- The context builder's multi-input Merge must be regression-tested with mixed and multiple attachments on the deployed n8n version.
- HTTP attachment nodes depend on the input URL remaining accessible to n8n. No new authentication scheme was invented.
- `pdftotext` and `ffmpeg` failures continue through a structured partial/unsupported result; downstream responses should not claim facts from failed analysis.
- Because both v7 and v8 use `responseMode: lastNode`, a platform timeout can still affect the synchronous caller for large videos or slow model calls.
- Phase 1 remains read-only with respect to durable conversation state. Running the test webhook through the normal downstream consumer can still create/update leads because the terminal contract is intentionally unchanged.

## Credentials and secrets

The exports contain only the existing n8n credential references:

- MongoDB: `MongoDB account` (`9CSrB6IzzXy9lnfw`)
- OpenAI: `OpenAI Account` (`8HDcbDkuFRoCFjGB`)

No API key, Mongo URI, bearer token, or environment-specific secret is embedded.
