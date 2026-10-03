# Stream A3 - SOLD PENDING and SOLD - DELIVERED (MASTER_PLAN_4 D1, D2, D3, D4, D7, D8)

Built locally, unit-tested, never run against Docker or any live system. Sources: the two client PDFs in
`docs/data/4/` ("SP §n", "SD §n" below) and the client's 1 Oct answers (`docs/data/6/conversation_6.md`).

## Where things live

| File | What |
|---|---|
| `agent/sold_pending.py` (new, pure) | SP cadence grid, the five touch texts, guardrail check, reply classifier (SP §9), `reply_hold` |
| `agent/sold_delivered.py` (new, pure) | Day-3 / birthday / anniversary / service-outreach texts, verified-birthday rule, YES/NO and current-vehicle parsing |
| `agent/ownership.py` (new) | Three-level status model, ownership records, customer ACTIVE/INACTIVE, **A4's interface**, API views |
| `scheduler/sold_lifecycles.py` (new) | D1 `on_stage_change`, planning, firing (`fire`), inbound router (`route_inbound`), birthday sweep, lead view |
| `api/customers.py` (new) | `GET /v1/customers/{id}/ownership` |
| `agent/lifecycle.py` | Stage `closed_no_longer_owns`, `CLOSED_STAGES`, event `no_longer_owns`, staff status "Closed Lost", new `KIND_STAGES`, hook into `on_stage_change` |
| `scheduler/followups.py` | `SOLD_LIFECYCLE_KINDS`, excluded from `CHANNEL_SWITCHES`, dispatched to `sold_lifecycles.fire` |
| `events/handlers.py` | Sold Pending / Sold Delivered no longer pause the AI; router call; a staff pause doesn't cancel lifecycle work |
| `agent/nodes/decide.py` | `hold_questions` for sold customers; `decision["service_facts"]` |
| `api/leads.py`, `main.py`, `worker/jobs.py`, `worker/main.py`, `integrations/mongodb.py`, `devtools/*`, `api/dev.py` | small marked edits |
| `aidmvcs-be-dev` `lib/ai/aiStaff.js`, three `StatusModal.js`, `test-ai-layer.js` | "Closed Lost" as a staff status |

Every edit to a shared file is marked `MASTER_PLAN_4 ... (stream A3)`.

## Behaviour

**D1.** `lifecycle.apply` calls `sold_lifecycles.on_stage_change` on every stage change. Sold Pending starts SP;
Sold Delivered ends SP first (touch cancelled, call tasks cancelled, `sold_pending.outcome`) then starts ownership;
Closed Lost ends SP. Unsold is unchanged (C5). The lead's status becomes `active`: the AI runs these workflows.

**D2 SOLD PENDING.** Touches on day 1, 8, 15, 22 after the outcome, then every 14 days (36, 50, ...) with no
end. Each is text + email (`transactional`) + the existing 60-minute call task. Stops on Sold Delivered, Closed
Lost, or a full opt-out (stage Opted Out; it resumes on opt-in). Replies: a question for a person -> staff notice
`sold_pending_escalation` + a fixed reply; information provided -> notice `sold_pending_info`; "yes I sent
everything" -> we stop asking; anything else -> the AI turn with `hold_questions` (answer only, no pitch, no
dates/documents/financing claims).

**D3.** Opportunity status is derived from the stage (`OPEN`, `SOLD_PENDING`, `SOLD_DELIVERED`, `CLOSED_LOST`,
`CLOSED_NO_LONGER_OWNS`; only the last two are closed). Collections `ai_vehicle_ownership` and
`ai_customer_status`. Lead state gains `opportunity_status`, `status_changed_at`, `sold_delivered_at`,
`delivery_date`, `closed_at`, `closed_reason`, `no_longer_owns_at`, `sold_pending{}`, `service_offer{}`,
`ownership_prompt{}`, `vehicle_capture{}`, `checkin_sent_at`.

**D4.** Day 3 at 10:00 dealer time: check-in + first-service offer in words (named only if
`maintenance.first_service.name` is on the ownership record). YES -> staff notice `service_request` with the
customer's words as notes; nothing is booked. LATER -> acknowledged, never pressed. An upcoming DealerVault
service appointment removes the offer sentence.

**D7.** Birthday: only when `Birth Date` on the platform customer / deals / repair orders / service appointments
gives one month/day (disagreeing sources or `1/1/1900` = not verified). One per customer per year, no call task; a
daily sweep (06:17) picks up dates DealerVault imports later. Anniversary: years 1-10 from `delivery_date`.
YES -> `ownership_confirmed_at`. NO -> vehicle `NO_LONGER_OWNED`, stage `closed_no_longer_owns`, that vehicle's
pending messages cancelled, then three questions (what / how long / where serviced) stored as a
`CUSTOMER_REPORTED` record (never a VIN, never a trade pitch). Anything else changes nothing.

**D8.** `ownership.recalculate_customer_status` runs on every stage change and every ownership change.

## For A4

```python
await ownership.vehicle_is_owned(dealer_id, vin, customer_id=None)   # True | False | None (unknown -> no outreach)
await ownership.queue_service_outreach(dealer_id, {
    "type": "RECALL_DETECTED" | "MAINTENANCE_DUE", "offer": "service_visit_request",
    "facts": {...}, "vin": "...", "customer_id": "...",          # or "ownership_id"
    "due_at": iso|datetime (optional), "call_task": True (optional)})
# -> {"status": "queued", "followup_id", "due_at"} | {"status": "skipped", "reason"}
await ownership.owned_vehicles(db, customer_id)
await ownership.set_maintenance_facts(db, ownership_id, {"first_service": {"name": "..."}})
```

Facts read for the message: recall `recall_id | campaign_number | NHTSACampaignNumber`, `component`, `summary`,
`source` (default NHTSA); maintenance `service | service_name | next_service | services`, `due | due_date`. Or
pass approved wording as `sms_text` / `email_subject` / `email_body`. The facts are stored untouched on
`ai_lead_state.service_offer.facts` and travel as `decision["service_facts"]` on AI reply turns.
TODO hooks (comments only): `service_events.register_vehicle` in `start_ownership`, `stop_vehicle` in
`mark_no_longer_owned`, `maintenance.compute_status(...)["next_service"]` for Day 3.

## API shapes

`GET /v1/leads/{lead_id}/profile` gains three top-level keys:

```json
{"opportunity": {"status": "SOLD_PENDING", "closed": false, "status_changed_at": "...", "closed_at": null,
                 "closed_reason": null, "sold_delivered_at": null, "delivery_date": null, "no_longer_owns_at": null},
 "sold_pending": {"started_at": "...", "touch_number": 1, "week_number": 1, "phase": "weekly",
                  "last_followup_at": null, "next_followup_at": "...", "documents_confirmed": false,
                  "documents_asked_at": null, "last_meaningful_contact_at": null, "ended_at": null, "outcome": null,
                  "escalations": [{"type": "human_question", "owner": "assigned_salesperson", "status": "open",
                                   "at": "...", "question": "..."}],
                  "next_touch": {"due_at": "...", "touch": {"touch_number": 1, "theme": "documentation_questions",
                                 "theme_label": "...", "week": 1, "phase": "weekly", "due_at": "..."}}},
 "ownership": {"vehicles": [<vehicle>], "pending": {"post_delivery_checkin": {"due_at": "..."},
               "ownership_anniversary": {"due_at": "...", "year": 1}, "birthday": null, "service_outreach": null},
               "ownership_prompt": {"kind": "anniversary", "ownership_id": "...", "year": 1, "asked_at": "..."},
               "service_offer": {"kind": "first_service|recall|maintenance", "status": "offered|requested|declined",
                                 "asked_at": "...", "notes": "...", "facts": {}},
               "vehicle_capture": {"step": "current_vehicle|duration|service_location|null", "ownership_id": "..."},
               "customer_status": <status>}}
```

`GET /v1/customers/{customer_id}/ownership?dealer_id=...` (shared secret; 404 for an unknown customer):

```json
{"customer_id": "...",
 "status": {"customer_status": "ACTIVE|INACTIVE", "customer_status_reason": "...", "open_opportunity_count": 1,
            "active_owned_vehicle_count": 1, "unknown_ownership": false, "customer_status_recalculated_at": "...",
            "customer_status_changed_at": "...",
            "history": [{"at": "...", "event": "CUSTOMER_BECAME_ACTIVE|CUSTOMER_BECAME_INACTIVE", "from": null,
                         "to": "ACTIVE", "reason": "...", "why": "..."}]},
 "vehicles": [{"id": "...", "customer_id": "...", "lead_id": "...|null", "reported_on_lead_id": null, "vin": null,
               "year": 2022, "make": "Honda", "model": "Civic", "ownership_status": "ACTIVE|NO_LONGER_OWNED",
               "vehicle_source": "DEALER_SALE|CUSTOMER_REPORTED", "delivery_date": "2026-10-06",
               "sold_delivered_at": "...", "ownership_confirmed_at": null, "no_longer_owns_at": null,
               "information_received_at": null, "approx_acquisition_date": null, "reported_ownership_duration": null,
               "normal_service_location": null, "anniversaries_sent": [1], "maintenance": null,
               "created_at": "...", "updated_at": "...", "history": [{"at": "...", "event": "SOLD_DELIVERED"}]}],
 "opportunities": [{"lead_id": "...", "stage": "sold_delivered", "opportunity_status": "SOLD_DELIVERED",
                    "closed": false, "closed_at": null, "closed_reason": null, "sold_delivered_at": "...",
                    "delivery_date": "2026-10-06", "no_longer_owns_at": null, "duplicate_of": null}],
 "birthday": {"month": 7, "day": 14, "sources": ["deal"], "last_sent_year": 2027}}
```

Staff notice kinds added: `sold_pending_escalation`, `sold_pending_info`, `service_request` (with `notes`,
`ownership_id`).

## Decisions made (not in the specs)

1. SP touches are fixed wording, not AI-written, so they cannot invent a document, date or reason (SP §7).
2. First SP touch is the day after the outcome at 10:00; the grid is fixed from the start date.
3. SP touches send as `transactional`; Day-3, birthday, anniversary and service outreach as `marketing` (consent applies).
4. A staff hand reply still pauses the AI's conversation but no longer cancels lifecycle work. If staff paused
   within the last 2 days, an SP touch is skipped (cadence moves on) and an ownership message waits a day.
5. Staff "Closed Lost" on a Sold - Delivered lead is ignored: only "no longer owns" closes it (SD §2).
6. Customer with no ownership record at all and no open lead keeps their previous status (unknown is not zero).
   INACTIVE needs at least one answered vehicle and none owned. A DealerVault deal VIN with no answer also counts
   as unknown.
7. A platform lead with no AI state counts as open unless its status text is a closed one.
8. Sold vehicle details come from the lead's own fields or the `interest.model` fact; missing parts stay empty.
9. An anniversary more than 30 days late is skipped rather than sent late.
10. No call task for the Day-3 check-in, birthday or anniversary; yes for SP touches and (by default) A4 outreach.

## Open items

- `aidmvcs-be-dev/test-ai-layer.js` was updated for "Closed Lost" but not run (no `node_modules` in the worktree).
- The platform shows none of the new statuses except "Closed Lost" in the status modals (Conflict 3).
- Scenarios `pd2_`, `pd4_`, `pd7_` and the changed `pc5_manager_outcome` load but were not run against Docker.
- The salesperson is not named in escalation replies (no assigned-salesperson name on the lead today).
- Day-3 first service is only named once A4's maintenance data is written via `set_maintenance_facts`.
- Reply classifiers are keyword rules; borderline replies fall through to the AI turn under `hold_questions`.
- Trade / equity / repurchase: not built (next SOW); current-vehicle data is collected only.
