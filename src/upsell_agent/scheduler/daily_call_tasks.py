"""The Days 1-7 human call tasks (PLAN_4 stream T; Omnichannel PDF §3 "Human call tasks - Days 1-7").

The client's rule: "Human agents receive two call tasks per scheduled workday for seven days."

    Morning     a call task during the assigned agent's hours (open .. noon); Click-to-Call on the Call Tasks page
    Afternoon   a second one (noon .. close), only if the lead still has an eligible Short-Term status
    Completion  staff mark it done (the outcome prompt, CallOutcomeModal) - or it is marked `missed` at the end of
                its window (agent/call_tasks.py mark_missed)
    Status changed first: the obsolete call task is cancelled (agent/lifecycle.py cancel_stale_work)

**A per-dealer setting**, `dealer_account_information.ai_daily_call_tasks` ("off" | "on", unset = on), on the
CRM's AI Settings page: the client hasn't said whether these and the 60-minute task after each touch
(agent/call_tasks.py) are the same thing (scope Q8), so a dealer can turn these off and keep only the 60-minute one.

**The windows** come from the dealer's opening hours (they stand in for the agents' schedule, as in
compliance/call_check.py): morning = opening .. 12:00, afternoon = 12:00 .. closing, on the dealer's working days
only, for cadence Days 1-7 (Day 1 = the day this Short-Term instance started, agent/cadence.py).

**One waiting record per lead** (`scheduled_followups`, kind `daily_call_task`), chained: when one half-day's
record is done with, the next half-day's is planned. Planning also starts from every cadence touch
(scheduler/followups.py plan_cadence_touch), so the chain starts with the cadence and restarts on re-entry.

**At window start, re-checked** (under the lead lock): the setting, the dealer's AI is live, the lead's stage is a
Short-Term one, not opted out, no meaningful reply since the window began (a reply cancels this half-day's call).
Then the dedupe:

- a call task already open for the lead (a 60-minute one, a requested one) covers this half-day;
- a 60-minute timer that will open inside this half-day covers it too;
- at most 2 call tasks per lead per workday in all (any source).

Then the call rules (compliance/call_check.py: a valid phone, voice opt-out, DND, 8:00-21:00 customer time and the
customer's state's live-call row, dealer hours). HOLD to a time inside the window waits; past the window, skipped.
The task is assigned to the lead's `assigned_to` and is due by the end of its window.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import cadence, call_tasks, lifecycle
from upsell_agent.channels import consent
from upsell_agent.compliance.call_check import can_call
from upsell_agent.integrations.dealer_mode import dealer_ai_mode
from upsell_agent.integrations.dealer_profile import DealerProfile, dealer_profile
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
)
from upsell_agent.observability.trace import TurnTracer

KIND = "daily_call_task"
MORNING, AFTERNOON = "morning", "afternoon"
NOON = time(12)
DAYS = 7
MAX_PER_WORKDAY = 2
CONNECTION_TIMER_KIND = "call_task"


@dataclass(frozen=True)
class Slot:
    day: int
    slot: str
    start: datetime
    end: datetime

    @property
    def key(self) -> str:
        return f"{self.start.date().isoformat()}:{self.slot}"


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def windows(profile: DealerProfile, day: date) -> list[tuple[str, datetime, datetime]]:
    """The morning and afternoon windows on a dealer-local date (none on a day the dealer is closed)."""
    hours = profile.hours.get(day.weekday())
    if not hours:
        return []
    opens, closes = hours
    out = []
    if opens < NOON:
        out.append((MORNING, opens, min(NOON, closes)))
    if closes > NOON:
        out.append((AFTERNOON, max(opens, NOON), closes))
    return [(name, datetime.combine(day, a, tzinfo=profile.tz), datetime.combine(day, b, tzinfo=profile.tz))
            for name, a, b in out if a < b]


def slots(profile: DealerProfile, started_at: datetime) -> list[Slot]:
    """Every half-day window of Days 1-7 of a Short-Term instance that started at `started_at`."""
    first = started_at.astimezone(profile.tz).date()
    return [Slot(n + 1, name, start, end)
            for n in range(DAYS)
            for name, start, end in windows(profile, first + timedelta(days=n))]


async def plan(db: DealerScopedDatabase, *, lead_id: str, customer_id: str,
               lead_state: dict | None = None) -> dict[str, Any]:
    """The lead's next half-day call task, unless one is already waiting. Idempotent."""
    profile = await dealer_profile(db.dealer_id)
    if not profile.daily_call_tasks:
        return {"created": False, "reason": "the dealer turned the Days 1-7 call tasks off"}
    state = lead_state if lead_state is not None else await db.collection(AI_LEAD_STATE_COLLECTION).find_one(
        {"lead_id": lead_id})
    stage = (state or {}).get("stage")
    if lifecycle.stage_of(stage) is None or not lifecycle.kind_allowed(KIND, stage):
        return {"created": False, "reason": f"no Days 1-7 call task at stage {stage}"}
    started = _aware(cadence.CadenceState.load(state).started_at)
    if started is None:
        return {"created": False, "reason": "the Short-Term cadence hasn't started"}
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    if await followups.find_one({"lead_id": lead_id, "kind": KIND, "status": {"$in": ["pending", "claimed"]}}):
        return {"created": False, "reason": "the next Days 1-7 call task is already planned"}
    used = {d.get("slot_key") for d in await followups.find(
        {"lead_id": lead_id, "kind": KIND}, projection={"slot_key": 1}).to_list(None)}
    now = clock.now()
    for slot in slots(profile, started):
        if slot.end <= now or slot.key in used:
            continue
        due = max(slot.start, now)
        inserted = await followups.insert_one({
            "kind": KIND, "lead_id": lead_id, "customer_id": customer_id, "from_channel": "voice",
            "to_channel": "voice", "status": "pending", "due_at": due.astimezone(UTC), "created_at": now,
            "claim_count": 0, "slot": slot.slot, "slot_key": slot.key, "day": slot.day,
            "window_start": slot.start.astimezone(UTC), "window_end": slot.end.astimezone(UTC),
            "reason": f"Day {slot.day} {slot.slot} call task (Days 1-7)"})
        return {"created": True, "followup_id": str(inserted.inserted_id), "day": slot.day, "slot": slot.slot,
                "due_at": due.astimezone(UTC).isoformat()}
    return {"created": False, "reason": "no Days 1-7 half-day left"}


async def cancel_current(db: DealerScopedDatabase, lead_id: str, *, reason: str) -> int:
    """A reply / staff contact: this half-day's waiting record is cancelled (later half-days stay planned)."""
    now = clock.now()
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    flt = {"lead_id": lead_id, "kind": KIND, "status": "pending", "window_start": {"$lte": now}}
    current = await followups.find(flt).to_list(None)
    if not current:
        return 0
    result = await followups.update_many(flt, {"$set": {"status": "cancelled", "reason": reason, "closed_at": now}})
    await plan(db, lead_id=lead_id, customer_id=current[0]["customer_id"])
    return result.modified_count


def _workday_bounds(profile: DealerProfile, at: datetime) -> tuple[datetime, datetime]:
    day = at.astimezone(profile.tz).date()
    start = datetime.combine(day, time(0), tzinfo=profile.tz)
    return start.astimezone(UTC), (start + timedelta(days=1)).astimezone(UTC)


async def opened_today(db: DealerScopedDatabase, lead_id: str, profile: DealerProfile) -> int:
    day_start, day_end = _workday_bounds(profile, clock.now())
    return await db.collection(AI_CALL_TASKS_COLLECTION).count_documents(
        {"lead_id": lead_id, "opened_at": {"$gte": day_start, "$lt": day_end}})


async def workday_cap_check(db: DealerScopedDatabase, lead_id: str) -> tuple[str, bool, str]:
    """The 60-minute task's line for the 2-a-workday cap (only while this dealer has the daily tasks on)."""
    profile = await dealer_profile(db.dealer_id)
    if not profile.daily_call_tasks:
        return "workday_cap", True, "Days 1-7 call tasks are off: no daily cap"
    opened = await opened_today(db, lead_id, profile)
    return ("workday_cap", opened < MAX_PER_WORKDAY,
            f"{opened} call task(s) for this lead today (at most {MAX_PER_WORKDAY})")


async def fire(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    """followups.fire_one's handler for KIND (under the lead lock)."""
    from upsell_agent.scheduler.followups import _close, _log

    doc_id, lead_id = str(doc["_id"]), doc["lead_id"]
    now = clock.now()
    window_start, window_end = _aware(doc["window_start"]), _aware(doc["window_end"])
    tracer = TurnTracer(sink=deps.sink, dealer_id=db.dealer_id, lead_id=lead_id, customer_id=doc["customer_id"],
                        trigger="daily_call_task", channel="voice", store_prompts=deps.store_prompts,
                        turn_id=f"daily-call-{doc_id}-fire{int(doc.get('claim_count') or 1)}")
    await tracer.start({"followup_id": doc_id, "day": doc.get("day"), "slot": doc.get("slot")})
    profile = await dealer_profile(db.dealer_id)
    tasks = db.collection(AI_CALL_TASKS_COLLECTION)
    decision = None
    async with tracer.node("daily_call_task", {"followup_id": doc_id, "due_at": doc["due_at"]}) as span:
        state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) or {}
        mode = await dealer_ai_mode(db.dealer_id)
        inbound = await db.collection(AI_MESSAGES_COLLECTION).find(
            {"lead_id": lead_id, "direction": "inbound", "created_at": {"$gte": window_start}}).to_list(None)
        contact = [m for m in inbound if lifecycle.is_meaningful_reply(m.get("text"))[0]]
        checks = [
            ("setting_on", profile.daily_call_tasks, "Days 1-7 call tasks are " +
             ("on" if profile.daily_call_tasks else "off") + " for this dealer"),
            ("dealer_live", mode == "live", f"dealer AI mode is {mode}"),
            lifecycle.stage_check(state, KIND),
            ("not_opted_out", state.get("status") != "opted_out", f"lead is {state.get('status', 'active')}"),
            ("in_window", now < window_end, f"the {doc.get('slot')} window ends {window_end.isoformat()}"),
            ("no_contact", not contact, "the customer replied this half-day: no call needed" if contact
             else "no meaningful reply this half-day"),
        ]
        failed = [c for c in checks if not c[1]]
        skip = None
        if not failed:
            if await tasks.find_one({"lead_id": lead_id, "status": call_tasks.OPEN}):
                skip = "a call task is already open for this lead"
            elif await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).find_one(
                    {"lead_id": lead_id, "kind": CONNECTION_TIMER_KIND, "status": {"$in": ["pending", "claimed"]},
                     "due_at": {"$lt": window_end}}):
                skip = "the 60-minute call task after the latest touch covers this half-day"
            else:
                opened = await opened_today(db, lead_id, profile)
                if opened >= MAX_PER_WORKDAY:
                    skip = f"already {opened} call tasks for this lead today (at most {MAX_PER_WORKDAY})"
        if skip:
            checks.append(("dedupe", False, skip))
        elif not failed:
            decision = await can_call(dealer_id=db.dealer_id, customer_id=doc["customer_id"], lead_id=lead_id,
                                      request_id=f"daily-call-{doc_id}")
            checks.append(("call_check", decision.outcome == "ALLOW", decision.summary()))
        span.output = {"checks": [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks],
                       "call_check": decision.as_dict() if decision else None}
        span.reasoning = [f"{'OK' if ok else 'no'}: {d}" for _, ok, d in checks]

    async def done(status: str, reason: str, **fields: Any) -> str:
        await _close(db, doc, status, reason=reason, **fields)
        await _log(db, tracer, f"daily_call_task_{status}", {"followup_id": doc_id, "reason": reason})
        await plan(db, lead_id=lead_id, customer_id=doc["customer_id"])
        return status

    if failed:
        return await done("cancelled", failed[0][2])
    if skip:
        return await done("skipped", skip)
    assert decision is not None
    if decision.outcome == "HOLD" and decision.until:
        until = _aware(decision.until)
        if until < window_end:
            await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
                {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
                {"$set": {"status": "pending", "due_at": until,
                          "reason": f"held until the next calling time: {decision.reason}"}})
            await _log(db, tracer, "daily_call_task_deferred", {"followup_id": doc_id, "due_at": until.isoformat()})
            return "deferred"
        return await done("skipped", f"no calling time left in this half-day: {decision.reason}")
    if decision.outcome != "ALLOW":
        return await done("suppressed", f"{decision.outcome}: {decision.reason}")
    customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one({"_id": as_object_id(doc["customer_id"])})
    lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})
    name = (customer or {}).get("name") or (lead or {}).get("name")
    phone = await consent.usable_recipient(db, lead, customer, "sms") or ""
    task = await call_tasks.open_task(
        db, lead_id=lead_id, customer_id=doc["customer_id"], phone=phone, customer_name=name,
        reason=f"Day {doc.get('day')} {doc.get('slot')} call (Days 1-7)", source_turn_id=None,
        followup_id=doc_id, created_at=doc["created_at"],
        notice=f"Day {doc.get('day')} {doc.get('slot')} call: please call {name or 'the customer'} at {phone}.",
        extra={"source": "daily", "slot": doc.get("slot"), "day": doc.get("day"), "window_start": window_start,
               "due_by": window_end})
    return await done("activated", "call task opened for staff", task_id=str(task["_id"]), fired_at=now)
