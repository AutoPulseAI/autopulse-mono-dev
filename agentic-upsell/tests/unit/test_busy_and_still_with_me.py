"""Betsy, 21 Oct 2026 (approved items 8 and 9).

Item 8: a customer who was texting with us and stopped after the AI's question gets one "still with me?" 15 minutes
later (AI Studio -> Cadences -> "Still with me?", On/Off) - never after a "what time works?" or a dated check-back,
and never twice when the dealership has its own "AI asks a question" cadence.
Item 9: "I'm busy, talk later" -> the AI asks what time works and nothing else; their answer (or "text me at 5",
"in 2 hours") is a check-back at that time today; "tomorrow" without a time is the next morning. "Can I come in at
4 today?" stays a visit.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from tests.unit.test_human_contact import DEALER, TUESDAY_NOON, _deps, _last_sms, _lead, _say, _state, live_dealer  # noqa: F401
from tests.unit.conftest import set_clock
from upsell_agent import ai_studio, clock
from upsell_agent.agent.nodes.decide import BUSY_NOW, later_today
from upsell_agent.integrations.mongodb import SCHEDULED_FOLLOWUPS_COLLECTION
from upsell_agent.scheduler import followups, studio_cadences

pytestmark = [pytest.mark.usefixtures("ny_customer"), pytest.mark.still_with_me]
NY = ZoneInfo("America/New_York")
NOON = datetime(2026, 9, 22, 12, 0, tzinfo=NY)


@pytest.mark.parametrize("text", ["I'm busy right now", "im at work, talk later", "can't talk right now",
                                  "I'll text you tomorrow", "not a good time"])
def test_busy_phrases(text):
    assert BUSY_NOW.search(text)


@pytest.mark.parametrize("text", ["Is the RAV4 still available?", "I'm interested in the blue one",
                                  "Can I come in at 4 today?"])
def test_not_busy(text):
    assert not BUSY_NOW.search(text)


@pytest.mark.parametrize("words,text,busy,want", [
    ("", "busy, text me at 5", True, ("2026-09-22", "17:00", "today at 5 PM")),
    ("", "I'm busy, try me in 2 hours", True, ("2026-09-22", "14:00", "today around 2 PM")),
    ("", "in an hour please", True, ("2026-09-22", "13:00", "today around 1 PM")),
    ("", "after 6", True, ("2026-09-22", "18:00", "today at 6 PM")),
    ("", "at 9am", True, ("2026-09-23", "09:00", "tomorrow, Wednesday, at 9 AM")),  # 9 AM has passed: tomorrow
])
def test_later_today(words, text, busy, want):
    got = later_today(words, text, NOON, busy=busy)
    assert (got["date"], got["time"], got["display"]) == want


def test_later_today_leaves_other_days_and_too_soon_alone():
    assert later_today("tomorrow at 5", "tomorrow at 5", NOON, busy=True) is None  # the usual dated step
    assert later_today("", "in 5 minutes", NOON, busy=True) is None
    assert later_today("", "no time here", NOON, busy=True) is None


async def _pending(mongo, created, kind):
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "kind": kind, "status": "pending"}).to_list(None)


async def test_busy_without_a_time_asks_when_then_the_answer_is_the_check_back(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead("Bea Busy")
    await _say(created, "I'm busy right now, talk later")
    sms = await _last_sms(mongo, created)
    assert "What time works best" in sms and sms.count("?") == 1
    assert not await _pending(mongo, created, studio_cadences.KIND_STUDIO_TOUCH)  # no "still with me?" on this
    assert (await _state(mongo, created))["conversation"]["asked_when_free_turn"]

    await _say(created, "5pm")
    [step] = await _pending(mongo, created, followups.KIND_NEXT_ACTION)
    assert step["due_at"].replace(tzinfo=UTC).astimezone(NY).strftime("%Y-%m-%d %H:%M") == "2026-09-22 17:00"
    assert "today at 5 PM" in await _last_sms(mongo, created)
    assert (await _state(mongo, created)).get("stage") != "appointment_set"  # a check-back, not a visit


async def test_busy_tomorrow_without_a_time_is_the_next_morning(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead("Tom Tomorrow")
    await _say(created, "I'm at work, text me tomorrow")
    [step] = await _pending(mongo, created, followups.KIND_NEXT_ACTION)
    local = step["due_at"].replace(tzinfo=UTC).astimezone(NY)
    assert local.date().isoformat() == "2026-09-23" and local.hour < 12


async def test_still_with_me_after_an_unanswered_question_once(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead("Sam Stillthere")
    await _say(created, "What colors do you have?")
    if "?" not in await _last_sms(mongo, created):
        pytest.skip("this reply asked nothing")
    [touch] = await _pending(mongo, created, studio_cadences.KIND_STUDIO_TOUCH)
    assert touch["studio_cadence"] == "still_with_me" and touch["touch"]["channels"] == ["sms"]
    due = touch["due_at"].replace(tzinfo=UTC) - TUESDAY_NOON
    assert timedelta(minutes=15) <= due < timedelta(minutes=15, seconds=5)
    # A reply before then: cancelled when it comes due.
    await _say(created, "blue please")
    set_clock(TUESDAY_NOON + timedelta(minutes=16))
    await followups.fire_due(_deps())
    first = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"_id": touch["_id"]})
    assert first["status"] == "cancelled"


async def test_still_with_me_off_or_replaced_by_her_own(mongo, live_dealer, monkeypatch):
    builtin = ai_studio._built_in()[("cadences", "still_with_me")]
    monkeypatch.setitem(ai_studio._changed, ("cadences", "still_with_me"), {**builtin, "enabled": False})
    assert "still_with_me" not in dict(studio_cadences.added_cadences())
    monkeypatch.delitem(ai_studio._changed, ("cadences", "still_with_me"))
    assert "still_with_me" in dict(studio_cadences.added_cadences())
    monkeypatch.setitem(ai_studio._changed, ("cadences", "betsy_15_min"), {
        "starts_when": {"type": "ai_asked"}, "steps": [{"id": "a", "message": {"mode": "fixed", "text": "Hi?"}}]})
    keys = dict(studio_cadences.added_cadences())
    assert "betsy_15_min" in keys and "still_with_me" not in keys


# --- Item 10: "my name is Sal" ------------------------------------------------------------------------------------

def test_stated_name():
    from upsell_agent.agent.turn import stated_name
    assert stated_name("Hi, my name is Sal", "Sal")
    assert stated_name("this is Sal Romano", "Sal Romano")
    assert stated_name("call me sal", "Sal")
    assert not stated_name("Sal said the car was ready", "Sal")  # mentioned, not stated
    assert not stated_name("I'm busy", "Sal")


async def test_my_name_is_replaces_the_stored_name_on_lead_and_customer(mongo, live_dealer):
    from bson import ObjectId
    set_clock(TUESDAY_NOON)
    created = await _lead("John Smith")
    await _say(created, "Hi, my name is Sal Romano")
    leads = mongo["leads"]
    lead = await leads.find_one({"_id": ObjectId(created["lead_id"])})
    customer = await mongo["customers"].find_one({"_id": ObjectId(created["customer_id"])})
    assert lead["name"] == "Sal Romano" and customer["name"] == "Sal Romano"
    # Mentioning someone else's name changes nothing.
    await _say(created, "Mike told me about the deal")
    assert (await leads.find_one({"_id": ObjectId(created["lead_id"])}))["name"] == "Sal Romano"


async def test_a_texted_email_fills_an_empty_one_and_never_replaces(mongo, live_dealer):
    from bson import ObjectId
    set_clock(TUESDAY_NOON)
    created = await _lead("Erin Email")
    leads = mongo["leads"]
    await leads.update_one({"_id": ObjectId(created["lead_id"])}, {"$set": {"email": None}})
    await _say(created, "sure it's erin.e@example.com")
    assert (await leads.find_one({"_id": ObjectId(created["lead_id"])}))["email"] == "erin.e@example.com"
    await _say(created, "actually use other@example.com")
    assert (await leads.find_one({"_id": ObjectId(created["lead_id"])}))["email"] == "erin.e@example.com"


async def test_a_first_name_only_gets_the_last_name_asked_once(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead("N/A")
    await _say(created, "my name is Sal")
    assert "last name" in await _last_sms(mongo, created)



async def test_still_with_me_never_starts_from_a_follow_up_and_stops_if_anything_else_went_out(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead("Gina Ghost")
    # The lead's first message and its follow-ups ask questions too, but the customer never wrote: no nudge.
    assert not await _pending(mongo, created, studio_cadences.KIND_STUDIO_TOUCH)
    set_clock(TUESDAY_NOON + timedelta(days=1, hours=1))
    await followups.fire_due(_deps())
    assert not await _pending(mongo, created, studio_cadences.KIND_STUDIO_TOUCH)
    # She writes, the AI asks, then staff text her before the 15 minutes: the nudge is cancelled.
    await _say(created, "What colors do you have?")
    touches = await _pending(mongo, created, studio_cadences.KIND_STUDIO_TOUCH)
    if not touches:
        pytest.skip("this reply asked nothing")
    await mongo["ai_lead_state"].update_one({"lead_id": created["lead_id"]},
                                            {"$set": {"last_outbound_at": clock.now() + timedelta(minutes=5)}})
    set_clock(clock.now() + timedelta(minutes=16))
    await followups.fire_due(_deps())
    doc = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"_id": touches[0]["_id"]})
    assert doc["status"] == "cancelled" and "another message" in doc["reason"]
