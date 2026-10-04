"""The lead lifecycle (MASTER_PLAN_3 C3; Omnichannel PDF §1-2, §5, §11-12;
diagrams: docs/architecture/STATE_MACHINE_DIAGRAMS.md).

Where a lead stands in the client's sales workflow, kept on the AI's own lead
state (`ai_lead_state.stage`), not on the platform's Lead (C3: AI service only).
It sits beside `status`, which says who is in charge of the conversation (the AI,
or staff after a handoff / pause): a lead can be "with staff" and still be at
Appointment Set.

    stage                            when
    new_lead                         the lead arrived
    no_contact_made                  Touch 1 and the 3-hour nudge went out unanswered (C4 sends them)
    contact_made_no_next_action      the customer replied: no appointment, no dated next step
    contact_made_specific_followup   the customer gave a dated next step ("call me Friday")
    appointment_set                  a booking exists (the AI's or one staff made)
    appointment_no_show              appointment time + 1 hour, no visit (C5)
    sales_visit                      staff set "Visited" / "Sold"
    opted_out                        every channel stopped, or staff set "DND"
    closed_lost                      Day 91 with nothing superseding it, or staff closed it
    sold_pending / sold_delivered    the manager outcomes (MASTER_PLAN_4 D1-D3: scheduler/sold_lifecycles.py)
    closed_no_longer_owns            a Sold - Delivered customer said they no longer own the vehicle (D7)

Rules (Omnichannel PDF §2):
- One controlling workflow: entering a stage cancels the scheduled work the old
  stage's workflow had queued (KIND_STAGES). Every follow-up kind is re-checked
  against the lead's stage again right before it fires (stage_check).
- Priority when events collide (§11): opt-out, Sales Visit, appointment, dated
  next step, no-show, contact without a next step, no contact, new lead.
- The opportunity clock never resets (§12): `opportunity_created_at` is the
  platform lead's own creation time, written once.
- Closed - Lost is per lead, never per customer (client, 1 Oct 2026). The AI
  never closes a lead from a conversation: only the Day 91 sweep and staff do
  (client, scope Q10).
- Day 91 doesn't close a lead while an appointment is pending: Appointment Set
  and Appointment No Show are superseding outcomes until they resolve (decided
  with the user, 1 Oct 2026).
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import cadence
from upsell_agent.config import get_settings
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
    get_db,
)

logger = logging.getLogger(__name__)


class Stage(StrEnum):
    NEW_LEAD = "new_lead"
    NO_CONTACT = "no_contact_made"
    CONTACT_NO_ACTION = "contact_made_no_next_action"
    SPECIFIC_FOLLOWUP = "contact_made_specific_followup"
    APPOINTMENT_SET = "appointment_set"
    NO_SHOW = "appointment_no_show"
    SALES_VISIT = "sales_visit"
    # The manager outcomes after a Sales Visit (MASTER_PLAN_3 C5, Omnichannel PDF §10). Their own follow-up
    # workflows are MASTER_PLAN_4's; here they stop the lead workflow and name where the lead stands.
    SOLD_PENDING = "sold_pending"
    SOLD_DELIVERED = "sold_delivered"
    OPTED_OUT = "opted_out"
    CLOSED_LOST = "closed_lost"
    # MASTER_PLAN_4 D3 (stream A3; SOLD-DELIVERED PDF §1, §10): the second of "the ONLY two CLOSED opportunity
    # statuses". Reached only from Sold - Delivered, when the customer confirms they no longer own the vehicle.
    CLOSED_NO_LONGER_OWNS = "closed_no_longer_owns"


# The client's own names (Omnichannel PDF §1; "Closed - Lost" from the 1 Oct answers).
STAGE_LABELS: dict[Stage, str] = {
    Stage.NEW_LEAD: "New Lead",
    Stage.NO_CONTACT: "No Contact Made",
    Stage.CONTACT_NO_ACTION: "Contact Made - No Next Action",
    Stage.SPECIFIC_FOLLOWUP: "Contact Made - Specific Follow-Up",
    Stage.APPOINTMENT_SET: "Appointment Set",
    Stage.NO_SHOW: "Appointment No Show",
    Stage.SALES_VISIT: "Sales Visit",
    Stage.SOLD_PENDING: "Sold Pending",
    Stage.SOLD_DELIVERED: "Sold - Delivered",
    Stage.OPTED_OUT: "Opted Out / Suppressed",
    Stage.CLOSED_LOST: "Closed - Lost",
    Stage.CLOSED_NO_LONGER_OWNS: "Closed - No Longer Owns",
}

# §11, lower wins. Closed - Lost is terminal (0): nothing outranks it.
PRIORITY: dict[Stage, int] = {
    Stage.CLOSED_LOST: 0,
    Stage.CLOSED_NO_LONGER_OWNS: 0,
    Stage.OPTED_OUT: 1,
    Stage.SALES_VISIT: 2,
    Stage.SOLD_PENDING: 2,
    Stage.SOLD_DELIVERED: 2,
    Stage.APPOINTMENT_SET: 3,
    Stage.SPECIFIC_FOLLOWUP: 4,
    Stage.NO_SHOW: 5,
    Stage.CONTACT_NO_ACTION: 6,
    Stage.NO_CONTACT: 7,
    Stage.NEW_LEAD: 8,
}

# Stages the Short-Term / Day 1-90 workflow works (Omnichannel PDF §1).
WORKING = frozenset({Stage.NEW_LEAD, Stage.NO_CONTACT, Stage.CONTACT_NO_ACTION, Stage.SPECIFIC_FOLLOWUP})
# Day 91 closes only these (an appointment still pending supersedes it).
CLOSABLE_AT_DAY_91 = WORKING
# MASTER_PLAN_4 D3 (SOLD-DELIVERED PDF §1: "No other opportunity status is treated as CLOSED"). Sold - Delivered
# is NOT in here: it is an active ownership lifecycle until the customer no longer owns the vehicle.
CLOSED_STAGES = frozenset({Stage.CLOSED_LOST, Stage.CLOSED_NO_LONGER_OWNS})
OPPORTUNITY_DAYS = 91
HISTORY_LIMIT = 50

# Scheduled-work kinds (scheduler/followups.py) and the stages each belongs to: a
# stage change cancels pending work whose kind isn't allowed in the new stage,
# and each kind is re-checked against the stage right before it fires.
# Short-Term work. Not in Specific Follow-Up: the customer named when to come back, and "specific
# timing wins ... rather than continuing aggressive Short-Term cadence" (§2) - only their next step runs.
SHORT_TERM = WORKING - {Stage.SPECIFIC_FOLLOWUP}
KIND_STAGES: dict[str, frozenset[Stage]] = {
    # The 24h resend of our last message on the other channel. Once an appointment exists, an old
    # switch (often the visit offer itself) is stale work (§2).
    "channel_switch": SHORT_TERM,
    # MASTER_PLAN_3 C4: the Short-Term / extended cadence (Omnichannel PDF §3-§4). It runs in exactly
    # the stages the client lists as its triggers (§3), Specific Follow-Up excepted: there the
    # customer's own dated step replaces it (§2 "specific timing wins", decision 132).
    "cadence_touch": SHORT_TERM,
    "resume_at_opening": SHORT_TERM,
    "visit_followup": SHORT_TERM,
    # MASTER_PLAN_3 C5 (Omnichannel PDF §7-§9): the appointment's own messages. The confirmation and the countdown
    # belong to Appointment Set, the +1h no-show check too (it is what moves the lead to No Show), and the
    # no-show messages to Appointment No Show.
    "appointment_details": frozenset({Stage.APPOINTMENT_SET}),  # MASTER_PLAN_4 (stream R): the 15-minute message
    "appointment_confirm": frozenset({Stage.APPOINTMENT_SET}),
    "appointment_countdown": frozenset({Stage.APPOINTMENT_SET}),
    "appointment_no_show_check": frozenset({Stage.APPOINTMENT_SET}),
    "appointment_no_show_followup": frozenset({Stage.NO_SHOW}),
    "appointment_no_show_close": frozenset({Stage.NO_SHOW}),
    # MASTER_PLAN_3 C2: the staff call task behind the 60-minute connection timer follows the touches
    # it belongs to (the working stages; a call is also the dated step's own channel).
    "call_task": WORKING | {Stage.SOLD_PENDING, Stage.SOLD_DELIVERED},
    # PLAN_4 stream T (Omnichannel PDF §3 "Human call tasks - Days 1-7"): the morning and afternoon call tasks
    # run only while the lead has an eligible Short-Term status (scheduler/daily_call_tasks.py).
    "daily_call_task": SHORT_TERM,
    "next_action": frozenset({Stage.SPECIFIC_FOLLOWUP}),
    "next_action_check": frozenset({Stage.SPECIFIC_FOLLOWUP}),
    # A handoff check reminds the customer staff have their message: fine in any open stage.
    "handoff_check": WORKING | {Stage.APPOINTMENT_SET, Stage.NO_SHOW},
    # MASTER_PLAN_4 (stream A3, scheduler/sold_lifecycles.py). The call task above now also follows a SOLD PENDING
    # touch (SOLD PENDING PDF §3, §8: every touch is CALL + TEXT + EMAIL) and a service outreach (SOLD-DELIVERED
    # PDF §12: "human tasks are for ... service opportunities").
    "sold_pending_touch": frozenset({Stage.SOLD_PENDING}),
    "post_delivery_checkin": frozenset({Stage.SOLD_DELIVERED}),
    "ownership_anniversary": frozenset({Stage.SOLD_DELIVERED}),
    "service_outreach": frozenset({Stage.SOLD_DELIVERED}),
    # Customer-level, not vehicle-level (§7): it outlives one vehicle's Closed - No Longer Owns.
    "birthday": frozenset({Stage.SOLD_DELIVERED, Stage.CLOSED_NO_LONGER_OWNS}),
}

# What the platform's staff statuses mean here (aidmvcs-be-dev lib/ai/aiStaff.js
# STAFF_OWNED_STATUSES; the status arrives in the lead-paused event's reason).
STAFF_STATUS_EVENTS: dict[str, str] = {
    "Visited": "sales_visit",
    "Sold": "sales_visit",
    "DND": "opted_out",
    "Appointment Booked": "appointment_set",
    # The manager outcomes (MASTER_PLAN_3 C5): Sold Pending / Sold Delivered stop the lead workflow, Unsold
    # puts the lead back into follow-up for 90 days (client, 1 Oct 2026, scope Q2).
    "Sold Pending": "sold_pending",
    "Sold Delivered": "sold_delivered",
    "Unsold": "unsold",
    # MASTER_PLAN_4 D2 (SOLD PENDING PDF §2, §9: "Dealer determines transaction is lost -> CLOSED LOST"): staff
    # close a lead as lost, arriving the same way "Sold Pending" does (aidmvcs-be-dev lib/ai/aiStaff.js).
    "Closed Lost": "staff_closed_lost",
    # Staff closed the lead as lost (client, 1 Oct 2026), e.g. a Sold Pending deal that fell through.
    "Closed - Lost": "staff_closed_lost",
}
# Unsold's follow-up period (client, 1 Oct 2026): 90 days, counted from the Unsold date.
UNSOLD_FOLLOWUP_DAYS = 90
_STAFF_STATUS_REASON = re.compile(r'Staff moved the lead to "([^"]+)"')

# Not a meaningful reply (client, 1 Oct 2026, scope Q10: "auto reply is not
# meaningful"): out-of-office and carrier/phone auto-replies, and messages with
# no words at all.
_AUTO_REPLY = re.compile(
    r"\b(auto(?:matic)?[- ]?(?:reply|response|generated)|out of (?:the )?office|away from (?:the|my) office|"
    r"i'?m (?:currently )?(?:driving|away)(?: with do not disturb| right now)?(?: and)? (?:will|i'?ll) "
    r"(?:see|get back|reply|respond)|do not disturb while driving|this (?:mailbox|inbox|number) is not monitored|"
    r"do not reply to this|vacation (?:reply|responder))\b", re.IGNORECASE)


def cadence_enabled() -> bool:
    """CADENCE_ENABLED (config.py): the Day 1-90 cadence, or Plan 1's single 24h switch."""
    return get_settings().cadence_enabled


def stage_of(value: Any) -> Stage | None:
    try:
        return Stage(value) if value else None
    except ValueError:
        return None


def label(stage: Stage | str | None) -> str | None:
    found = stage_of(stage)
    return STAGE_LABELS[found] if found else None


def is_meaningful_reply(text: str | None) -> tuple[bool, str]:
    """(meaningful, why). The client's definition (scope Q10): a verified
    two-way interaction where the customer gave info, intent, a question, an
    objection, availability or another relevant response. An auto-reply isn't
    one; neither is a message with no words (an emoji, a blank)."""
    body = (text or "").strip()
    if not re.search(r"[A-Za-z0-9]", body):
        return False, "no words in it"
    if _AUTO_REPLY.search(body):
        return False, "it reads as an automatic reply"
    return True, "the customer wrote back"


_MANAGER_OUTCOME_REASON = re.compile(r'manager outcome: "([^"]+)"')


def manager_outcome_from_reason(reason: str | None) -> str | None:
    """The manager outcome sent together with a Sales Visit ('Staff moved the lead to "Visited" (manager
    outcome: "Unsold")', MASTER_PLAN_3 C5): one event for both, so they are applied in order and can't race."""
    m = _MANAGER_OUTCOME_REASON.search(reason or "")
    return m.group(1) if m else None


def staff_status_from_reason(reason: str | None) -> str | None:
    """The platform status a lead-paused event was sent for, from its reason
    ('Staff moved the lead to "Visited"'). None for other pauses (a staff
    reply, an admin take-over): only an explicit status move counts, never the
    lead's current status, which can be left over from earlier."""
    m = _STAFF_STATUS_REASON.search(reason or "")
    return m.group(1) if m else None


# --- Transitions (pure) -----------------------------------------------------------

@dataclass
class Event:
    """Something that may move the lead. `kind`:
    lead_created, customer_replied (detail: next_action), appointment_set,
    appointment_cancelled (detail: next_action), appointment_missed (C5),
    no_show_unanswered (C5), touch2_unanswered (C4), specific_followup_unanswered,
    sales_visit, opted_out, opted_in, day_91 (detail: appointment_active),
    staff_closed_lost, unsold (C5)."""
    kind: str
    reason: str = ""
    detail: dict[str, Any] = field(default_factory=dict)
    source: str = "ai"


@dataclass
class Transition:
    stage: Stage | None  # None: no change
    rule: str
    reason: str
    event: Event | None = None

    @property
    def changes(self) -> bool:
        return self.stage is not None


def _stay(rule: str, reason: str, event: Event) -> Transition:
    return Transition(None, rule, reason, event)


def transition(current: Stage | None, event: Event) -> Transition:
    """Where `event` moves a lead at `current`. Pure: no clock, no database."""
    kind, why = event.kind, event.reason
    if kind == "lead_created":
        if current is None:
            return Transition(Stage.NEW_LEAD, "new_lead", why or "New lead received", event)
        return _stay("already_started", "The lead already has a stage.", event)
    if current is None:
        current = Stage.NEW_LEAD
    if current in CLOSED_STAGES:
        return _stay("closed", f"The lead is {STAGE_LABELS[current]}: nothing moves it (a new lead starts its own "
                               "workflow).", event)

    if kind == "no_longer_owns":
        # MASTER_PLAN_4 D7 (SOLD-DELIVERED PDF §8 "NO"): only a Sold - Delivered opportunity closes this way.
        if current != Stage.SOLD_DELIVERED:
            return _stay("not_delivered", "Only a Sold - Delivered opportunity closes as No Longer Owns.", event)
        return Transition(Stage.CLOSED_NO_LONGER_OWNS, "no_longer_owns",
                          why or "The customer no longer owns the vehicle", event)
    if kind == "staff_closed_lost" and current == Stage.SOLD_DELIVERED:
        # MASTER_PLAN_4 D3: Sold - Delivered stays active "until the associated vehicle ownership ends" (§2); Closed
        # Lost is for a transaction that won't complete (SOLD PENDING PDF §2), which a delivered one already has.
        return _stay("delivered", "Sold - Delivered isn't closed as lost: it closes when the customer no longer owns "
                                  "the vehicle.", event)
    if kind == "staff_closed_lost":
        return Transition(Stage.CLOSED_LOST, "staff_closed_lost", why or "Staff closed the lead as lost", event)
    if kind == "opted_out":
        if current == Stage.OPTED_OUT:
            return _stay("already_opted_out", "Already opted out.", event)
        return Transition(Stage.OPTED_OUT, "opt_out_wins", why or "Opted out", event)
    if current == Stage.OPTED_OUT:
        if kind == "opted_in":
            back = stage_of(event.detail.get("previous")) or Stage.CONTACT_NO_ACTION
            if back == Stage.OPTED_OUT or back in CLOSED_STAGES:
                back = Stage.CONTACT_NO_ACTION
            return Transition(back, "opted_back_in", why or "The customer opted back in", event)
        return _stay("opted_out", "Opted out: only an opt-in moves the lead on.", event)
    if kind == "opted_in":
        return _stay("not_opted_out", "The lead wasn't opted out.", event)

    if kind in ("sold_pending", "sold_delivered"):
        # A manager outcome (MASTER_PLAN_3 C5). Delivered supersedes pending; nothing goes back from delivered.
        new = Stage.SOLD_PENDING if kind == "sold_pending" else Stage.SOLD_DELIVERED
        if current == new or (current == Stage.SOLD_DELIVERED and new == Stage.SOLD_PENDING):
            return _stay("already_sold", f"Already {STAGE_LABELS[current]}.", event)
        return Transition(new, kind, why or f"Manager outcome: {STAGE_LABELS[new]}", event)
    if current in (Stage.SOLD_PENDING, Stage.SOLD_DELIVERED):
        # SOLD PENDING is "not an unsold lead" and never enters the Short-Term cadence (SOLD PENDING PDF §1); its
        # own workflow (MASTER_PLAN_4 D2) runs from scheduler/sold_lifecycles.py. Nothing in the lead workflow moves
        # it: only the two outcomes above, staff Closed Lost and an opt-out.
        return _stay("sold", f"{STAGE_LABELS[current]}: the lead workflow doesn't apply.", event)
    if kind == "unsold":
        # Client, 1 Oct 2026 (scope Q2): back to follow-up for 90 days; a visit is contact, so the stage is
        # Contact Made - No Next Action (§5), and the follow-up period restarts from the Unsold date.
        return Transition(Stage.CONTACT_NO_ACTION, "unsold", why or "Manager outcome: Unsold", event)

    if kind == "sales_visit":
        if current == Stage.SALES_VISIT:
            return _stay("already_visited", "Already at Sales Visit.", event)
        return Transition(Stage.SALES_VISIT, "sales_visit_wins", why or "The customer visited", event)
    if current == Stage.SALES_VISIT:
        return _stay("sales_visit", "Sales Visit stops the lead workflows until a manager outcome.", event)

    if kind == "appointment_set":
        rule = "appointment_updated" if current == Stage.APPOINTMENT_SET else "appointment_wins"
        return Transition(Stage.APPOINTMENT_SET, rule, why or "Appointment booked", event)
    if kind == "appointment_cancelled":
        if current not in (Stage.APPOINTMENT_SET, Stage.NO_SHOW):
            return _stay("no_appointment", "There was no appointment to cancel.", event)
        if event.detail.get("next_action"):
            return Transition(Stage.SPECIFIC_FOLLOWUP, "cancelled_with_next_action",
                              why or "Appointment cancelled; the customer gave a date to follow up", event)
        return Transition(Stage.CONTACT_NO_ACTION, "cancelled", why or "Appointment cancelled, no new time", event)
    if kind == "appointment_missed":
        if current != Stage.APPOINTMENT_SET:
            return _stay("no_appointment", "No appointment was pending.", event)
        return Transition(Stage.NO_SHOW, "no_show", why or "Appointment time + 1 hour with no visit", event)
    if kind == "no_show_unanswered":
        if current != Stage.NO_SHOW:
            return _stay("not_no_show", "The lead isn't at Appointment No Show.", event)
        # Client's required business rule (Omnichannel PDF §9): Contact Made, not No Contact Made.
        return Transition(Stage.CONTACT_NO_ACTION, "no_show_to_short_term",
                          why or "No reply after the no-show messages", event)

    if kind == "customer_replied":
        if current == Stage.APPOINTMENT_SET:
            return _stay("appointment_wins", "An appointment is set: a reply doesn't change that.", event)
        if event.detail.get("next_action"):
            rule = "next_action_updated" if current == Stage.SPECIFIC_FOLLOWUP else "specific_timing_wins"
            return Transition(Stage.SPECIFIC_FOLLOWUP, rule, why or "The customer gave a date to follow up", event)
        if current == Stage.CONTACT_NO_ACTION:
            return _stay("still_contact_made", "Already Contact Made - No Next Action.", event)
        return Transition(Stage.CONTACT_NO_ACTION, "contact_made", why or "The customer replied", event)
    if kind == "touch2_unanswered":
        if current != Stage.NEW_LEAD:
            return _stay("not_new", "Only a New Lead moves to No Contact Made.", event)
        return Transition(Stage.NO_CONTACT, "no_contact", why or "Touch 1 and the 3-hour nudge went unanswered", event)
    if kind == "specific_followup_unanswered":
        if current != Stage.SPECIFIC_FOLLOWUP:
            return _stay("not_specific", "The lead isn't at Specific Follow-Up any more.", event)
        return Transition(Stage.NO_CONTACT, "specific_unanswered",
                          why or "No reply within 24 hours of the scheduled follow-up", event)
    if kind == "day_91":
        if current not in CLOSABLE_AT_DAY_91:
            return _stay("superseded", f"Day 91, but the lead is at {STAGE_LABELS[current]}: that supersedes it.",
                         event)
        if event.detail.get("appointment_active"):
            return _stay("appointment_pending", "Day 91, but an appointment is still pending.", event)
        return Transition(Stage.CLOSED_LOST, "day_91", why or "Day 91 reached with no superseding outcome", event)
    return _stay("unknown_event", f"Unknown event {kind!r}.", event)


def resolve(current: Stage | None, events: list[Event]) -> Transition:
    """Several events at once (a reply that also booked a visit): each is
    tried from the current stage, and the highest-priority result wins
    (§11). An event that changes nothing loses to one that does."""
    if not events:
        return Transition(None, "no_events", "Nothing happened.")
    results = [transition(current, e) for e in events]
    moving = [r for r in results if r.changes]
    if not moving:
        return results[0]
    return min(moving, key=lambda r: PRIORITY[r.stage])  # type: ignore[index]


def kind_allowed(kind: str | None, stage: Stage | str | None) -> bool:
    """May scheduled work of `kind` run while the lead is at `stage`? Leads
    from before C3 (no stage) and kinds C3 doesn't know keep their old
    behaviour, except that nothing runs on a closed or opted-out lead."""
    found = stage_of(stage)
    if found is None:
        return True
    allowed = KIND_STAGES.get(kind or "channel_switch")
    if allowed is None:
        return found not in (Stage.CLOSED_LOST, Stage.OPTED_OUT)
    return found in allowed


def stage_check(state: dict | None, kind: str | None, *, long_horizon: bool = False) -> tuple[str, bool, str]:
    """The pre-send re-check's stage line (scheduler/followups.py), as (check, passed, detail).
    `long_horizon`: a next step kept past Day 91 (cancel_stale_work) may still run on the closed lead."""
    stage = stage_of((state or {}).get("stage"))
    ok = kind_allowed(kind, stage) or (long_horizon and kind == "next_action" and stage == Stage.CLOSED_LOST)
    if stage is None:
        return "stage", True, "no lifecycle stage yet"
    return "stage", ok, (f"lead is at {STAGE_LABELS[stage]}" + ("" if ok else f": no {kind or 'channel_switch'} "
                                                                                 "in this stage"))


# --- Applying (database) ------------------------------------------------------------

def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def opportunity_start(lead: dict | None, now: datetime) -> datetime:
    """The platform lead's own creation time (§12: immutable), else now."""
    for key in ("createdAt", "created_at"):
        if found := _aware((lead or {}).get(key)):
            return found
    oid = (lead or {}).get("_id")
    if hasattr(oid, "generation_time"):
        return oid.generation_time
    return now


def opportunity_age_days(state: dict | None, now: datetime | None = None) -> int | None:
    start = _aware((state or {}).get("opportunity_created_at"))
    if start is None:
        return None
    return ((now or clock.now()) - start).days


async def cancel_stale_work(db: DealerScopedDatabase, lead_id: str, stage: Stage, *, reason: str) -> int:
    """§2 "status change cancels stale work": pending scheduled work whose
    kind doesn't belong to the new stage."""
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    pending = await followups.find({"lead_id": lead_id, "status": "pending"}).to_list(None)
    if stage == Stage.CLOSED_LOST:
        # §6 long-horizon rule: a dated next step the customer asked for outlives the
        # opportunity ("call me in a year"); it stays with the customer and still fires.
        keep = [p["_id"] for p in pending if p.get("kind") == "next_action"]
        if keep:
            await followups.update_many({"_id": {"$in": keep}}, {"$set": {"long_horizon": True}})
        pending = [p for p in pending if p["_id"] not in keep]
    if not kind_allowed("call_task", stage):
        # An open call task is stale too (an appointment, a visit, an opt-out or a close came first).
        from upsell_agent.agent import call_tasks
        await call_tasks.cancel_open(db, lead_id, reason)
    elif not kind_allowed("daily_call_task", stage):
        # stream T: an open Days 1-7 call task is obsolete once the lead leaves Short-Term ("Status changed
        # first: cancel obsolete call task").
        from upsell_agent.agent import call_tasks
        await call_tasks.cancel_open(db, lead_id, reason, source="daily")
    stale =[p["_id"] for p in pending if not kind_allowed(p.get("kind") or "channel_switch", stage)]
    if not stale:
        return 0
    result = await followups.update_many(
        {"_id": {"$in": stale}, "status": "pending"},
        {"$set": {"status": "cancelled", "reason": reason, "closed_at": clock.now()}})
    return result.modified_count


async def apply(db: DealerScopedDatabase, lead_id: str | None, events: list[Event], *,
                lead: dict | None = None, customer_id: str | None = None) -> dict[str, Any] | None:
    """Moves the lead per `events` (resolve()) and records it on the AI's
    lead state: the stage, why, when, an add-only history (last HISTORY_LIMIT),
    the dated next action, and the closing time. Cancels the old workflow's
    pending work. Returns what happened, for the trace; None without a lead."""
    if not lead_id or not events:
        return None
    now = clock.now()
    states = db.collection(AI_LEAD_STATE_COLLECTION)
    state = await states.find_one({"lead_id": lead_id}) or {}
    current = stage_of(state.get("stage"))
    setup: dict[str, Any] = {}
    if current is None or not state.get("opportunity_created_at"):
        # The first event for this lead, or a lead from before C3: start its clock from the platform lead.
        lead = lead if lead is not None else await db.collection(PLATFORM_LEADS_COLLECTION).find_one(
            {"_id": as_object_id(lead_id)})
        setup["opportunity_created_at"] = opportunity_start(lead, now)
    result = resolve(current, events)
    out: dict[str, Any] = {"from": current.value if current else None, "rule": result.rule,
                           "reason": result.reason, "changed": result.changes}
    if not result.changes:
        if setup:
            await states.update_one({"lead_id": lead_id}, {"$set": setup,
                                                          "$setOnInsert": {"lead_id": lead_id, "created_at": now,
                                                                           "status": "active"}}, upsert=True)
        out["stage"] = current.value if current else None
        return out
    new = result.stage
    assert new is not None
    event = result.event or events[0]
    entry = {"at": now, "from": current.value if current else None, "to": new.value, "rule": result.rule,
             "reason": result.reason, "event": event.kind, "source": event.source}
    fields: dict[str, Any] = {**setup, "stage": new.value, "stage_label": STAGE_LABELS[new],
                              "stage_reason": result.reason, "stage_at": now, "stage_source": event.source}
    unset: dict[str, str] = {}
    if new != current:
        fields["workflow_entered_at"] = now
        if current is not None:
            fields["previous_stage"] = current.value
    # MASTER_PLAN_3 C4: entering Short-Term from outside it starts that instance's cadence
    # (Omnichannel PDF §3's triggers). Re-entry - after a no-show, an Unsold visit, or a dated step
    # that went unanswered - starts a fresh schedule that skips the introduction, and never resets
    # the Day 91 opportunity clock (§12, decision 149).
    if new in SHORT_TERM and (current is None or current not in SHORT_TERM) and cadence_enabled():
        reentered = current is not None
        fields["cadence"] = cadence.started(cadence.CadenceState.load(state), at=now,
                                            reentered=reentered).as_dict()
        out["cadence_started"] = {"reentered": reentered}
    next_action = event.detail.get("next_action")
    if new == Stage.SPECIFIC_FOLLOWUP and next_action:
        fields["next_action"] = {**next_action, "entered_at": now}
    elif new != Stage.SPECIFIC_FOLLOWUP:
        unset["next_action"] = ""
    if new == Stage.APPOINTMENT_SET and event.detail.get("appointment"):
        fields["appointment"] = {**event.detail["appointment"], "set_at": now}
    if event.kind == "unsold":
        # Unsold restarts the Day 91 follow-up period from today (client, scope Q2). `opportunity_created_at`
        # itself is never touched (§12); the sweep counts from this anchor.
        fields["day91_anchor"] = now
    elif setup.get("opportunity_created_at"):
        fields["day91_anchor"] = setup["opportunity_created_at"]
    if new in CLOSED_STAGES:
        # MASTER_PLAN_4 D3 (SOLD-DELIVERED PDF §14): closed_at / closed_reason on both closed statuses.
        fields.update(opportunity_closed_at=now, closed_at=now,
                      closed_reason=event.detail.get("closed_reason") or result.rule)
    update: dict[str, Any] = {"$set": fields, "$push": {"stage_history": {"$each": [entry], "$slice": -HISTORY_LIMIT}},
                              "$setOnInsert": {"lead_id": lead_id, "created_at": now, "status": "active",
                                               **({"customer_id": customer_id} if customer_id else {})}}
    if unset:
        update["$unset"] = unset
    await states.update_one({"lead_id": lead_id}, update, upsert=True)
    cancelled = 0
    if new != current:
        cancelled = await cancel_stale_work(db, lead_id, new, reason=f"stage changed to {STAGE_LABELS[new]}")
    out.update(stage=new.value, label=STAGE_LABELS[new], cancelled=cancelled)
    if new != current and new in CLOSED_STAGES:
        # PLAN_4 stream S: the AI's own closing (Day 91, No Longer Owns) shows as the CRM lead's status too.
        from upsell_agent.agent import crm_status
        if event.kind in crm_status.CRM_STATUS_FOR_EVENT:
            out["crm_status"] = await crm_status.sync_closed(db, lead_id, event.kind, reason=result.reason,
                                                             closed_at=now)
    if new != current:
        # PLAN_4 stream L: an appointment, a visit or an opt-out is credited to the lead's latest touch.
        from upsell_agent.learning import touches
        await touches.on_stage_change(db, lead_id, new, at=now)
        # MASTER_PLAN_4 D1/D8 (stream A3): a manager outcome starts exactly one lifecycle and stops the others, and
        # every lead opening or closing recalculates the customer's ACTIVE / INACTIVE status.
        from upsell_agent.scheduler import sold_lifecycles
        out.update(await sold_lifecycles.on_stage_change(
            db, lead_id, current, new, event, lead=lead,
            customer_id=customer_id or state.get("customer_id")))
        # PLAN_4 stream X3 item 8: a finished primary releases the duplicate leads linked to it.
        from upsell_agent.agent import duplicates
        if new.value in duplicates.FINISHED_STAGES and (released := await duplicates.release_linked(db, lead_id)):
            out["released_duplicates"] = released
    return out


# --- Day 91 ---------------------------------------------------------------------------

async def close_expired(now: datetime | None = None, *, limit: int = 1000) -> dict[str, Any]:
    """The Day 91 sweep (§4, §12; client, scope Q1): every lead whose
    opportunity is 91 days old and still in a Short-Term / Day 1-90 stage
    closes as Closed - Lost. Cross-dealer by design, like the follow-up claim
    (one query; each lead is then handled through its own dealer's scope).
    A pending appointment supersedes it (Appointment Set / No Show aren't
    closable), and a booking on the platform lead is checked again here."""
    from upsell_agent.tools.booking_tool import find_active_booking

    now = now or clock.now()
    cutoff = now - timedelta(days=OPPORTUNITY_DAYS)
    rows = await get_db()[AI_LEAD_STATE_COLLECTION].find(
        {"stage": {"$in": [s.value for s in CLOSABLE_AT_DAY_91]},
         "$or": [{"day91_anchor": {"$lte": cutoff}},
                 {"day91_anchor": {"$exists": False}, "opportunity_created_at": {"$lte": cutoff}}]}
    ).to_list(limit)
    summary: dict[str, Any] = {"checked": len(rows), "closed": 0, "kept": 0}
    # Closings the CRM couldn't take at an earlier sweep (stream S) are tried again first.
    from upsell_agent.agent import crm_status
    retried = await crm_status.retry_failed()
    for row in rows:
        dealer_id, lead_id = row.get("dealer_id"), row.get("lead_id")
        if not dealer_id or not lead_id:
            continue
        db = dealer_scoped_db(dealer_id)
        lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})
        active = await find_active_booking(dealer_id, lead)
        moved = await apply(db, lead_id, [Event("day_91", detail={"appointment_active": bool(active),
                                                                  "closed_reason": "day_91_no_response"},
                                                source="day_91_sweep")], lead=lead)
        if moved and moved.get("changed"):
            summary["closed"] += 1
        else:
            summary["kept"] += 1
    summary["crm_status_retry"] = retried
    return summary
