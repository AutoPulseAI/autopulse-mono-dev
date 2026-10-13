"""AI Studio timing and added cadences (client, 13 Oct 2026: "give them the option of the timing ... number of days,
hours, minutes, years, months, weeks ... how much time they want in each cadence" and "they must be able to add the
workflows, cadences, buckets ... control the complete AI").

Each test publishes a cadence the way the CRM does and checks when its touches are due, what is sent and on which
channels.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from tests.unit.conftest import set_clock
from tests.unit.test_ai_studio_live import _default, _publish
from tests.unit.test_cadence import (
    _deps,
    _fire_next_touch,
    _new_lead,
    _outbox,
    _pending_touches,
    _plan_all,
    live_dealer,  # noqa: F401 - the fixture
    pytestmark_flow,
)
from upsell_agent import ai_studio
from upsell_agent.agent import appointment, cadence, lifecycle, owner_touches, sold_pending, timing
from upsell_agent.integrations.mongodb import DEV_OUTBOX_COLLECTION, SCHEDULED_FOLLOWUPS_COLLECTION
from upsell_agent.scheduler import followups, studio_cadences

NY = ZoneInfo("America/New_York")
STARTED = datetime(2026, 10, 6, 9, 30, tzinfo=NY)  # a Tuesday


def _sales():
    return _default("cadences", "sales_days_1_7")


# --- Waits in any unit ----------------------------------------------------------------------------------------------

def test_every_unit():
    at = datetime(2026, 1, 31, 9, 0, tzinfo=UTC)
    assert timing.add(at, 45, "minutes") == at + timedelta(minutes=45)
    assert timing.add(at, 2, "hours") == at + timedelta(hours=2)
    assert timing.add(at, 3, "days") == at + timedelta(days=3)
    assert timing.add(at, 2, "weeks") == at + timedelta(weeks=2)
    assert timing.add(at, 1, "months") == datetime(2026, 2, 28, 9, 0, tzinfo=UTC)  # calendar months
    assert timing.add(at, 1, "years") == datetime(2027, 1, 31, 9, 0, tzinfo=UTC)
    assert timing.due(at, {"amount": 1, "unit": "days", "at": "2:30 PM"}, UTC) == datetime(2026, 2, 1, 14, 30,
                                                                                           tzinfo=UTC)


# --- The sales cadence's timing -------------------------------------------------------------------------------------

async def test_an_untouched_timing_is_the_clients_schedule_exactly(mongo):
    before = _plan_all(STARTED)
    content = _sales()
    content["steps"][2]["label"] = "Vehicle photo"  # edited, but not its timing
    await _publish(mongo, "cadences", "sales_days_1_7", content)
    assert cadence.SCHEDULE is not None
    assert _plan_all(STARTED) == before


async def test_a_touch_can_wait_minutes_hours_days_weeks(mongo):
    content = _sales()
    content["steps"][1]["wait"] = {"amount": 45, "unit": "minutes", "after": "previous"}  # the name nudge
    content["steps"][2]["wait"] = {"amount": 2, "unit": "weeks", "after": "start", "at": "3:00 PM"}
    await _publish(mongo, "cadences", "sales_days_1_7", content)
    state = cadence.started(cadence.CadenceState(), at=STARTED)
    nudge = cadence.plan_touch(state, now=STARTED, tz=NY, first_contact_done=True)
    assert nudge.theme is cadence.NAME_NUDGE and nudge.due_at == STARTED + timedelta(minutes=45)
    state = cadence.after_touch(state, nudge, at=nudge.due_at)
    third = cadence.plan_touch(state, now=nudge.due_at, tz=NY, first_contact_done=True)
    assert third.due_at == datetime(2026, 10, 20, 15, 0, tzinfo=NY) and third.theme.id == "vehicle_visual"


async def test_the_repeating_phases_and_the_close_can_be_changed(mongo):
    nurture = _default("cadences", "sales_days_8_30")
    nurture["repeat"]["every"] = {"amount": 3, "unit": "days", "at": "10:00"}
    deeper = _default("cadences", "sales_days_31_90")
    deeper["repeat"] = {"first": {"amount": 2, "unit": "months", "after": "start", "at": "10:00"},
                        "every": {"amount": 1, "unit": "months", "at": "10:00"},
                        "until": {"amount": 5, "unit": "months", "after": "start"}}
    deeper["closes_after"] = {"amount": 6, "unit": "months", "after": "start"}
    await _publish(mongo, "cadences", "sales_days_8_30", nurture)
    await _publish(mongo, "cadences", "sales_days_31_90", deeper)
    days = [day for _, day, _ in _plan_all(STARTED)[7:]]
    assert days[:6] == [14, 17, 20, 23, 26, 29]
    assert days[6:] == [62, 93, 124, 152]  # Dec 6, Jan 6, Feb 6, Mar 6
    assert lifecycle.OPPORTUNITY_DAYS == 182 and cadence.LAST_DAY == 181


async def test_an_added_touch_gets_its_own_time(mongo):
    content = _sales()
    content["steps"].insert(3, {"id": "test_drive_reminder", "label": "Test drive reminder", "channels": ["sms"],
                                "wait": {"amount": 4, "unit": "hours", "after": "previous"},
                                "message": {"mode": "fixed", "text": "Still up for a test drive this week?"}})
    await _publish(mongo, "cadences", "sales_days_1_7", content)
    plan = _plan_all(STARTED)
    assert plan[1][2] == "vehicle_visual" and plan[2][2] == "test_drive_reminder"


@pytestmark_flow
async def test_a_touch_goes_out_only_on_its_channels_and_word_for_word(mongo):
    content = _sales()
    content["steps"][2].update({"channels": ["email"], "message": {
        "mode": "fixed", "text": "Hi {first_name}, would you like to see the car in person this week?"}})
    await _publish(mongo, "cadences", "sales_days_1_7", content)
    created = await _new_lead()
    await _fire_next_touch(mongo, created)  # the name nudge
    before = len(await _outbox(mongo, created))
    fired = await _fire_next_touch(mongo, created)
    assert fired["touch"]["touch"]["theme"] == "vehicle_visual"
    new = (await _outbox(mongo, created))[before:]
    assert [r["channel"] for r in new] == ["email"]
    assert "Hi Maria, would you like to see the car in person this week?" in new[0]["text"]


async def test_other_cadences_timing(mongo):
    pending = _default("cadences", "sold_pending")
    for i, step in enumerate(pending["steps"]):
        step["wait"] = {"amount": 3 * (i + 1), "unit": "days", "after": "start"}
    await _publish(mongo, "cadences", "sold_pending", pending)
    assert [sold_pending.touch_due_day(n) for n in range(1, 9)] == [3, 6, 9, 12, 15, 18, 21, 24]
    owner = _default("cadences", "owner_lifecycle")
    next(s for s in owner["steps"] if s["id"] == "review_referral")["wait"] = {"amount": 1, "unit": "weeks",
                                                                               "after": "start"}
    await _publish(mongo, "cadences", "owner_lifecycle", owner)
    assert owner_touches.OWNER_TOUCH_DAYS["review_referral"] == 7
    appt = _default("cadences", "appointment")
    next(s for s in appt["steps"] if s["id"] == appointment.STEP_NO_SHOW_CHECK)["wait"] = {
        "amount": 30, "unit": "minutes", "after": "start"}
    await _publish(mongo, "cadences", "appointment", appt)
    assert appointment.NO_SHOW_AFTER == timedelta(minutes=30)
    ai_studio.reset()
    assert appointment.NO_SHOW_AFTER == timedelta(hours=1) and sold_pending.touch_due_day(1) == 1


# --- Added cadences -------------------------------------------------------------------------------------------------

def _added(starts_when, steps):
    return {"starts_when": starts_when, "stops_when": ["customer replies", "appointment set", "opt-out"],
            "steps": steps}


@pytestmark_flow
async def test_an_added_cadence_starts_on_a_status_and_follows_its_timing(mongo):
    await _publish(mongo, "cadences", "be_back", _added({"type": "status", "status": "Unsold"}, [
        {"id": "a", "label": "Thanks for visiting", "channels": ["sms"],
         "wait": {"amount": 2, "unit": "hours", "after": "start"},
         "message": {"mode": "fixed", "text": "Thanks for stopping by today, {first_name}! Any questions?"}},
        {"id": "b", "label": "Two days later", "channels": ["sms", "email"],
         "wait": {"amount": 2, "unit": "days", "after": "previous", "at": "11:00"},
         "message": {"mode": "fixed", "text": "Still thinking it over? I'm happy to help."}}]))
    created = await _new_lead()
    started = await studio_cadences.start(_db(), lead_id=created["lead_id"], customer_id=created["customer_id"],
                                          channel="sms", trigger={"type": "status", "status": "unsold"})
    assert started[0]["created"] and started[0]["timing"] == "2 hours after the start"
    [doc] = await _studio(mongo, created)
    set_clock(doc["due_at"].replace(tzinfo=UTC) + timedelta(minutes=1))
    assert (await followups.fire_due(_deps()))["results"].get("sent") == 1
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    assert rows[-1]["text"] == "Thanks for stopping by today, Maria! Any questions?" and rows[-1]["channel"] == "sms"
    [nxt] = await _studio(mongo, created)
    assert nxt["due_at"].replace(tzinfo=UTC).astimezone(NY).hour == 11 and nxt["step_index"] == 1


@pytestmark_flow
async def test_an_added_cadence_stops_when_the_customer_replies(mongo):
    from tests.unit.test_cadence import _say
    await _publish(mongo, "cadences", "check_in", _added({"type": "lead_created"}, [
        {"id": "a", "channels": ["sms"], "wait": {"amount": 1, "unit": "days", "after": "start"},
         "message": {"mode": "fixed", "text": "CHECK-IN TEXT"}}]))
    created = await _new_lead()
    assert await _studio(mongo, created)
    await _say(created, "Thanks, I'll come Saturday")
    [doc] = await _studio(mongo, created)
    set_clock(doc["due_at"].replace(tzinfo=UTC) + timedelta(minutes=1))
    await followups.fire_due(_deps())
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    assert not any(r["text"] == "CHECK-IN TEXT" for r in rows)


@pytestmark_flow
async def test_an_added_cadence_doesnt_move_the_sales_cadence(mongo):
    await _publish(mongo, "cadences", "check_in", _added({"type": "lead_created"}, [
        {"id": "a", "channels": ["sms"], "wait": {"amount": 30, "unit": "minutes", "after": "start"},
         "message": {"mode": "fixed", "text": "CHECK-IN TEXT"}}]))
    created = await _new_lead()
    [doc] = await _studio(mongo, created)
    set_clock(doc["due_at"].replace(tzinfo=UTC) + timedelta(minutes=1))
    await followups.fire_due(_deps())
    [touch] = await _pending_touches(mongo, created)
    assert touch["touch"]["theme"] == "name_nudge"  # still the sales cadence's own next touch


@pytestmark_flow
async def test_an_added_message_is_sent_when_the_customer_says_its_words(mongo):
    from tests.unit.test_cadence import _say
    await _publish(mongo, "messages", "hours", {
        "send_when": {"phrases": ["what time do you close", "your hours"]},
        "message": {"mode": "fixed", "text": "We're open Monday to Saturday, 9 AM to 7 PM."}})
    created = await _new_lead()
    await _say(created, "What are your hours?")
    assert (await _outbox(mongo, created))[-1]["text"] == "We're open Monday to Saturday, 9 AM to 7 PM."


def _db():
    from tests.unit.test_cadence import DEALER
    from upsell_agent.integrations.mongodb import dealer_scoped_db
    return dealer_scoped_db(DEALER)


async def _studio(mongo, created):
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "kind": "studio_touch", "status": "pending"}).to_list(None)
