"""PLAN_4 stream H: "speak to a human" -> a call or a text (agent/human_contact.py, Decide's offer_human rule,
the call task / staff notice after the send). Dealer A is in New York, open Monday-Friday 9:00-19:00; a person
may call 8:00-21:00 customer time. The clock is moved; nothing waits. Offline model only."""

import re
from datetime import UTC, datetime

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent import human_contact
from upsell_agent.agent.human_contact import CALL, OFFER, TEXT, CallCheck, plan, said_method
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels import consent
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.scheduler import followups

DEALER = simulate.DEV_DEALERS[0]["_id"]
pytestmark = pytest.mark.usefixtures("ny_customer")
TUESDAY_NOON = datetime(2026, 9, 22, 16, 0, tzinfo=UTC)  # 12:00 in New York
TUESDAY_NIGHT = datetime(2026, 9, 23, 2, 0, tzinfo=UTC)  # 22:00 in New York: no calls, dealer closed


# --- Reading how they want to hear from a person (pure) --------------------------------------------

@pytest.mark.parametrize(("text", "answering", "want"), [
    ("Can a real person call me instead?", False, CALL),
    ("Please have a manager call me", False, CALL),
    ("can someone give me a call", False, CALL),
    ("I'd rather talk on the phone", False, CALL),
    ("Can you have a person text me?", False, TEXT),
    ("a text is fine", False, TEXT),
    ("I want to talk to a real person", False, None),
    ("Can I speak with a salesperson?", False, None),
    ("Don't call me, but I want a real person", False, TEXT),
    ("I can't talk at work, have someone text me", False, TEXT),
    ("call", True, CALL),
    ("Text please", True, TEXT),
    ("either is fine", True, CALL),
    ("yes that number works", True, CALL),
    ("either is fine", False, None),
])
def test_how_they_want_to_hear_from_a_person(text, answering, want):
    assert said_method(text, answering=answering) == want


ALLOW = CallCheck(outcome="ALLOW", phone="+15551234567")
HOLD = CallCheck(outcome="HOLD", phone="+15551234567", until="2026-09-23T12:00:00+00:00", when="8:00 AM tomorrow")
BLOCKED = CallCheck(outcome="BLOCK", reason="the customer opted out of calls", code="opted_out")


def _plan(text, *, wants_human=True, awaiting=False, escalate=False, hold=None, call=ALLOW, channel="sms"):
    return plan(text=text, wants_human=wants_human, awaiting=awaiting, escalate=escalate, hold=hold, channel=channel,
                call=call, text_when=None, turn=3)


def test_asking_for_a_person_without_saying_how_offers_the_choice_once():
    offer = _plan("I want to talk to a real person")
    assert offer.mode == OFFER and offer.record == {"choice": "offered", "offered_turn": 4}
    shown = human_contact.for_compose(offer.as_dict())
    # The number on file is never read out: its last 4 digits only.
    assert shown["phone_last4"] == "4567" and "phone" not in shown


def test_the_answer_hands_off_and_no_clear_answer_still_gets_a_person():
    assert _plan("a call please", wants_human=False, awaiting=True).mode == CALL
    assert _plan("text", wants_human=False, awaiting=True).mode == TEXT
    unclear = _plan("ok", wants_human=False, awaiting=True)
    assert unclear.mode == TEXT and unclear.chosen_by == "default"
    withdrawn = _plan("never mind, you can help", wants_human=False, awaiting=True)
    assert withdrawn.mode is None and withdrawn.record["choice"] == "withdrawn"


def test_a_call_that_isnt_allowed_becomes_a_text_with_no_question():
    # A voice opt-out (or no phone, or DND): never a call task, and nothing to choose between.
    assert _plan("I want to talk to a real person", call=BLOCKED).mode == TEXT
    assert _plan("Can someone call me?", call=BLOCKED).mode == TEXT
    assert human_contact.for_compose(_plan("Can someone call me?", call=BLOCKED).as_dict())["calls_blocked"]


def test_upset_or_urgent_escalates_at_once_and_still_says_how():
    upset = _plan("This is ridiculous, I want a manager", escalate=True)
    assert upset.mode == CALL and upset.chosen_by == "default"
    assert _plan("I'm furious, text me", escalate=True).mode == TEXT
    assert _plan("This is ridiculous, I want a manager", escalate=True, call=BLOCKED).mode == TEXT


def test_outside_calling_hours_the_reply_says_when():
    held = _plan("call me please", call=HOLD)
    assert held.mode == CALL and human_contact.for_compose(held.as_dict())["call_when"] == "8:00 AM tomorrow"


def test_email_channel_offers_an_email_instead_of_a_text():
    assert _plan("I want to talk to a person", channel="email").written == "email"


# --- Through the real turn ----------------------------------------------------------------------------

@pytest.fixture
async def live_dealer(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one(
        {"_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True}})


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(name="Hana Human"):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name=name,
                                         comments="Hi, I want a new Toyota RAV4")
    await handlers.handle_lead_created(
        LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                         customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _say(created, text):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel="sms", text=text,
                                received_at=clock.now())
    return await handlers.handle_inbound_message(event, _deps())


async def _state(mongo, created):
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}


async def _last_turn(mongo, created):
    return (await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]}).sort(
        "created_at", -1).to_list(1))[0]


async def _last_sms(mongo, created):
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"], "channel": "sms"}).to_list(None)
    return rows[-1]["text"]


async def _open_tasks(mongo, created):
    return await mongo[AI_CALL_TASKS_COLLECTION].find({"lead_id": created["lead_id"], "status": "open"}).to_list(None)


async def test_a_person_without_saying_how_is_offered_a_call_or_a_text_then_a_call_opens_a_task(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead()
    await _say(created, "Can I talk to a real person please")
    assert (await _last_turn(mongo, created))["outcome"] == "offer_human"
    sms = await _last_sms(mongo, created)
    phone = re.sub(r"\D", "", created.get("phone") or (await _open_phone(mongo, created)))
    assert f"number ending in {phone[-4:]}" in sms and "call" in sms and "text" in sms and sms.count("?") == 1
    assert phone not in re.sub(r"\D", "", sms)  # never the full number
    state = await _state(mongo, created)
    assert state["status"] != "handoff" and state["conversation"]["awaiting_human_choice"]
    assert not await _open_tasks(mongo, created)

    await _say(created, "A call please")
    assert "will call you" in await _last_sms(mongo, created)
    state = await _state(mongo, created)
    assert state["status"] == "handoff" and state["status_reason"] == "Customer asked for a person - wants a call"
    [task] = await _open_tasks(mongo, created)
    assert task["reason"] == "Customer asked for a call" and task["requested"] is True
    assert state["staff_notice"]["kind"] == "call_task" and "asked to speak with a person" in state[
        "staff_notice"]["text"]

    # Their "thanks" afterwards is contact, but not the call they asked for: the task stays open.
    await _say(created, "Thanks so much!")
    assert len(await _open_tasks(mongo, created)) == 1


async def _open_phone(mongo, created):
    lead = await dealer_scoped_db(DEALER).collection("leads").find_one({"_id": ObjectId(created["lead_id"])})
    return consent.resolve_recipient(lead, None, "sms") or ""


async def test_have_a_person_text_me_skips_the_question_and_tells_staff(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead("Tess Texter")
    await _say(created, "Can you have a person text me instead?")
    assert (await _last_turn(mongo, created))["outcome"] == "handoff"
    assert "text you here" in await _last_sms(mongo, created)
    state = await _state(mongo, created)
    assert state["status"] == "handoff"
    assert state["staff_notice"]["kind"] == "text_requested" and "wants a text from a person" in state[
        "staff_notice"]["text"]
    assert not await _open_tasks(mongo, created)
    # The AI stops replying, as with any handoff.
    await _say(created, "ok")
    assert (await _last_turn(mongo, created))["trigger"] == "inbound_held"


async def test_outside_calling_hours_the_call_waits_and_the_reply_says_when(mongo, live_dealer):
    set_clock(TUESDAY_NIGHT)
    created = await _lead("Nate Night")
    await _say(created, "Can someone call me?")
    sms = await _last_sms(mongo, created)
    assert "will call you" in sms and "AM" in sms and "shortly" not in sms
    assert not await _open_tasks(mongo, created)
    [waiting] = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "kind": "call_task", "status": "pending"}).to_list(None)
    assert waiting["requested"] is True and waiting["task_reason"] == "Customer asked for a call"
    state = await _state(mongo, created)
    assert state["status"] == "handoff" and state["staff_notice"]["kind"] == "call_requested"

    # Calling hours: the task opens for staff, although the lead is with staff and nobody replied.
    set_clock(waiting["due_at"].replace(tzinfo=UTC))
    results = (await followups.fire_due(_deps()))["results"]
    assert "activated" in str(results)
    [task] = await _open_tasks(mongo, created)
    assert task["reason"] == "Customer asked for a call"


async def test_a_voice_opt_out_never_gets_a_call_task(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead("Vic Voiceless")
    await consent.set_channel_consent(dealer_scoped_db(DEALER), created["customer_id"], "voice", False,
                                      source="customer_opt_out_phrase", lead_id=created["lead_id"])
    await _say(created, "I want to talk to a real person")
    sms = await _last_sms(mongo, created)
    assert "call" not in sms.replace("We won't call", "") and "text you here" in sms
    assert (await _state(mongo, created))["staff_notice"]["kind"] == "text_requested"
    assert not await _open_tasks(mongo, created)


async def test_dont_call_me_but_a_person_may_text_is_answered_not_swallowed(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead("Dana Donotcall")
    await _say(created, "Please don't call me, but I'd like a real person to text me")
    assert await consent.is_opted_out(dealer_scoped_db(DEALER), created["customer_id"], "voice")
    assert (await _state(mongo, created))["staff_notice"]["kind"] == "text_requested"
    assert not await _open_tasks(mongo, created)


async def test_an_upset_customer_escalates_at_once_and_is_told_how(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead("Uma Upset")
    await _say(created, "This is ridiculous. I want to talk to a manager")
    assert (await _last_turn(mongo, created))["outcome"] == "handoff"
    assert "will call you" in await _last_sms(mongo, created)
    [task] = await _open_tasks(mongo, created)
    assert "upset" in (await _state(mongo, created))["staff_notice"]["text"]
    assert task["requested"] is True
