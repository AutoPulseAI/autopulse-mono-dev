# Stream L: learning & optimization engine, verified price changes, reporting fields

Source: client blueprint box 5 "AI Learning & Optimization Engine" (`docs/client/autpulse.workflowblueprint.png`),
blueprint box 2 vehicle type filter ("retaining the original classification for reporting and attribution"),
Omnichannel PDF Days 8–30 / 31–90 "verified price change/OEM offer" and the inventory guardrail "Only use
verified current price changes/OEM promotions"; architecture §15 decisions 14 and 151.

## What was built

| # | Item | Where |
|---|------|-------|
| 1 | **Touch outcome tracking.** One `ai_touches` row per outbound AI touch (first reply, cadence touches, dated next step, morning message, visit follow-up, appointment steps, SOLD PENDING / ownership messages), keyed by `touch_id` so text + email are one row (`channels`). Context: dealer, lead, bucket + original bucket, lead source, new/used + original, kind, theme, touch number/day, wording variant, send-time variant, the chooser's reasons, dealer-local hour / weekday / time band. Outcomes filled later from existing events: `replied_at`, `reply_hours`, `replied_24h`, `replied_72h`, `meaningful_reply` (events/handlers.py `record_inbound`), `appointment_at`/`appointment_7d`, `showed_at` (agent/lifecycle.py `apply`), `opted_out_at` (channels/consent.py `set_channel_consent`). Last-touch attribution, once per touch. Indexes in `INDEX_SPECS`. | `learning/touches.py` |
| 2 | **Engagement learning in angle selection.** Days 8–90: candidates = unused extended angles, else all but the last two used; the price angle only with a verified drop. Days 2–7: the client's fixed theme, only the wording varies. | `learning/optimizer.py`, `learning/bandit.py` |
| 3 | **A/B tests.** 2–3 wording variants per theme (instruction to Compose; variant "a" = the original; no variants for Touch 1's mandated text or the name nudge). Send time morning 10:00 vs afternoon 15:00 for Day 2–90 touches; the send check still holds every touch to dealer hours and the customer's window. Assignment stored on the touch; results aggregated in the report. | `learning/variants.py` |
| 4 | **Report.** `GET /v1/insights/engagement?dealer_id=&days=` (shared secret). CRM page **AI Insights** `/dealer/ai/insights` (proxy `app/api/dealer-ai/insights`, nav entry in the AI Assistant menu): rates (24h, 72h, meaningful, appointment 7d, showed, opt-out) overall and by kind, bucket (current/original), source, new/used (current/original), angle, wording, send time, time band, weekday, channels; each test's leader with sample sizes; current verified price drops; how the learning works in plain words. | `learning/insights.py`, `api/insights.py`, `aidmvcs-be-dev/app/dealer/ai/insights/page.js` |
| 5 | **Original new/used.** `vehicle_type`, `original_vehicle_type`, `vehicle_type_history` on `ai_lead_state` (customer's `interest.new_or_used` wins, else the lead's vehicle condition). In the profile API (`lead.vehicle_type`, `lead.original_vehicle_type`, `vehicle_type` record) and the AI panel ("New or used: Used (came in as New)"). | `agent/lead_bucket.py` `track_vehicle_type`, called from agent/turn.py |
| 6 | **Verified price changes.** `ai_price_snapshots` per (dealer, VIN): price now, when first seen at it, change history (each price with first/last seen). Prices read like `/api/car` (`parseFloat(internetreduced || 0)`; 0 = no price). Snapshotted on every inventory read (search, single-vehicle re-check; never put on the AI's typed record) and by a 6-hourly sweep (worker cron `sweep_prices`) which also marks VINs gone from the feed out of stock. | `learning/price_watch.py`, `tools/inventory_tool.py`, `worker/jobs.py` |

## How the learning works

- **Reward:** the customer replied within 72 hours (blueprint: "Goal of every touch: GET THE CUSTOMER TO RESPOND").
  Only settled touches (sent > 72h ago, last 180 days, cadence kind) count.
- **Method:** Thompson sampling. Per option: `Beta(1 + prior wins + dealer wins, 1 + prior losses + dealer losses)`,
  where the platform-wide counts (all dealers, same context) are scaled to at most **20** pseudo-touches and the
  dealer's own touches count in full. One draw each; highest wins.
- **Context:** the most specific level where every option has data: bucket + source + new/used + time band →
  bucket + new/used → bucket → all.
- **Minimum sample:** 30 settled touches per option (dealer + platform). Below it: angles keep today's order
  (`cadence.pick_theme`), wording and send time are split evenly (the A/B assignment). So a new dealer behaves as
  before.
- **Deterministic:** the RNG is seeded from dealer, lead, cadence instance and touch number (repeatable re-plans;
  deterministic tests).
- Switches: `LEARNING_ENABLED` (angles + wording; default on), `SEND_TIME_AB` (default on; unit tests set it off
  in conftest because the schedule tests check the fixed 10:00).

## Price drops and decision 14

A **verified drop**: same VIN, seen in the feed within 48h, current price below the highest price recorded in the
last 60 days by ≥ max($250, 1%), and the lowest price seen in that window. Use is decision 14's exception only:
1. The optimizer offers the "verified price change" angle (Days 8–90) only when a lead's vehicle (VIN on the lead,
   or a vehicle we showed them) has a drop; the touch stores `price_drop` and a specific instruction.
2. When the touch fires, the vehicle is re-read fresh from the feed (snapshotted) and the drop re-verified at the
   same price; if not, the touch keeps the angle but loses the price (decision 151's no-price wording).
3. Search stock adds that vehicle, read fresh, to the context pack's inventory with `price_drop {price,
   previous_price, amount}` — the only record that ever carries a price.
4. The guard (`guardrails/draft_guard.py`) allows those numbers only when the draft names that VIN.
   A direct price question still gets "the team will confirm" (no reply turn's record has `price_drop`).
5. Compose prompt (`agent/llm.py`): one marked line naming this exception.

Before this stream the price angle was always picked first in Days 8–90 with nothing to say; now it's skipped
without a verified drop, so the extended touches start from the least-recently-used Day 2–7 angle.

## Edits to shared files (all marked "PLAN_4 stream L")

`agent/cadence.py` (`pick_theme` gains `exclude`), `scheduler/followups.py` (optimizer in `plan_cadence_touch`,
price re-check at fire, appointment-step touch recording), `agent/llm.py` (one prompt line), `agent/turn.py`
(vehicle type + touch recording after the send), `agent/nodes/search_stock.py` (price-drop vehicle),
`agent/offline_model.py` (price-drop wording), `guardrails/draft_guard.py`, `agent/lifecycle.py`,
`channels/consent.py`, `events/handlers.py`, `scheduler/sold_lifecycles.py`, `integrations/mongodb.py`
(collections, indexes, `DealerScopedCollection.aggregate`), `config.py`, `main.py`, `worker/*`, `api/leads.py`.
`agent/nodes/decide.py` untouched.

## Tests

- `tests/unit/test_learning.py` (27): chooser (default/split/learned, seeded, prior weight, context back-off),
  wording never touches mandated text, touch rows and attribution windows, real flow (first reply + nudge
  recorded, reply credited), Day 2–7 wording split, angle learning + no-repeat, send-time split inside the window,
  price snapshots / drop rules / sweep / gone, inventory reads snapshot without exposing price, guard allows the
  drop price only for that VIN, end-to-end Day 14 price-drop touch (offline model, guard passes, "$28,500" sent),
  lapsed drop loses its price, original new/used kept, report settled-only rates and winners, API auth.
- CRM: `test-ai-crm-platform.js` +1 (insights helpers). Unit 1590 pass, evals 80 pass / 9 skipped, CRM 97 pass.

## Open items

- OEM offers: no OEM incentive feed exists, so only dealer price drops are "verified" for now.
- Real-model check of the price-drop touch wording (gpt-5-mini) — only the offline model was exercised here.
- The sweep reads the platform `vehicles` collection directly (same DB, same mapping as `/api/car`); if
  `/api/car` ever gets an in-stock filter or price logic of its own, mirror it in `price_watch.vehicle_price`.
- Thresholds (30 samples, prior 20, $250/1%, 60-day lookback, 48h freshness, 10:00/15:00) are our defaults —
  worth confirming with the client. Reward is reply-in-72h; appointment-weighted rewards could follow once
  there is volume.
- Touches before this stream aren't backfilled; the report starts empty.
- Platform-wide prior aggregates every dealer's `ai_touches` (cached 10 min per process); fine at today's volume,
  revisit with a materialised daily rollup if it grows.
