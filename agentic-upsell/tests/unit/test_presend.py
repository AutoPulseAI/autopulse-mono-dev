"""The last look before any message leaves (channels/presend.py) - the user / Betsy, 25 Oct 2026: "check things at
every message". Each case is a live one from 22-24 Oct 2026."""

from datetime import UTC, datetime, timedelta

import pytest
from bson import ObjectId

from tests.unit.conftest import set_clock
from tests.unit.test_appointment import DEALER, NY, _booked_friday, _new_lead, live_dealer  # noqa: F401
from upsell_agent.channels import presend
from upsell_agent.integrations.mongodb import (
    AI_MESSAGES_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    dealer_scoped_db,
)

flow = pytest.mark.usefixtures("during_opening_hours", "ny_customer", "live_dealer")


async def _inbound(mongo, lead_id, customer_id, text, at, answered=None):
    row = {"lead_id": lead_id, "customer_id": customer_id, "direction": "inbound", "text": text, "created_at": at,
           "answered_turn_id": answered, "dealer_id": DEALER}
    return str((await mongo[AI_MESSAGES_COLLECTION].insert_one(row)).inserted_id)


async def _look(created, *, turn_id="t1", text="Sounds good.", is_reply=True, answers=None):
    return await presend.check(dealer_scoped_db(DEALER), lead_id=created["lead_id"],
                               customer_id=created["customer_id"], turn_id=turn_id, text=text, is_reply=is_reply,
                               answers=answers, lead=None)


@flow
async def test_a_reply_the_customer_has_written_past_is_not_sent(mongo):
    # Nadina, 22 Oct 2026: five quick texts got five replies in two minutes.
    set_clock(datetime(2026, 10, 5, 12, 0, tzinfo=NY))
    created = await _new_lead()
    now = datetime(2026, 10, 5, 12, 0, tzinfo=NY).astimezone(UTC)
    first = await _inbound(mongo, created["lead_id"], created["customer_id"], "11 works", now)
    assert (await _look(created, answers=[first])).ok
    await _inbound(mongo, created["lead_id"], created["customer_id"], "Actually make it 12", now + timedelta(seconds=30))
    verdict = await _look(created, answers=[first])
    assert not verdict.ok and verdict.check == "superseded"


@flow
@pytest.mark.parametrize("status, stopped", [("partly_qualified", True), ("qualified", True), ("paused", False),
                                             ("handoff", False)])
async def test_a_written_past_reply_is_stopped_in_every_status_the_ai_answers(mongo, status, stopped):
    # Denise Little, 27 Oct 2026: "G'morning", then "What state are you in?" 9 s later - two replies, the first
    # ignoring her question, because her lead was partly_qualified. A paused / handed-off lead's newer message
    # isn't answered by the AI, so the reply already written still goes.
    from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION
    set_clock(datetime(2026, 10, 5, 12, 0, tzinfo=NY))
    created = await _new_lead()
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]}, {"$set": {"status": status}})
    now = datetime(2026, 10, 5, 12, 0, tzinfo=NY).astimezone(UTC)
    first = await _inbound(mongo, created["lead_id"], created["customer_id"], "G'morning", now)
    await _inbound(mongo, created["lead_id"], created["customer_id"], "What state are you in?", now + timedelta(seconds=9))
    verdict = await _look(created, answers=[first])
    assert (not verdict.ok and verdict.check == "superseded") if stopped else verdict.ok


@flow
async def test_a_reply_covering_several_quick_texts_is_sent(mongo):
    set_clock(datetime(2026, 10, 5, 12, 0, tzinfo=NY))
    created = await _new_lead()
    now = datetime(2026, 10, 5, 12, 0, tzinfo=NY).astimezone(UTC)
    a = await _inbound(mongo, created["lead_id"], created["customer_id"], "Hi", now)
    b = await _inbound(mongo, created["lead_id"], created["customer_id"], "Is it still there?", now + timedelta(seconds=5))
    assert (await _look(created, answers=[a, b])).ok


@flow
async def test_no_sales_message_to_a_customer_booked_on_their_other_lead(mongo):
    # Nadina / Nelson / Thomas, 24 Oct 2026: staff booked on the duplicate lead; the main lead kept prospecting.
    created, _ = await _booked_friday(mongo)
    other = ObjectId()
    await mongo[PLATFORM_LEADS_COLLECTION].insert_one({"_id": other, "dealer_id": DEALER,
                                                       "customer_id": created["customer_id"], "data": {}})
    look_other = {**created, "lead_id": str(other)}
    verdict = await _look(look_other, turn_id="cadence-abc-fire1", is_reply=False, text="Still with me?")
    assert not verdict.ok and verdict.check == "appointment"
    assert (await _look(look_other, text="Sure - see you Friday!")).ok  # a reply still goes


@flow
async def test_a_confirmation_the_calendar_contradicts_is_stopped(mongo):
    # Joshuah, 23 Oct 2026: "You're all set for Sunday" while the booking stayed on Saturday.
    created, _ = await _booked_friday(mongo)
    verdict = await _look(created, text="Perfect - you're all set for Sunday at 11:00 AM.")
    assert not verdict.ok and verdict.check == "calendar" and verdict.staff_notice
    assert (await _look(created, text="Perfect - you're all set for Friday at 10:00 AM.")).ok


@flow
async def test_a_follow_up_waits_after_a_burst_of_messages(mongo):
    set_clock(datetime(2026, 10, 5, 12, 0, tzinfo=NY))
    created = await _new_lead()
    now = datetime(2026, 10, 5, 12, 0, tzinfo=NY).astimezone(UTC)
    await mongo[AI_MESSAGES_COLLECTION].insert_many([
        {"lead_id": created["lead_id"], "direction": "outbound", "status": "sent", "sent_at": now - timedelta(minutes=m),
         "dealer_id": DEALER, "idempotency_key": f"burst-{m}"} for m in (1, 3, 5)])
    verdict = await presend.burst_wait(dealer_scoped_db(DEALER), lead_id=created["lead_id"],
                                       customer_id=created["customer_id"])
    assert not verdict.ok and verdict.hold_until > now


@flow
async def test_each_check_can_be_switched_off_in_ai_studio(mongo, monkeypatch):
    created, _ = await _booked_friday(mongo)
    monkeypatch.setattr(presend, "CHECKS", {**presend.CHECKS, "calendar": False})
    assert (await _look(created, text="Perfect - you're all set for Sunday at 11:00 AM.")).ok


@flow
async def test_the_sender_runs_the_last_check_on_every_message(mongo):
    from tests.unit.test_appointment import _deps
    from upsell_agent.channels.sender import SendRequest
    created, _ = await _booked_friday(mongo)
    outcome = await _deps().sender.send(SendRequest(
        dealer_id=DEALER, lead_id=created["lead_id"], customer_id=created["customer_id"], turn_id="presend-calendar",
        channel="sms", text="You're all set for Sunday at 11:00 AM.", is_reply=True, purpose="lead_response"))
    assert outcome.status == "suppressed" and outcome.reason.startswith("last check (calendar)")
    row = await mongo[AI_MESSAGES_COLLECTION].find_one({"idempotency_key": "presend-calendar:sms"})
    assert row["status"] == "suppressed" and row["presend"] == "calendar"


@flow
async def test_a_newer_message_already_claimed_by_its_own_turn_still_stops_this_reply(mongo):
    # Joyce Capuano, 26 Oct 2026: her next message was claimed by its own turn, so both replies went, 25 s apart.
    set_clock(datetime(2026, 10, 5, 12, 0, tzinfo=NY))
    created = await _new_lead()
    now = datetime(2026, 10, 5, 12, 0, tzinfo=NY).astimezone(UTC)
    first = await _inbound(mongo, created["lead_id"], created["customer_id"], "hmm", now, answered="t1")
    await _inbound(mongo, created["lead_id"], created["customer_id"], "Please answer my question",
                   now + timedelta(seconds=25), answered="t2")
    verdict = await _look(created, turn_id="t1", answers=[first])
    assert not verdict.ok and verdict.check == "superseded"


@flow
@pytest.mark.parametrize(("status", "stopped"), [("Appointment Booked", True), ("Visited", True), ("Sold", True),
                                                 ("DND", True), ("Managerial Review", False),
                                                 ("Contacted - No Next Action", False), ("No Show", False)])
async def test_a_follow_up_reads_the_crm_status_fresh_before_it_goes(mongo, status, stopped):
    # The user, 28 Oct 2026: "Still with me?" went out after staff set the lead to Appointment Booked.
    from upsell_agent.integrations.mongodb import PLATFORM_LEADS_COLLECTION, as_object_id
    created = await _new_lead()
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": as_object_id(created["lead_id"])},
                                                      {"$set": {"fe_lead_status": status}})
    for turn in ("studio-abc", "cadence-xyz"):
        verdict = await _look(created, turn_id=turn, text="Still with me?", is_reply=False)
        assert (not verdict.ok and verdict.check == "crm_status") is stopped, (turn, verdict)
    reply = await _look(created, turn_id="reply-1", text="Sure, it's here.", is_reply=True)
    assert reply.ok  # a reply to the customer is never stopped by this
