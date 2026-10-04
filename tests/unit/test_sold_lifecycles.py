"""MASTER_PLAN_4 D1-D4, D7, D8 (stream A3): SOLD PENDING and SOLD - DELIVERED.

The client's two specs (docs/data/4/*.pdf): SOLD PENDING's weekly-then-biweekly cadence that never expires, its
response router and guardrails; SOLD - DELIVERED's ownership records, Day-3 check-in (a service request, never a
booking), birthday (verified only), ownership anniversary YES / NO, and the customer ACTIVE / INACTIVE rule."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent import lifecycle, ownership, sold_delivered, sold_pending
from upsell_agent.agent.lifecycle import Event, Stage
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent, LeadPausedEvent
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_VEHICLE_OWNERSHIP_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_BOOKINGS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    as_object_id,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.scheduler import followups, sold_lifecycles

NY = ZoneInfo("America/New_York")
DEALER = simulate.DEV_DEALERS[0]["_id"]


# --- Pure: the SOLD PENDING cadence and its words ------------------------------------------------------------------

def test_weekly_for_four_weeks_then_every_two_weeks_forever():
    assert [sold_pending.touch_due_day(n) for n in range(1, 8)] == [1, 8, 15, 22, 36, 50, 64]
    assert [sold_pending.week_number(n) for n in range(1, 6)] == [1, 2, 3, 4, 6]
    assert [sold_pending.phase(n) for n in (4, 5)] == ["weekly", "every_two_weeks"]
    # No Day-90 or any other age-based expiry (§6, §12): touch 100 is still on the grid.
    assert sold_pending.touch_due_day(100) == 22 + 14 * 96
    assert [sold_pending.theme_for(n).id for n in range(1, 6)] == [
        "documentation_questions", "support_check_in", "purchase_vehicle_check_in", "relationship_check_in",
        "biweekly_check_in"]


def test_a_missed_touch_goes_out_now_not_skipped():
    started = datetime(2026, 10, 6, 12, tzinfo=NY)
    state = sold_pending.SoldPendingState(started_at=started, touch_number=2)
    late = datetime(2026, 10, 20, 9, tzinfo=NY)
    assert sold_pending.plan_touch(state, now=late, tz=NY).due_at == late
    on_time = sold_pending.plan_touch(state, now=started, tz=NY)
    assert on_time.due_at == datetime(2026, 10, 14, 10, tzinfo=NY)


@pytest.mark.parametrize("n", range(1, 7))
def test_no_touch_implies_delay_or_invents_a_document(n):
    for name, vehicle, docs in ((None, None, True), ("Maria", "2025 Toyota RAV4", True), ("Maria", None, False)):
        text = sold_pending.render_touch(n, first_name=name, dealership="Sunrise Motors", vehicle=vehicle,
                                         documents=docs)
        for body in (text["sms_text"], text["email_body"]):
            assert sold_pending.guardrail_problems(body) == [], body


def test_week_4_is_the_clients_recommended_intent():
    text = sold_pending.render_touch(4, first_name="Maria", dealership=None, vehicle=None, documents=False)
    assert ("We just wanted to stay in touch while your purchase is being completed. Do you have any questions about "
            "your vehicle or is there anything our team can help you with at this time?").lower() in text[
        "sms_text"].lower()


def test_the_guardrail_catches_blame_and_invented_facts():
    assert sold_pending.guardrail_problems("We're still missing your pay stubs, which is holding things up")
    assert sold_pending.guardrail_problems("Your delivery date is Friday")
    assert sold_pending.guardrail_problems("Happy to help with anything!") == []


def test_documents_are_asked_in_week_1_and_only_sometimes_after_and_never_once_answered():
    state = sold_pending.SoldPendingState()
    assert [sold_pending.asks_documents(n, state) for n in range(1, 9)] == [
        True, False, False, False, False, True, False, True]
    state.documents_confirmed = True
    assert not any(sold_pending.asks_documents(n, state) for n in range(1, 9))


@pytest.mark.parametrize(("text", "route"), [
    ("When will my car be ready for pickup?", "human"),
    ("Is my financing approved?", "human"),
    ("What do I need for the title?", "human"),
    ("I just sent my insurance card", "info"),
    ("Here is my proof of residence", "info"),
    ("Yes, I already sent everything", "documents_confirmed"),
    ("Thanks, all good here", "documents_confirmed"),
    ("Does it have heated seats", "ai"),
])
def test_the_response_router(text, route):
    assert sold_pending.classify_reply(text, documents_asked=True)[0] == route


def test_reply_hold_is_only_for_sold_customers():
    assert "never a new sales pitch" in sold_pending.reply_hold("sold_pending")
    assert "no trade-in" in sold_pending.reply_hold("sold_delivered")
    assert sold_pending.reply_hold("contact_made_no_next_action") is None


# --- Pure: the status model ----------------------------------------------------------------------------------------

def test_exactly_two_closed_statuses_and_sold_delivered_is_not_one():
    assert ownership.CLOSED_OPPORTUNITY_STATUSES == {"CLOSED_LOST", "CLOSED_NO_LONGER_OWNS"}
    assert not ownership.is_closed(ownership.opportunity_status("sold_delivered"))
    assert not ownership.is_closed(ownership.opportunity_status("sold_pending"))
    assert ownership.is_closed(ownership.opportunity_status("closed_no_longer_owns"))
    # An opt-out keeps the status the opportunity had.
    assert ownership.opportunity_status("opted_out", "sold_delivered") == "SOLD_DELIVERED"
    assert lifecycle.CLOSED_STAGES == {Stage.CLOSED_LOST, Stage.CLOSED_NO_LONGER_OWNS}


@pytest.mark.parametrize(("open_", "owned", "unknown", "previous", "expected"), [
    (0, 1, False, None, "ACTIVE"),      # no longer owns A but owns B
    (1, 0, False, None, "ACTIVE"),      # no vehicle but an open lead
    (0, 0, False, "ACTIVE", "INACTIVE"),
    (0, 0, True, "ACTIVE", "ACTIVE"),   # unknown ownership is not zero ownership
    (0, 0, True, None, "ACTIVE"),
    (1, 0, False, "INACTIVE", "ACTIVE"),  # a new open opportunity reactivates
])
def test_customer_status_rule(open_, owned, unknown, previous, expected):
    status, _ = ownership.customer_status_rule(open_opportunities=open_, owned_vehicles=owned,
                                               unknown_ownership=unknown, previous=previous)
    assert status == expected


@pytest.mark.parametrize(("current", "event", "expected"), [
    (Stage.SOLD_DELIVERED, Event("no_longer_owns"), Stage.CLOSED_NO_LONGER_OWNS),
    (Stage.SOLD_PENDING, Event("no_longer_owns"), None),
    (Stage.SOLD_PENDING, Event("staff_closed_lost"), Stage.CLOSED_LOST),
    (Stage.SOLD_DELIVERED, Event("staff_closed_lost"), None),
    (Stage.CLOSED_NO_LONGER_OWNS, Event("sold_delivered"), None),
    (Stage.SOLD_PENDING, Event("day_91"), None),
    (Stage.SOLD_PENDING, Event("sold_delivered"), Stage.SOLD_DELIVERED),
])
def test_ownership_transitions(current, event, expected):
    assert lifecycle.transition(current, event).stage == expected


def test_closed_lost_arrives_as_a_staff_status():
    assert lifecycle.STAFF_STATUS_EVENTS["Closed Lost"] == "staff_closed_lost"


def test_lifecycle_kinds_are_kept_in_step():
    assert set(followups.SOLD_LIFECYCLE_KINDS) == set(sold_lifecycles.LIFECYCLE_KINDS)
    for kind in sold_lifecycles.LIFECYCLE_KINDS:
        assert kind in lifecycle.KIND_STAGES


# --- Pure: SOLD - DELIVERED -------------------------------------------------------------------------------------------

def test_birthday_only_from_a_verified_source():
    assert sold_delivered.verified_birthday({}, []) is None
    one = sold_delivered.verified_birthday({}, [{"Birth Date": "7/14/1985", "_source": "deal"}])
    assert (one["month"], one["day"], one["sources"]) == (7, 14, ["deal"])
    # Two sources that disagree are not verified.
    assert sold_delivered.verified_birthday({"birth_date": "1985-07-15"}, [{"Birth Date": "7/14/1985"}]) is None
    # A DMS placeholder is not a birthday.
    assert sold_delivered.verified_birthday({}, [{"Birth Date": "1/1/1900"}]) is None


def test_anniversary_and_birthday_dates():
    assert sold_delivered.anniversary_due(date(2024, 2, 29), 1, NY).date() == date(2025, 2, 28)
    assert sold_delivered.anniversary_due(date(2026, 10, 6), 10, NY) == datetime(2036, 10, 6, 10, tzinfo=NY)
    now = datetime(2026, 10, 6, 12, tzinfo=NY)
    assert sold_delivered.next_birthday(10, 6, now=now, tz=NY).year == 2027
    assert sold_delivered.next_birthday(10, 7, now=now, tz=NY) == datetime(2026, 10, 7, 10, tzinfo=NY)


@pytest.mark.parametrize(("text", "answer"), [
    ("YES", "yes"), ("yes still love it", "yes"), ("Y", "yes"), ("No", "no"), ("nope, sold it last year", "no"),
    ("We traded it in", "no"), ("not anymore", "no"), ("who is this?", "other"), ("maybe", "other")])
def test_ownership_answers(text, answer):
    assert sold_delivered.classify_ownership_answer(text) == answer


def test_current_vehicle_and_duration_are_only_what_the_customer_said():
    assert sold_delivered.parse_current_vehicle("A 2022 Honda Civic now") == {
        "year": 2022, "make": "Honda", "model": "Civic"}
    assert sold_delivered.parse_current_vehicle("a chevy tahoe") == {"year": None, "make": "Chevrolet",
                                                                     "model": "tahoe"}
    assert sold_delivered.parse_current_vehicle("nothing right now") == {}
    assert sold_delivered.parse_current_vehicle("a red one") is None
    now = datetime(2026, 10, 6, tzinfo=UTC)
    parsed = sold_delivered.parse_ownership_duration("about 2 years", now=now)
    assert parsed["approx_acquisition_date"] == "2024-10-06"
    assert sold_delivered.parse_ownership_duration("a while", now=now)["approx_acquisition_date"] is None


def test_day_3_check_in_never_invents_a_service_interval():
    plain = sold_delivered.render_checkin(first_name="Maria", dealership="Sunrise Motors",
                                          vehicle={"model": "RAV4"}, first_service=None, offer_service=True)
    assert "first recommended service" in plain["sms_text"] and "miles" not in plain["sms_text"]
    named = sold_delivered.render_checkin(first_name="Maria", dealership=None, vehicle=None,
                                          first_service={"name": "oil and filter change"}, offer_service=True)
    assert "oil and filter change" in named["sms_text"]
    booked = sold_delivered.render_checkin(first_name=None, dealership=None, vehicle=None, first_service=None,
                                           offer_service=False)
    assert "service" not in booked["sms_text"]


def test_recall_outreach_needs_a_vin_specific_source():
    assert sold_delivered.render_service_outreach("recall", {"component": "airbag"}, first_name=None,
                                                  dealership=None, vehicle=None) is None
    text = sold_delivered.render_service_outreach("recall", {"recall_id": "24V123", "source": "NHTSA",
                                                             "component": "airbag inflator"},
                                                  first_name="Maria", dealership=None, vehicle={"model": "RAV4"})
    assert "24V123" in text["sms_text"] and "NHTSA" in text["sms_text"]


# --- Flows --------------------------------------------------------------------------------------------------------

pytestmark_flow = pytest.mark.usefixtures("during_opening_hours", "ny_customer", "live_dealer")


@pytest.fixture
async def live_dealer(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one({
        "_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True},
        "dealer_account_information": {
            "time_zone": "America/New_York", "store_name": "Sunrise Motors", "store_city": "Springfield",
            "store_state": "NJ", "weekly_availability": simulate.DEV_WEEKLY_AVAILABILITY}})


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(), platform=StubPlatformClient(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _new_lead():
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Test",
                                         comments="Looking for a new Toyota RAV4")
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _staff(created, status, n=[0]):  # noqa: B006 - a unique event id per call
    n[0] += 1
    return await handlers.handle_lead_paused(LeadPausedEvent(
        event_id=f"s{n[0]}", dealer_id=DEALER, lead_id=created["lead_id"],
        reason=f'Staff moved the lead to "{status}"'), _deps())


async def _say(created, text):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel="sms",
                                text=text, received_at=clock.now())
    return await handlers.handle_inbound_message(event, _deps())


async def _state(mongo, created) -> dict:
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}


async def _pending(mongo, created, kind) -> list[dict]:
    rows = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "status": "pending", "kind": kind}).to_list(None)
    return sorted(rows, key=lambda r: r["due_at"])


def _aware(value):
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def _fire(mongo, created, kind, tries=6) -> dict:
    """Moves the clock to the pending `kind`'s due time and fires it (again, when a hold deferred it)."""
    for _ in range(tries):
        [doc] = (await _pending(mongo, created, kind))[:1]
        set_clock(_aware(doc["due_at"]) + timedelta(minutes=1))
        await followups.fire_due(_deps())
        done = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"_id": doc["_id"]})
        if done["status"] != "pending":
            return done
    raise AssertionError(f"{kind} never fired")


async def _outbox(mongo, created) -> list[dict]:
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    return sorted(rows, key=lambda r: r["created_at"])


@pytestmark_flow
async def test_sold_pending_runs_weekly_then_biweekly_with_text_email_and_call_task(mongo):
    created = await _new_lead()
    result = await _staff(created, "Sold Pending")
    assert result["status"] == "resumed_sold_pending"
    assert result["stage_change"]["lifecycle_started"] == "SOLD_PENDING_STARTED"
    # Nothing from the Day 1-90 machinery is left (§1).
    assert await _pending(mongo, created, "cadence_touch") == []
    started = _aware((await _state(mongo, created))["sold_pending"]["started_at"]).astimezone(NY).date()
    days = []
    for _ in range(5):
        before = len(await _outbox(mongo, created))
        doc = await _fire(mongo, created, "sold_pending_touch")
        assert doc["status"] == "sent"
        days.append((_aware(doc["closed_at"]).astimezone(NY).date() - started).days)
        sent = (await _outbox(mongo, created))[before:]
        assert sorted(m["channel"] for m in sent) == ["email", "sms"]  # text + email, every touch
        # ... + the 60-minute call-task timer (§3, §8).
        # (one open task at a time: while last week's is still open for staff, it isn't doubled).
        timers = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
            {"lead_id": created["lead_id"], "kind": "call_task", "source_turn_id": f"sold_pending_touch-{doc['_id']}"})
        open_task = await mongo[AI_CALL_TASKS_COLLECTION].count_documents(
            {"lead_id": created["lead_id"], "status": "open"})
        assert timers == 1 or open_task == 1
    assert days == [1, 8, 15, 22, 36]
    state = await _state(mongo, created)
    assert state["sold_pending"]["touch_number"] == 6 and state["sold_pending"]["phase"] == "every_two_weeks"
    # No expiry: the Day 91 sweep a year later doesn't touch it, and the next touch is still planned.
    assert (await lifecycle.close_expired(clock.now() + timedelta(days=365)))["closed"] == 0
    assert len(await _pending(mongo, created, "sold_pending_touch")) == 1


@pytestmark_flow
async def test_a_reply_within_the_hour_cancels_the_call_task_and_no_reply_opens_it(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Pending")
    await _fire(mongo, created, "sold_pending_touch")
    set_clock(clock.now() + timedelta(minutes=61))
    await followups.fire_due(_deps())
    assert await mongo[AI_CALL_TASKS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "status": "open"}) == 1
    await _fire(mongo, created, "sold_pending_touch")  # week 2: a task is already open, not doubled
    await _say(created, "Thanks, all good here")
    assert await mongo[AI_CALL_TASKS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "status": "open"}) == 0


@pytestmark_flow
async def test_sold_delivered_stops_sold_pending_and_starts_the_ownership_lifecycle(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Pending")
    await _fire(mongo, created, "sold_pending_touch")
    result = await _staff(created, "Sold Delivered")
    assert result["status"] == "resumed_sold_delivered"
    state = await _state(mongo, created)
    assert state["stage"] == "sold_delivered" and state["opportunity_status"] == "SOLD_DELIVERED"
    assert state["sold_pending"]["outcome"] == "SOLD_DELIVERED" and state["sold_delivered_at"]
    assert state["delivery_date"] == clock.now().astimezone(NY).date().isoformat()
    assert await _pending(mongo, created, "sold_pending_touch") == []  # every SOLD PENDING action cancelled
    assert await mongo[AI_CALL_TASKS_COLLECTION].count_documents({"lead_id": created["lead_id"], "status": "open"}) == 0
    [record] = await mongo[AI_VEHICLE_OWNERSHIP_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    assert record["ownership_status"] == "ACTIVE" and record["vehicle_source"] == "DEALER_SALE"
    assert record["model"] == "RAV4" or record["model"] is None or "RAV4" in str(record["model"])
    [checkin] = await _pending(mongo, created, "post_delivery_checkin")
    assert (_aware(checkin["due_at"]).astimezone(NY).date() - clock.now().astimezone(NY).date()).days == 3
    [anniversary] = await _pending(mongo, created, "ownership_anniversary")
    assert anniversary["year"] == 1
    assert await _pending(mongo, created, "birthday") == []  # no verified birthday on record
    status = await ownership.customer_view(DEALER, created["customer_id"])
    assert status["status"]["customer_status"] == "ACTIVE"
    # Setting it again doesn't add a second vehicle; Sold Pending never comes back from Delivered.
    await _staff(created, "Sold Delivered")
    await _staff(created, "Sold Pending")
    assert await mongo[AI_VEHICLE_OWNERSHIP_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 1
    assert (await _state(mongo, created))["stage"] == "sold_delivered"


@pytestmark_flow
async def test_staff_close_a_sold_pending_deal_as_lost(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Pending")
    await _staff(created, "Closed Lost")
    state = await _state(mongo, created)
    assert state["stage"] == "closed_lost" and state["opportunity_status"] == "CLOSED_LOST"
    assert state["sold_pending"]["outcome"] == "CLOSED_LOST" and state["closed_at"]
    assert await _pending(mongo, created, "sold_pending_touch") == []


@pytestmark_flow
async def test_the_sold_pending_router_escalates_records_and_stays_sold_pending(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Pending")
    asked = await _say(created, "When will my car be ready for pickup?")
    assert asked["sold_route"] == "sold_pending_escalated"
    state = await _state(mongo, created)
    assert state["stage"] == "sold_pending" and state["staff_notice"]["kind"] == "sold_pending_escalation"
    assert state["sold_pending"]["escalations"][0]["status"] == "open"
    reply = (await _outbox(mongo, created))[-1]["text"]
    assert "salesperson" in reply and sold_pending.guardrail_problems(reply) == []
    info = await _say(created, "I just sent my insurance card to Bob")
    assert info["sold_route"] == "sold_pending_info_received"
    assert (await _state(mongo, created))["staff_notice"]["kind"] == "sold_pending_info"
    # Stream R: both are written into the CRM conversation as staff notes too, once each.
    notes = await mongo["dev_platform_messages"].find({"lead_id": created["lead_id"], "is_note": True}).to_list(None)
    assert sorted(n["kind"] for n in notes) == ["sold_pending_escalation", "sold_pending_info"]
    assert any("When will my car be ready" in n["text"] for n in notes)
    # Anything else is an AI-written answer under the guardrails: no visit offer, still Sold Pending.
    other = await _say(created, "Does it have heated seats")
    assert other["status"] == "done" and (await _state(mongo, created))["stage"] == "sold_pending"
    assert await mongo[PLATFORM_BOOKINGS_COLLECTION].count_documents({}) == 0


@pytestmark_flow
async def test_day_3_service_yes_is_a_request_with_notes_never_a_booking(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Delivered")
    doc = await _fire(mongo, created, "post_delivery_checkin")
    assert doc["status"] == "sent"
    assert "first recommended service" in (await _outbox(mongo, created))[-1]["text"]
    assert (await _state(mongo, created))["service_offer"]["status"] == "offered"
    result = await _say(created, "Yes please, Saturday morning works")
    assert result["sold_route"] == "service_requested"
    state = await _state(mongo, created)
    assert state["staff_notice"]["kind"] == "service_request" and "Saturday morning" in state["staff_notice"]["notes"]
    assert state["service_offer"]["status"] == "requested"
    assert await mongo[PLATFORM_BOOKINGS_COLLECTION].count_documents({}) == 0


@pytestmark_flow
async def test_day_3_later_is_never_pressured(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Delivered")
    await _fire(mongo, created, "post_delivery_checkin")
    result = await _say(created, "Not yet, maybe later")
    assert result["sold_route"] == "service_later"
    assert (await _state(mongo, created))["service_offer"]["status"] == "declined"


@pytestmark_flow
async def test_anniversary_no_closes_the_vehicle_and_captures_what_they_drive_now(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Delivered")
    await _fire(mongo, created, "post_delivery_checkin")
    doc = await _fire(mongo, created, "ownership_anniversary")
    assert doc["status"] == "sent" and "Reply YES or NO" in (await _outbox(mongo, created))[-1]["text"]
    assert [d["year"] for d in await _pending(mongo, created, "ownership_anniversary")] == [2]
    assert (await _say(created, "No, we sold it"))["sold_route"] == "ownership_ended"
    state = await _state(mongo, created)
    assert state["stage"] == "closed_no_longer_owns" and state["opportunity_status"] == "CLOSED_NO_LONGER_OWNS"
    assert state["closed_at"] and state["no_longer_owns_at"]
    [sold] = await mongo[AI_VEHICLE_OWNERSHIP_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    assert sold["ownership_status"] == "NO_LONGER_OWNED" and sold["sold_delivered_at"]  # history preserved
    assert await _pending(mongo, created, "ownership_anniversary") == []  # every reminder for it stops
    assert (await _outbox(mongo, created))[-1]["text"] == "Thanks for letting me know! What are you driving now?"
    await _say(created, "A 2022 Honda Civic")
    assert "About how long have you had your Civic?" in (await _outbox(mongo, created))[-1]["text"]
    await _say(created, "about 2 years")
    await _say(created, "Jiffy Lube on Main St")
    reported = await mongo[AI_VEHICLE_OWNERSHIP_COLLECTION].find_one({"vehicle_source": "CUSTOMER_REPORTED"})
    assert (reported["year"], reported["make"], reported["model"]) == (2022, "Honda", "Civic")
    assert reported["ownership_status"] == "ACTIVE" and reported["vin"] is None
    assert reported["reported_ownership_duration"] == "about 2 years" and reported["approx_acquisition_date"]
    assert reported["normal_service_location"] == "Jiffy Lube on Main St"
    view = await ownership.customer_view(DEALER, created["customer_id"])
    assert view["status"]["customer_status"] == "ACTIVE"  # owns the Civic
    assert view["status"]["active_owned_vehicle_count"] == 1 and len(view["vehicles"]) == 2


@pytestmark_flow
async def test_no_open_lead_and_no_owned_vehicle_makes_the_customer_inactive(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Delivered")
    await _fire(mongo, created, "post_delivery_checkin")
    await _fire(mongo, created, "ownership_anniversary")
    await _say(created, "nope, sold it")
    await _say(created, "nothing right now")
    view = await ownership.customer_view(DEALER, created["customer_id"])
    assert view["status"]["customer_status"] == "INACTIVE"
    assert [h["event"] for h in view["status"]["history"]][-1] == "CUSTOMER_BECAME_INACTIVE"
    # A new open lead reactivates them.
    await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Test",
                               comments="Back for another", customer_id=created["customer_id"])
    db = dealer_scoped_db(DEALER)
    assert (await ownership.recalculate_customer_status(db, created["customer_id"], reason="new lead"))[
        "customer_status"] == "ACTIVE"


@pytestmark_flow
async def test_anniversary_yes_and_no_answer_change_nothing_but_the_confirmation(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Delivered")
    await _fire(mongo, created, "post_delivery_checkin")
    await _fire(mongo, created, "ownership_anniversary")
    assert (await _say(created, "Yes!"))["sold_route"] == "ownership_confirmed"
    record = await mongo[AI_VEHICLE_OWNERSHIP_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert record["ownership_status"] == "ACTIVE" and record["ownership_confirmed_at"]
    assert (await _state(mongo, created))["stage"] == "sold_delivered"


@pytestmark_flow
async def test_unknown_ownership_never_forces_inactive(mongo):
    created = await _new_lead()
    await _staff(created, "Closed Lost")  # no open lead now...
    db = dealer_scoped_db(DEALER)
    # ...but a DealerVault deal for a car we have no answer about: unknown, not zero.
    await mongo[PLATFORM_DEALS_COLLECTION].insert_one({"dealer_id": DEALER, "vin": "1HGCM82633A004352",
                                                       "customer_id": as_object_id(created["customer_id"])})
    result = await ownership.recalculate_customer_status(db, created["customer_id"], reason="test")
    assert result["customer_status"] == "ACTIVE"


@pytestmark_flow
async def test_birthday_is_planned_only_with_a_verified_dealervault_date(mongo):
    created = await _new_lead()
    await mongo[PLATFORM_DEALS_COLLECTION].insert_one({"dealer_id": DEALER, "Birth Date": "7/14/1985",
                                                       "customer_id": as_object_id(created["customer_id"])})
    await _staff(created, "Sold Delivered")
    [birthday] = await _pending(mongo, created, "birthday")
    assert (_aware(birthday["due_at"]).astimezone(NY).month, _aware(birthday["due_at"]).astimezone(NY).day) == (7, 14)
    doc = await _fire(mongo, created, "birthday")
    assert doc["status"] == "sent"
    text = (await _outbox(mongo, created))[-1]["text"]
    assert text.startswith("Happy Birthday") and "Sunrise Motors" in text
    # No call task for a birthday (§12), and next year's is planned.
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"source_turn_id": f"birthday-{doc['_id']}", "kind": "call_task"}) == 0
    [nxt] = await _pending(mongo, created, "birthday")
    assert _aware(nxt["due_at"]).year == _aware(doc["due_at"]).year + 1
    # The sweep doesn't plan a second one.
    assert (await sold_lifecycles.sweep_birthdays())["planned"] == 0


@pytestmark_flow
async def test_service_outreach_entry_point_for_stream_a4(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Delivered")
    db = dealer_scoped_db(DEALER)
    vin = "1HGCM82633A004352"
    [record] = await ownership.owned_vehicles(db, created["customer_id"])
    await mongo[AI_VEHICLE_OWNERSHIP_COLLECTION].update_one({"_id": record["_id"]}, {"$set": {"vin": vin}})
    # A4's interface: True / False / None (unknown -> no outreach).
    assert await ownership.vehicle_is_owned(DEALER, vin) is True
    assert await ownership.vehicle_is_owned(DEALER, vin, customer_id=created["customer_id"]) is True
    assert await ownership.vehicle_is_owned(DEALER, "5YJSA1E26HF000000") is None
    assert (await ownership.queue_service_outreach(DEALER, {"type": "SOMETHING", "facts": {}}))["status"] == "skipped"
    thin = await ownership.queue_service_outreach(DEALER, {"type": "RECALL_DETECTED", "vin": vin,
                                                           "offer": "service_visit_request",
                                                           "facts": {"component": "airbag"}})
    assert thin["status"] == "skipped"
    facts = {"NHTSACampaignNumber": "24V123", "Component": "AIR BAGS: FRONTAL", "Summary": "The inflator may rupture."}
    made = await ownership.queue_service_outreach(DEALER, {"type": "RECALL_DETECTED", "vin": vin,
                                                           "offer": "service_visit_request", "facts": facts})
    assert made["status"] == "queued"
    doc = await _fire(mongo, created, "service_outreach")
    text = (await _outbox(mongo, created))[-1]["text"]
    assert doc["status"] == "sent" and "24V123" in text and "NHTSA" in text and "AIR BAGS" in text
    offer = (await _state(mongo, created))["service_offer"]
    assert offer["kind"] == "recall" and offer["facts"] == facts  # kept as A4 gave them, for decision.service_facts
    # The same recall isn't sent twice within 30 days.
    again = await ownership.queue_service_outreach(DEALER, {"type": "RECALL_DETECTED", "vin": vin, "facts": facts})
    assert again["status"] == "skipped"
    # Once they no longer own it, nothing more for that vehicle.
    await ownership.mark_no_longer_owned(db, record, source="test", reason="test")
    assert await ownership.vehicle_is_owned(DEALER, vin) is False
    gone = await ownership.queue_service_outreach(DEALER, {"type": "MAINTENANCE_DUE", "vin": vin,
                                                           "facts": {"service": "oil change"}})
    assert gone["status"] == "skipped"


def test_a4_facts_are_read_without_inventing_anything():
    words = sold_delivered.normalize_service_facts("maintenance", {"next_service": {"name": "Oil change"},
                                                                   "due_date": "2026-11-01"})
    assert words == {"service": "Oil change", "due": "2026-11-01"}
    assert sold_delivered.normalize_service_facts("maintenance", {}) == {}
    assert sold_delivered.normalize_service_facts("recall", {"campaign_number": "X1"})["source"] == "NHTSA"


@pytestmark_flow
async def test_the_profile_and_ownership_endpoints(mongo):
    from fastapi.testclient import TestClient

    from upsell_agent.main import create_app

    created = await _new_lead()
    await _staff(created, "Sold Pending")
    with TestClient(create_app(make_settings("DEV"), connect=False)) as client:
        await _check_endpoints(client, created)


async def _check_endpoints(client, created):
    headers = {"Authorization": "Bearer test-secret"}
    body = client.get(f"/v1/leads/{created['lead_id']}/profile", params={"dealer_id": DEALER}, headers=headers).json()
    assert body["opportunity"]["status"] == "SOLD_PENDING" and body["opportunity"]["closed"] is False
    assert body["sold_pending"]["next_touch"]["touch"]["theme"] == "documentation_questions"
    url = f"/v1/customers/{created['customer_id']}/ownership"
    assert client.get(url, params={"dealer_id": DEALER}).status_code == 401
    view = client.get(url, params={"dealer_id": DEALER}, headers=headers).json()
    assert view["status"]["customer_status"] == "ACTIVE"
    assert view["opportunities"][0]["opportunity_status"] == "SOLD_PENDING"
    assert client.get("/v1/customers/66f0000000000000000000ff/ownership", params={"dealer_id": DEALER},
                      headers=headers).status_code == 404
