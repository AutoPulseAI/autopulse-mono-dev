"""MASTER_PLAN_3 C3: the lead lifecycle (agent/lifecycle.py) - the stages,
their priority (Omnichannel PDF §11), the response router (§5), the Day 91
clock (§12), "status change cancels stale work" (§2), the dated next step
(§6), staff statuses, and the client's 1 Oct answers (Closed - Lost per lead;
"not interested" → ask why, then a person decides)."""

from datetime import UTC, datetime, timedelta

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent import lifecycle
from upsell_agent.agent.lifecycle import Event, Stage, transition
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels import consent
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent, LeadPausedEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    as_object_id,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.scheduler import followups
from upsell_agent.slots.dates import resolve as resolve_date

DEALER = simulate.DEV_DEALERS[0]["_id"]


# --- Pure rules ----------------------------------------------------------------------

@pytest.mark.parametrize(("current", "event", "expected"), [
    (None, Event("lead_created"), Stage.NEW_LEAD),
    (Stage.NEW_LEAD, Event("customer_replied"), Stage.CONTACT_NO_ACTION),
    (Stage.NO_CONTACT, Event("customer_replied"), Stage.CONTACT_NO_ACTION),
    (Stage.NEW_LEAD, Event("customer_replied", detail={"next_action": {"date": "2026-11-01"}}),
     Stage.SPECIFIC_FOLLOWUP),
    (Stage.SPECIFIC_FOLLOWUP, Event("customer_replied"), Stage.CONTACT_NO_ACTION),
    (Stage.NO_SHOW, Event("customer_replied"), Stage.CONTACT_NO_ACTION),
    (Stage.NEW_LEAD, Event("touch2_unanswered"), Stage.NO_CONTACT),
    (Stage.SPECIFIC_FOLLOWUP, Event("specific_followup_unanswered"), Stage.NO_CONTACT),
    (Stage.CONTACT_NO_ACTION, Event("appointment_set"), Stage.APPOINTMENT_SET),
    (Stage.APPOINTMENT_SET, Event("appointment_missed"), Stage.NO_SHOW),
    # The client's required rule (Omnichannel PDF §9): no reply after a no-show is Contact Made.
    (Stage.NO_SHOW, Event("no_show_unanswered"), Stage.CONTACT_NO_ACTION),
    (Stage.APPOINTMENT_SET, Event("appointment_cancelled"), Stage.CONTACT_NO_ACTION),
    (Stage.APPOINTMENT_SET, Event("appointment_cancelled", detail={"next_action": {"date": "2026-11-01"}}),
     Stage.SPECIFIC_FOLLOWUP),
    (Stage.APPOINTMENT_SET, Event("sales_visit"), Stage.SALES_VISIT),
    (Stage.SALES_VISIT, Event("unsold"), Stage.CONTACT_NO_ACTION),
    (Stage.CONTACT_NO_ACTION, Event("day_91"), Stage.CLOSED_LOST),
    (Stage.APPOINTMENT_SET, Event("opted_out"), Stage.OPTED_OUT),
    (Stage.OPTED_OUT, Event("opted_in", detail={"previous": "appointment_set"}), Stage.APPOINTMENT_SET),
    (Stage.CONTACT_NO_ACTION, Event("staff_closed_lost"), Stage.CLOSED_LOST),
])
def test_transitions(current, event, expected):
    assert transition(current, event).stage == expected


@pytest.mark.parametrize(("current", "event"), [
    # An appointment wins over an ordinary reply (§11: appointment set outranks contact made).
    (Stage.APPOINTMENT_SET, Event("customer_replied")),
    # Sales Visit stops the lead workflows: only a manager outcome moves it.
    (Stage.SALES_VISIT, Event("customer_replied")),
    (Stage.SALES_VISIT, Event("appointment_set")),
    # Opted out: only an opt-in moves it.
    (Stage.OPTED_OUT, Event("customer_replied")),
    (Stage.OPTED_OUT, Event("sales_visit")),
    # Closed - Lost is terminal: a new lead starts its own workflow (client, 1 Oct 2026).
    (Stage.CLOSED_LOST, Event("customer_replied")),
    (Stage.CLOSED_LOST, Event("appointment_set")),
    # Day 91 doesn't close a pending appointment (decided with the user, 1 Oct 2026)...
    (Stage.APPOINTMENT_SET, Event("day_91")),
    (Stage.NO_SHOW, Event("day_91")),
    # ...nor a working lead whose platform booking is still active.
    (Stage.CONTACT_NO_ACTION, Event("day_91", detail={"appointment_active": True})),
    # Only a New Lead becomes No Contact Made after Touch 2 (decided with the user, 1 Oct 2026).
    (Stage.CONTACT_NO_ACTION, Event("touch2_unanswered")),
])
def test_events_that_change_nothing(current, event):
    assert not transition(current, event).changes


def test_priority_when_events_collide():
    # A reply that also booked a visit: the appointment wins (§11).
    both = lifecycle.resolve(Stage.CONTACT_NO_ACTION, [Event("customer_replied"), Event("appointment_set")])
    assert both.stage == Stage.APPOINTMENT_SET
    # An opt-out beats an appointment in the same moment.
    assert lifecycle.resolve(Stage.NEW_LEAD, [Event("appointment_set"), Event("opted_out")]).stage == Stage.OPTED_OUT
    # A dated next step beats contact without one.
    dated = Event("customer_replied", detail={"next_action": {"date": "2026-11-01"}})
    assert lifecycle.resolve(Stage.NEW_LEAD, [dated]).stage == Stage.SPECIFIC_FOLLOWUP


def test_every_stage_has_the_clients_label_and_a_priority():
    assert set(lifecycle.STAGE_LABELS) == set(Stage) == set(lifecycle.PRIORITY)
    assert lifecycle.label("closed_lost") == "Closed - Lost"
    assert lifecycle.label("contact_made_specific_followup") == "Contact Made - Specific Follow-Up"


@pytest.mark.parametrize(("kind", "stage", "allowed"), [
    ("channel_switch", Stage.CONTACT_NO_ACTION, True),
    ("channel_switch", Stage.APPOINTMENT_SET, False),
    # The customer named when to come back: only their next step runs (§2 "specific timing wins").
    ("channel_switch", Stage.SPECIFIC_FOLLOWUP, False),
    ("visit_followup", Stage.SPECIFIC_FOLLOWUP, False),
    ("visit_followup", Stage.SALES_VISIT, False),
    ("next_action", Stage.SPECIFIC_FOLLOWUP, True),
    ("next_action", Stage.CONTACT_NO_ACTION, False),
    ("resume_at_opening", Stage.NEW_LEAD, True),
    ("handoff_check", Stage.APPOINTMENT_SET, True),
    ("handoff_check", Stage.CLOSED_LOST, False),
    ("some_future_kind", Stage.CONTACT_NO_ACTION, True),
    ("some_future_kind", Stage.OPTED_OUT, False),
    ("channel_switch", None, True),  # a lead from before C3
])
def test_which_scheduled_work_each_stage_allows(kind, stage, allowed):
    assert lifecycle.kind_allowed(kind, stage) is allowed


@pytest.mark.parametrize(("text", "meaningful"), [
    ("Yes, I'm still looking", True),
    ("ok", True),
    ("👍", False),
    ("   ", False),
    ("Automatic reply: I am out of the office until Monday", False),
    ("I'm driving with Do Not Disturb and will see your message later", False),
])
def test_meaningful_reply(text, meaningful):
    # Client, 1 Oct 2026 (scope Q10): an auto-reply is not meaningful.
    assert lifecycle.is_meaningful_reply(text)[0] is meaningful


def test_staff_status_only_from_an_explicit_status_move():
    assert lifecycle.staff_status_from_reason('Staff moved the lead to "Visited"') == "Visited"
    assert lifecycle.staff_status_from_reason("Staff replied by hand (Sam)") is None
    assert lifecycle.staff_status_from_reason(None) is None


@pytest.mark.parametrize(("words", "expected_months"), [("next month", 1), ("next year", 12), ("in a year", 12),
                                                        ("in 2 years", 24), ("in three months", 3)])
def test_dates_for_long_horizons(words, expected_months):
    now = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    found = resolve_date(f"call me {words}", now)
    assert found is not None and found.approximate
    months = (found.day.year - 2026) * 12 + found.day.month - 10
    assert months == expected_months


# --- Through the real handlers and turns -------------------------------------------------

@pytest.fixture
async def live_dealer(mongo):
    """Dealer A's platform record, `live`, with its opening hours (the scheduler checks the mode before
    firing anything, like tests/unit/test_after_hours.py)."""
    await mongo[PLATFORM_USERS_COLLECTION].insert_one({
        "_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True},
        "dealer_account_information": {"time_zone": "America/New_York",
                                       "weekly_availability": simulate.DEV_WEEKLY_AVAILABILITY}})


pytestmark_flow = pytest.mark.usefixtures("during_opening_hours", "ny_customer", "live_dealer")


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _new_lead(comments="Looking for a new Toyota RAV4", created_at: datetime | None = None):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Test",
                                         comments=comments)
    if created_at:
        await dealer_scoped_db(DEALER).collection(PLATFORM_LEADS_COLLECTION).update_one(
            {"_id": as_object_id(created["lead_id"])}, {"$set": {"createdAt": created_at}})
    await handlers.handle_lead_created(LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER,
                                                        lead_id=created["lead_id"],
                                                        customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _say(created, text, channel="sms"):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel=channel,
                                text=text, received_at=clock.now())
    return await handlers.handle_inbound_message(event, _deps())


async def _state(mongo, created) -> dict:
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}


async def _last_sms(mongo, created) -> str:
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).sort("_id", -1).to_list(1)
    return rows[0]["text"]


@pytestmark_flow
async def test_a_new_lead_starts_its_clock_from_the_platform_lead(mongo):
    created_at = clock.now() - timedelta(hours=1)
    created = await _new_lead(created_at=created_at)
    state = await _state(mongo, created)
    assert state["stage"] == "new_lead" and state["stage_label"] == "New Lead"
    stored = state["opportunity_created_at"]
    assert abs((stored.replace(tzinfo=UTC) if stored.tzinfo is None else stored) - created_at) < timedelta(seconds=1)
    assert state["stage_history"][-1]["to"] == "new_lead"


@pytestmark_flow
async def test_a_reply_is_contact_made_and_the_clock_never_resets(mongo):
    created = await _new_lead()
    first = (await _state(mongo, created))["opportunity_created_at"]
    await _say(created, "Yes, I'm interested. Is it a hybrid?")
    state = await _state(mongo, created)
    assert state["stage"] == "contact_made_no_next_action"
    assert state["opportunity_created_at"] == first


@pytestmark_flow
async def test_an_auto_reply_is_not_contact(mongo):
    created = await _new_lead()
    await _say(created, "Automatic reply: I am out of the office until Monday")
    assert (await _state(mongo, created))["stage"] == "new_lead"


@pytestmark_flow
async def test_call_me_next_week_is_a_dated_next_step(mongo):
    created = await _new_lead()
    await _say(created, "I'm busy right now, call me next week")
    state = await _state(mongo, created)
    assert state["stage"] == "contact_made_specific_followup"
    action = state["next_action"]
    # §6's required fields.
    assert action["date"] and action["time"] == "10:00" and action["channel"] == "sms"
    assert action["owner"] == "ai" and action["entered_by"] == "ai" and "call me next week" in action["context_notes"]
    reply = await _last_sms(mongo, created)
    assert "check back" in reply.lower() and "?" not in reply  # confirmed back, nothing else asked
    pending = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "status": "pending", "kind": "next_action"}).to_list(None)
    assert len(pending) == 1 and pending[0]["next_action"]["date"] == action["date"]
    # Its date isn't mistaken for when they need the vehicle.
    facts = await mongo["qualification_facts"].find({"lead_id": created["lead_id"],
                                                     "path": "interest.needed_by"}).to_list(None)
    assert facts == []


@pytestmark_flow
async def test_a_call_request_after_dont_call_me_tells_staff_not_to_call(mongo):
    # Decision 144: a call opt-out stops the "call this customer" notice.
    created = await _new_lead()
    await _say(created, "Call me next week please")
    await consent.set_channel_consent(dealer_scoped_db(DEALER), created["customer_id"], "voice",
                                      False, source="customer_opt_out_phrase")
    due = (await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "status": "pending", "kind": "next_action"}))["due_at"]
    set_clock((due if due.tzinfo else due.replace(tzinfo=UTC)) + timedelta(minutes=1))
    await followups.fire_due(_deps())
    notice = (await _state(mongo, created))["staff_notice"]
    assert notice["kind"] == "do_not_call" and "do not call" in notice["text"]


@pytestmark_flow
async def test_the_next_step_fires_then_no_reply_in_24h_is_no_contact_made(mongo):
    created = await _new_lead()
    await _say(created, "Call me next week please")
    due = (await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "status": "pending", "kind": "next_action"}))["due_at"]
    set_clock((due if due.tzinfo else due.replace(tzinfo=UTC)) + timedelta(minutes=1))
    result = await followups.fire_due(_deps())
    assert result["results"].get("sent") == 1, result
    reply = await _last_sms(mongo, created)
    assert "checking back" in reply.lower()
    # "Call me ..." asked for a call: the team is told (staff call tasks, C2, are skipped for now).
    assert (await _state(mongo, created))["staff_notice"]["kind"] == "call_requested"
    check = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "status": "pending", "kind": "next_action_check"})
    assert check is not None
    assert (await _state(mongo, created))["stage"] == "contact_made_specific_followup"

    set_clock(clock.now() + timedelta(hours=24, minutes=2))
    await followups.fire_due(_deps())
    state = await _state(mongo, created)
    assert state["stage"] == "no_contact_made"
    assert state["stage_history"][-1]["rule"] == "specific_unanswered"


@pytestmark_flow
async def test_a_reply_to_the_next_step_keeps_the_conversation_going(mongo):
    created = await _new_lead()
    await _say(created, "Call me next week please")
    due = (await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "status": "pending", "kind": "next_action"}))["due_at"]
    set_clock((due if due.tzinfo else due.replace(tzinfo=UTC)) + timedelta(minutes=1))
    await followups.fire_due(_deps())
    await _say(created, "Yes, still looking for the RAV4")
    state = await _state(mongo, created)
    assert state["stage"] == "contact_made_no_next_action"
    # The 24h check belonged to the Specific Follow-Up stage: cancelled when the stage moved on (§2).
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "status": "pending", "kind": "next_action_check"}) == 0


@pytestmark_flow
async def test_staff_visited_is_sales_visit_and_cancels_the_lead_workflow(mongo):
    created = await _new_lead()
    await _say(created, "Call me next week please")
    result = await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="s1", dealer_id=DEALER, lead_id=created["lead_id"], reason='Staff moved the lead to "Visited"'))
    assert result["status"] == "paused" and result["stage_change"]["stage"] == "sales_visit"
    state = await _state(mongo, created)
    assert state["stage"] == "sales_visit" and state["status"] == "paused"
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "status": "pending"}) == 0


@pytestmark_flow
async def test_staff_appointment_booked_sets_the_stage_and_does_not_pause(mongo):
    # Decided with the user, 1 Oct 2026: the AI runs the appointment workflow for staff bookings too.
    created = await _new_lead()
    await _say(created, "Yes, I'm interested")
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].insert_one({
        "dealer_id": DEALER, "lead_id": created["lead_id"], "kind": "visit_followup", "status": "pending",
        "due_at": clock.now() + timedelta(days=3), "created_at": clock.now()})
    await simulate.send_staff_status(DEALER, created["lead_id"], "Appointment Booked", _NoEnqueue(),
                                     booking_at=(clock.now() + timedelta(days=2)).isoformat())
    result = await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="s2", dealer_id=DEALER, lead_id=created["lead_id"],
        reason='Staff moved the lead to "Appointment Booked"'))
    assert result["status"] == "not_paused"
    state = await _state(mongo, created)
    assert state["stage"] == "appointment_set" and state["status"] != "paused"
    assert state["appointment"]["by"] == "staff" and state["appointment"]["at"]
    # The visit follow-up was the old stage's work: cancelled (§2).
    stale = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"lead_id": created["lead_id"],
                                                                  "kind": "visit_followup"})
    assert stale["status"] == "cancelled" and "Appointment Set" in stale["reason"]


@pytestmark_flow
async def test_staff_dnd_is_opted_out(mongo):
    created = await _new_lead()
    await handlers.handle_lead_paused(LeadPausedEvent(event_id="s3", dealer_id=DEALER, lead_id=created["lead_id"],
                                                      reason='Staff moved the lead to "DND"'))
    assert (await _state(mongo, created))["stage"] == "opted_out"


@pytestmark_flow
async def test_a_staff_reply_pauses_without_moving_the_stage(mongo):
    created = await _new_lead()
    result = await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="s4", dealer_id=DEALER, lead_id=created["lead_id"], reason="Staff replied by hand (Sam)"))
    # What the first reply left pending (its cadence touch and the standby fallback) is cancelled, as on
    # any pause; no stage change.
    assert result["status"] == "paused" and result["followups_cancelled"] == 2 and "stage_change" not in result
    assert (await _state(mongo, created))["stage"] == "new_lead"


@pytestmark_flow
async def test_one_channel_opt_out_keeps_the_stage_every_channel_is_opted_out(mongo):
    created = await _new_lead()
    await _say(created, "STOP")
    assert (await _state(mongo, created))["stage"] == "new_lead"  # email can still carry on
    await _say(created, "Unsubscribe", channel="email")
    state = await _state(mongo, created)
    assert state["stage"] == "opted_out" and state["previous_stage"] == "new_lead"
    await _say(created, "START")
    assert (await _state(mongo, created))["stage"] == "new_lead"


@pytestmark_flow
@pytest.mark.usefixtures("legacy_switch")
async def test_a_pending_channel_switch_is_cancelled_once_an_appointment_is_set(mongo):
    created = await _new_lead()
    switch = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "status": "pending", "kind": "channel_switch"})
    assert switch is not None
    await lifecycle.apply(dealer_scoped_db(DEALER), created["lead_id"], [Event("appointment_set")])
    switch = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"_id": switch["_id"]})
    assert switch["status"] == "cancelled" and switch["reason"] == "stage changed to Appointment Set"


@pytestmark_flow
@pytest.mark.usefixtures("legacy_switch")
async def test_the_pre_send_recheck_cancels_work_the_stage_no_longer_allows(mongo):
    created = await _new_lead()
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]},
                                                    {"$set": {"stage": "appointment_set"}})
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].update_many(
        {"lead_id": created["lead_id"], "status": "pending"}, {"$set": {"due_at": clock.now() - timedelta(minutes=1)}})
    result = await followups.fire_due(_deps())
    assert result["results"].get("cancelled") == 1
    log = await mongo[AI_TURN_LOG_COLLECTION].find_one({"lead_id": created["lead_id"],
                                                        "outcome": "followup_cancelled"})
    assert "Appointment Set" in log["summary"]["reason"]


@pytestmark_flow
async def test_day_91_closes_a_working_lead_as_closed_lost(mongo):
    created = await _new_lead(created_at=clock.now() - timedelta(days=92))
    await _say(created, "Yes, I'm interested")
    summary = await lifecycle.close_expired()
    assert summary["closed"] == 1
    state = await _state(mongo, created)
    assert state["stage"] == "closed_lost" and state["closed_reason"] == "day_91_no_response"
    assert state["opportunity_closed_at"]
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "status": "pending"}) == 0
    # Per lead only (client, 1 Oct): the customer's next lead starts its own workflow.
    again = await _new_lead()
    assert (await _state(mongo, again))["stage"] == "new_lead"


@pytestmark_flow
async def test_day_91_waits_for_a_pending_appointment(mongo):
    created = await _new_lead(created_at=clock.now() - timedelta(days=95))
    await lifecycle.apply(dealer_scoped_db(DEALER), created["lead_id"], [Event("appointment_set")])
    summary = await lifecycle.close_expired()
    assert summary["closed"] == 0
    assert (await _state(mongo, created))["stage"] == "appointment_set"


@pytestmark_flow
async def test_day_91_keeps_a_long_horizon_next_step(mongo):
    created = await _new_lead(created_at=clock.now() - timedelta(days=92))
    await _say(created, "Not ready yet, try me again next year")
    assert (await _state(mongo, created))["stage"] == "contact_made_specific_followup"
    await lifecycle.close_expired()
    assert (await _state(mongo, created))["stage"] == "closed_lost"
    step = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"lead_id": created["lead_id"], "kind": "next_action"})
    # §6 long-horizon rule: the customer's own future task outlives the opportunity.
    assert step["status"] == "pending" and step["long_horizon"] is True


@pytestmark_flow
async def test_a_reply_on_a_closed_lead_is_answered_and_staff_are_told(mongo):
    created = await _new_lead(created_at=clock.now() - timedelta(days=92))
    await _say(created, "ok")
    await lifecycle.close_expired()
    await _say(created, "Hi, is the RAV4 still there?")
    state = await _state(mongo, created)
    assert state["stage"] == "closed_lost"
    assert state["staff_notice"]["kind"] == "reply_on_closed_lead"


@pytestmark_flow
async def test_not_interested_asks_why_then_a_person_decides(mongo):
    created = await _new_lead()
    await _say(created, "I'm not interested anymore")
    reply = await _last_sms(mongo, created)
    assert "what changed" in reply.lower() and reply.count("?") == 1
    state = await _state(mongo, created)
    assert state["status"] != "handoff" and state["conversation"]["not_interested"]["asked_turn"] >= 1

    await _say(created, "Bought one elsewhere last week")
    state = await _state(mongo, created)
    assert state["status"] == "handoff"
    assert "Bought one elsewhere" in state["status_reason"]
    assert state["conversation"]["not_interested"]["reason"].startswith("Bought one elsewhere")
    # Only a person closes such a lead (client, scope Q10): the AI never moves it to Closed - Lost.
    assert state["stage"] == "contact_made_no_next_action"


@pytestmark_flow
async def test_not_interested_with_a_reason_goes_straight_to_a_person(mongo):
    created = await _new_lead()
    await _say(created, "Not interested, because it's too expensive for us right now")
    state = await _state(mongo, created)
    assert state["status"] == "handoff" and state["stage"] != "closed_lost"


class _NoEnqueue:
    async def __call__(self, *args, **kwargs):
        return None
