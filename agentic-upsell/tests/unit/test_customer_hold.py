"""No timed message after the customer said no, later, or that they'll reach out (27 Oct 2026: Salvatore Giangrande,
Michael Brazza, Kashaun Blue each got a touch or "Still with me?" minutes after saying so)."""

from datetime import UTC, datetime, timedelta

import pytest

from tests.unit.conftest import set_clock
from tests.unit.test_never_silent import _deps, _lead, _say, _scheduled, _state, dealers, ny  # noqa: F401
from upsell_agent import clock
from upsell_agent.agent import customer_hold, lifecycle
from upsell_agent.integrations.mongodb import SCHEDULED_FOLLOWUPS_COLLECTION
from upsell_agent.scheduler import followups

NOW = datetime(2026, 10, 27, 14, 0, tzinfo=UTC)


def test_not_interested_holds_until_they_write_again():
    hold = customer_hold.hold_for({"not_interested": True, "not_interested_confidence": 0.95},
                                  "No longer interested Thank you", NOW)
    assert hold["until"] is None
    assert customer_hold.check({"customer_hold": hold}, "studio_touch", NOW + timedelta(days=30))[1] is False


@pytest.mark.parametrize("text", [
    "I can't now I am bed bolt have dr visit will call you when I am able",  # Michael Brazza (model gave no signal)
    "Too far",  # Denise Little
    "Im not located in New York. I'm in Columbus Ohio. So I will not be able to come in.",  # Kashaun Blue
    "I'll text you next week",
])
def test_later_or_cant_come_holds_for_a_few_days(text):
    hold = customer_hold.hold_for({}, text, NOW)
    assert hold and hold["until"] == NOW + timedelta(days=customer_hold.HOLD_DAYS)
    state = {"customer_hold": hold}
    assert customer_hold.check(state, "cadence_touch", NOW + timedelta(hours=1))[1] is False
    assert customer_hold.check(state, "cadence_touch", NOW + timedelta(days=customer_hold.HOLD_DAYS))[1] is True


@pytest.mark.parametrize("text", ["What state are you in?", "Can you send me a picture", "Hello Nicole!", "ok"])
def test_an_ordinary_message_holds_nothing(text):
    assert customer_hold.hold_for({}, text, NOW) is None


def test_replies_appointments_and_their_own_dated_step_still_run():
    state = {"customer_hold": customer_hold.hold_for({}, "Too far", NOW)}
    for kind in ("next_action", "appointment_confirm", "visit_followup", "daily_call_task", "handoff_check"):
        assert customer_hold.check(state, kind, NOW)[1] is True
    for kind in ("studio_touch", "cadence_touch", "channel_switch", "staff_quiet_resume", None):
        assert customer_hold.check(state, kind, NOW)[1] is False


def test_the_pre_send_stage_check_reads_the_hold():
    set_clock(NOW)
    state = {"stage": "contact_made_no_next_action",
             "customer_hold": customer_hold.hold_for({}, "will call you when I am able", NOW)}
    check, ok, detail = lifecycle.stage_check(state, "studio_touch")
    assert not ok and "will reach out" in detail


async def test_a_planned_touch_is_not_sent_after_they_say_they_will_call(mongo, dealers):  # noqa: F811
    set_clock(ny(13, 11))  # a weekday, 11 AM in New York: open, inside the text window
    created = await _lead()
    await _say(created, "I can't now, have a doctor visit, will call you when I am able")
    state = await _state(mongo, created)
    assert "will reach out" in state["customer_hold"]["reason"]
    # The lead's planned touch, moved to 16 minutes later (the "Still with me?" Michael Brazza got).
    [touch] = [t for t in await _scheduled(mongo, created, followups.KIND_CADENCE_TOUCH) if t["status"] == "pending"]
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].update_one(
        {"_id": touch["_id"]}, {"$set": {"due_at": clock.now() + timedelta(minutes=16)}})
    clock.set_offset(clock.offset_s() + 17 * 60)
    await followups.fire_due(_deps())
    fired = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"_id": touch["_id"]})
    assert fired["status"] == "cancelled" and "will reach out" in str(fired)
    # They write again: the hold is gone.
    await _say(created, "What time do you close today?")
    assert (await _state(mongo, created)).get("customer_hold") is None
