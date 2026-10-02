"""MASTER_PLAN_3 C4: the Short-Term and extended cadence (agent/cadence.py;
Omnichannel PDF §3-§4). Touch 1's required structure, Touch 2's name nudge,
Days 2-7, weekly, monthly, and the rules around them: every touch on text AND
email, a reply skips the nudge, stages cancel stale touches, a channel opted
out never stops the other, and nothing sends after Day 90."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent import cadence, lifecycle
from upsell_agent.agent.cadence import CadenceState
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent, LeadPausedEvent
from upsell_agent.integrations.mongodb import (
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

NY = ZoneInfo("America/New_York")
DEALER = simulate.DEV_DEALERS[0]["_id"]


# --- The schedule itself (pure) -----------------------------------------------------------------

def _plan_all(started: datetime, *, reentered: bool = False, replies: dict[int, bool] | None = None):
    """Walks a silent lead through the whole cadence: (touch, day, theme) per touch, in order."""
    state = cadence.started(CadenceState(), at=started, reentered=reentered)
    now, out = started, []
    for _ in range(40):
        plan = cadence.plan_touch(state, now=now, tz=NY, first_contact_done=True)
        if not plan.scheduled:
            break
        out.append((plan.touch_number, plan.day, plan.theme.id))
        now = plan.due_at
        state = cadence.after_touch(state, plan, at=now)
    return out


def test_the_clients_schedule_for_a_silent_lead():
    started = datetime(2026, 10, 6, 9, 30, tzinfo=NY)  # a Tuesday
    plan = _plan_all(started)
    assert plan[0] == (2, 1, "name_nudge")
    # Days 2-7, one touch a day, in the client's own order (Omnichannel PDF §3).
    assert plan[1:7] == [(3, 2, "vehicle_visual"), (4, 3, "financing_help"), (5, 4, "trade_in"),
                         (6, 5, "vehicle_value"), (7, 6, "appointment_value"), (8, 7, "direct_close")]
    # Then weekly to Day 30, then monthly to Day 90 (§4), and nothing after.
    assert [day for _, day, _ in plan[7:]] == [14, 21, 28, 58, 88]
    assert len(plan) == 12


def test_no_extended_angle_repeats_until_every_one_has_been_used():
    plan = _plan_all(datetime(2026, 10, 6, 9, 30, tzinfo=NY))
    extended = [theme for touch, _, theme in plan if touch > 8]
    assert len(extended) == 5 and len(set(extended)) == 5  # "the most relevant unused angle" (§4)


def test_days_8_to_30_are_weekly_and_31_to_90_monthly():
    assert [cadence.next_day_after(d) for d in (7, 14, 21, 28, 58, 88)] == [14, 21, 28, 58, 88, None]
    assert cadence.next_day_after(1) == 2 and cadence.next_day_after(6) == 7


def test_touches_go_out_at_ten_dealer_time_on_their_day():
    started = datetime(2026, 10, 6, 21, 15, tzinfo=NY)
    state = cadence.started(CadenceState(), at=started)
    state = cadence.after_touch(state, cadence.PlannedTouch(touch_number=2, theme=cadence.NAME_NUDGE, day=1),
                                at=started + timedelta(hours=3))
    plan = cadence.plan_touch(state, now=started + timedelta(hours=3), tz=NY, first_contact_done=True)
    assert plan.day == 2 and plan.due_at == datetime(2026, 10, 7, 10, 0, tzinfo=NY)


def test_the_name_nudge_is_three_hours_after_the_first_reply():
    now = datetime(2026, 10, 6, 14, 0, tzinfo=NY)
    plan = cadence.plan_touch(cadence.started(CadenceState(), at=now), now=now, tz=NY, first_contact_done=True)
    assert plan.theme is cadence.NAME_NUDGE and plan.due_at == now + timedelta(hours=3)


def test_nothing_is_planned_before_the_first_reply_has_gone_out():
    now = datetime(2026, 10, 6, 14, 0, tzinfo=NY)
    assert not cadence.plan_touch(cadence.started(CadenceState(), at=now), now=now, tz=NY,
                                  first_contact_done=False).scheduled


def test_a_reply_skips_the_name_nudge():
    now = datetime(2026, 10, 6, 14, 0, tzinfo=NY)
    state = cadence.after_reply(cadence.started(CadenceState(), at=now))
    plan = cadence.plan_touch(state, now=now + timedelta(hours=1), tz=NY, first_contact_done=True)
    assert plan.theme.id == "vehicle_visual" and plan.touch_number == 3


def test_a_reply_after_the_nudge_changes_nothing():
    state = CadenceState(started_at=datetime(2026, 10, 6, tzinfo=NY), touch_number=5, themes_used=["vehicle_visual"])
    assert cadence.after_reply(state) is state


def test_a_touch_whose_day_has_passed_moves_to_the_next_day_in_the_schedule():
    # The customer kept talking through Day 3: financing help (Day 3) isn't sent late, it moves to Day 4.
    started = datetime(2026, 10, 6, 9, 30, tzinfo=NY)
    state = CadenceState(started_at=started, touch_number=4, last_touch_day=2, themes_used=["vehicle_visual"])
    now = datetime(2026, 10, 8, 15, 0, tzinfo=NY)  # Day 3
    plan = cadence.plan_touch(state, now=now, tz=NY, first_contact_done=True)
    assert plan.theme.id == "financing_help" and plan.day == 4
    assert plan.due_at == datetime(2026, 10, 9, 10, 0, tzinfo=NY)


def test_re_entry_skips_the_introduction_and_the_nudge_and_starts_a_fresh_schedule():
    started = datetime(2026, 11, 20, 9, 30, tzinfo=NY)
    plan = _plan_all(started, reentered=True)
    assert plan[0] == (3, 2, "vehicle_visual") and all(theme != "name_nudge" for _, _, theme in plan)


def test_touch_1_opening_is_the_clients_required_text():
    text = cadence.touch1_intro(customer_first_name="Maria", agent_name="Ava", dealership="ABC Toyota",
                                city="Springfield", state_code="NJ", vehicle="2023 Toyota Camry")
    assert text == ("Hello Maria, this is Ava from ABC Toyota in Springfield, NJ. Thank you for your interest in "
                    "our 2023 Toyota Camry. I am excited to help you with your purchase.")


def test_touch_1_opening_never_invents_what_the_dealer_record_lacks():
    text = cadence.touch1_intro(customer_first_name="Maria", agent_name=None, dealership="ABC Toyota",
                                city=None, state_code=None, vehicle=None)
    assert text == ("Hello Maria from ABC Toyota. Thank you for getting in touch. "
                    "I am excited to help you with your purchase.")
    assert "this is" not in text


def test_touch_1_closing_question_is_dropped_only_when_a_trade_in_is_known():
    assert cadence.touch1_ending(False) == "Tell me, what are you driving now?"
    assert cadence.touch1_ending(True) is None


# --- Through the real handlers, turns, scheduler and send check ------------------------------

pytestmark_flow = pytest.mark.usefixtures("during_opening_hours", "ny_customer", "live_dealer")


@pytest.fixture
async def live_dealer(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one({
        "_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True},
        "dealer_account_information": {
            "time_zone": "America/New_York", "store_name": "Sunrise Motors", "store_city": "Springfield",
            "store_state": "NJ", "weekly_availability": simulate.DEV_WEEKLY_AVAILABILITY}})


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _new_lead(comments="Hi, I'm interested in a 2023 Toyota Camry", name="Maria Test"):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name=name, comments=comments)
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _say(created, text, channel="sms"):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel=channel,
                                text=text, received_at=clock.now())
    return await handlers.handle_inbound_message(event, _deps())


async def _state(mongo, created) -> dict:
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}


async def _pending_touches(mongo, created) -> list[dict]:
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "status": "pending", "kind": "cadence_touch"}).to_list(None)


async def _outbox(mongo, created) -> list[dict]:
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    return sorted(rows, key=lambda r: r["created_at"])


async def _fire_next_touch(mongo, created) -> dict:
    """Moves the clock to the pending touch's due time and fires it."""
    [touch] = await _pending_touches(mongo, created)
    due = touch["due_at"] if touch["due_at"].tzinfo else touch["due_at"].replace(tzinfo=UTC)
    set_clock(due + timedelta(minutes=1))
    result = await followups.fire_due(_deps())
    return {"touch": touch, **result}


@pytestmark_flow
async def test_touch_1_has_the_required_structure_and_ending(mongo):
    created = await _new_lead()
    [first] = await _outbox(mongo, created)
    text = first["text"]
    assert text.startswith("Hello Maria from Sunrise Motors in Springfield, NJ. Thank you for your interest in our")
    assert "I am excited to help you with your purchase." in text
    assert text.endswith("Tell me, what are you driving now?") and len(text) <= 480
    assert "this is" not in text  # no agent name on the dealer record, so none is claimed


@pytestmark_flow
async def test_touch_1_names_the_agent_when_the_dealer_has_given_one(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].update_one(
        {"_id": ObjectId(DEALER)}, {"$set": {"dealer_account_information.ai_agent_name": "Ava"}})
    created = await _new_lead()
    [first] = await _outbox(mongo, created)
    assert first["text"].startswith("Hello Maria, this is Ava from Sunrise Motors in Springfield, NJ.")


@pytestmark_flow
async def test_touch_1_skips_the_closing_question_when_a_trade_in_is_already_indicated(mongo):
    created = await _new_lead(comments="I want to trade in my 2018 Nissan Altima for a new Toyota RAV4")
    [first] = await _outbox(mongo, created)
    assert "what are you driving now" not in first["text"].lower()
    assert first["text"].startswith("Hello Maria")


@pytestmark_flow
async def test_the_first_reply_starts_the_cadence_and_plans_the_name_nudge(mongo):
    created = await _new_lead()
    state = await _state(mongo, created)
    assert state["cadence"]["touch_number"] == 2 and state["cadence"]["started_at"]
    [touch] = await _pending_touches(mongo, created)
    assert touch["touch"]["theme"] == "name_nudge" and touch["touch"]["touch_number"] == 2
    due = touch["due_at"].replace(tzinfo=UTC)
    assert timedelta(hours=2, minutes=55) < due - clock.now() < timedelta(hours=3, minutes=5)
    # Plan 1's 24h one-channel switch is gone: only a dormant fallback for a failed delivery remains.
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "kind": "channel_switch", "status": "pending"}) == 0


@pytestmark_flow
async def test_touch_2_is_the_name_nudge_on_text_and_email_and_nothing_else(mongo):
    created = await _new_lead()
    fired = await _fire_next_touch(mongo, created)
    assert fired["results"] == {"sent": 1}
    sent = [m for m in await _outbox(mongo, created)][1:]
    assert {m["channel"] for m in sent} == {"sms", "email"}
    sms = next(m for m in sent if m["channel"] == "sms")["text"]
    email = next(m for m in sent if m["channel"] == "email")["text"]
    assert sms == "Maria?"  # the client calls it non-negotiable (Omnichannel PDF §3)
    assert "Maria?" in email and len(email) < 60
    state = await _state(mongo, created)
    assert state["stage"] == "no_contact_made"  # Touch 1 and the nudge both went unanswered
    assert state["cadence"]["touch_number"] == 3


@pytestmark_flow
async def test_the_whole_cadence_runs_on_both_channels_then_stops(mongo):
    created = await _new_lead()
    seen = []
    for _ in range(14):
        pending = await _pending_touches(mongo, created)
        if not pending:
            break
        before = len(await _outbox(mongo, created))
        fired = await _fire_next_touch(mongo, created)
        assert fired["results"] == {"sent": 1}, fired
        new = (await _outbox(mongo, created))[before:]
        assert {m["channel"] for m in new} == {"sms", "email"}, "every touch goes out on text and email together"
        seen.append((fired["touch"]["touch"]["touch_number"], fired["touch"]["touch"]["day"],
                     fired["touch"]["touch"]["theme"]))
    assert [t[0] for t in seen] == list(range(2, 14))
    assert [t[2] for t in seen[:7]] == ["name_nudge", "vehicle_visual", "financing_help", "trade_in",
                                        "vehicle_value", "appointment_value", "direct_close"]
    assert [t[1] for t in seen[7:]] == [14, 21, 28, 58, 88]
    assert await _pending_touches(mongo, created) == []
    # Every touch passed the guard first time (no invented price, no fallback template).
    turns = await mongo[AI_TURN_LOG_COLLECTION].find(
        {"lead_id": created["lead_id"], "trigger": "cadence_touch"}).to_list(None)
    assert len(turns) == 12 and all(t["outcome"] != "fallback" for t in turns)


@pytestmark_flow
async def test_a_reply_skips_the_nudge_and_the_next_touch_is_days_away(mongo):
    created = await _new_lead()
    await _say(created, "Yes, I'm still interested")
    state = await _state(mongo, created)
    assert state["stage"] == "contact_made_no_next_action" and state["cadence"]["touch_number"] == 3
    [touch] = await _pending_touches(mongo, created)
    assert touch["touch"]["theme"] == "vehicle_visual" and touch["touch"]["day"] == 2
    # Never more than one pending touch: each reply replaces the last.
    await _say(created, "Do you have it in blue?")
    assert len(await _pending_touches(mongo, created)) == 1
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "kind": "cadence_touch", "status": "superseded"}) >= 1


@pytestmark_flow
async def test_one_channel_opted_out_never_stops_the_other(mongo):
    created = await _new_lead()
    await _say(created, "STOP")  # SMS only
    assert (await _state(mongo, created))["stage"] != "opted_out"
    before = len(await _outbox(mongo, created))
    fired = await _fire_next_touch(mongo, created)
    assert fired["results"] == {"sent": 1}, fired
    new = (await _outbox(mongo, created))[before:]
    assert [m["channel"] for m in new] == ["email"]  # "continue every remaining permitted channel"


@pytestmark_flow
async def test_opting_out_of_every_channel_stops_the_cadence(mongo):
    created = await _new_lead()
    await _say(created, "STOP")
    await _say(created, "Unsubscribe", channel="email")
    assert (await _state(mongo, created))["stage"] == "opted_out"
    assert await _pending_touches(mongo, created) == []


@pytestmark_flow
async def test_an_appointment_cancels_the_pending_touch(mongo):
    created = await _new_lead()
    assert len(await _pending_touches(mongo, created)) == 1
    await lifecycle.apply(dealer_scoped_db(DEALER), created["lead_id"], [lifecycle.Event("appointment_set")])
    assert await _pending_touches(mongo, created) == []
    touch = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"lead_id": created["lead_id"],
                                                                  "kind": "cadence_touch"})
    assert touch["status"] == "cancelled" and "Appointment Set" in touch["reason"]


@pytestmark_flow
async def test_the_pre_send_recheck_stops_a_touch_the_stage_no_longer_allows(mongo):
    created = await _new_lead()
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]},
                                                    {"$set": {"stage": "sales_visit"}})
    fired = await _fire_next_touch(mongo, created)
    assert fired["results"].get("cancelled") and "sent" not in fired["results"]
    log = await mongo[AI_TURN_LOG_COLLECTION].find_one({"lead_id": created["lead_id"],
                                                        "outcome": "cadence_touch_cancelled"})
    assert "Sales Visit" in log["summary"]["reason"]


@pytestmark_flow
async def test_a_staff_status_move_cancels_the_pending_touch(mongo):
    created = await _new_lead()
    await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="s1", dealer_id=DEALER, lead_id=created["lead_id"], reason='Staff moved the lead to "Visited"'))
    assert await _pending_touches(mongo, created) == []


@pytestmark_flow
async def test_a_dated_next_step_replaces_the_cadence_and_an_unanswered_one_restarts_it(mongo):
    created = await _new_lead()
    await _say(created, "Call me next week please")
    assert (await _state(mongo, created))["stage"] == "contact_made_specific_followup"
    assert await _pending_touches(mongo, created) == []  # the customer's own date replaces the cadence (§2)
    step = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "status": "pending", "kind": "next_action"})
    set_clock(step["due_at"].replace(tzinfo=UTC) + timedelta(minutes=1))
    await followups.fire_due(_deps())
    set_clock(clock.now() + timedelta(hours=24, minutes=2))
    await followups.fire_due(_deps())
    state = await _state(mongo, created)
    # No reply within 24h: back to No Contact Made and a fresh cadence (§6), without the introduction.
    assert state["stage"] == "no_contact_made" and state["cadence"]["reentered"] is True
    [touch] = await _pending_touches(mongo, created)
    assert touch["touch"]["theme"] == "vehicle_visual" and touch["touch"]["touch_number"] == 3
    assert state["opportunity_created_at"]  # the Day 91 clock is the original one, never restarted


@pytestmark_flow
async def test_a_call_request_sends_nothing_on_the_cadence_before_its_date(mongo):
    created = await _new_lead()
    await _say(created, "Call me next week please")
    assert await _pending_touches(mongo, created) == []


@pytestmark_flow
async def test_a_failed_delivery_still_falls_back_to_the_other_channel_at_once(mongo):
    created = await _new_lead()
    [standby] = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "kind": "channel_switch"}).to_list(None)
    assert standby["status"] == "standby" and standby["to_channel"] == "email"
    woke = await followups.make_due_now(dealer_scoped_db(DEALER), lead_id=created["lead_id"],
                                        source_turn_id=standby["source_turn_id"], from_channel="sms",
                                        reason="sms undelivered: switching now")
    assert woke is True
    before = len(await _outbox(mongo, created))
    fired = await followups.fire_due(_deps())
    assert fired["results"].get("sent") == 1
    assert [m["channel"] for m in (await _outbox(mongo, created))[before:]] == ["email"]


@pytestmark_flow
async def test_a_reply_cancels_the_dormant_fallback(mongo):
    created = await _new_lead()
    await _say(created, "Yes still interested")
    rows = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "kind": "channel_switch", "status": "standby"}).to_list(None)
    assert len(rows) <= 1 and all(r.get("source_turn_id") != "" for r in rows)  # only the newest reply's one


@pytestmark_flow
async def test_the_cadence_off_gives_the_old_single_switch(mongo, monkeypatch):
    monkeypatch.setattr(lifecycle, "cadence_enabled", lambda: False)
    created = await _new_lead()
    assert await _pending_touches(mongo, created) == []
    switch = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "kind": "channel_switch"})
    assert switch["status"] == "pending" and switch["to_channel"] == "email"


@pytestmark_flow
async def test_the_profile_api_shows_where_the_lead_is_in_the_cadence(mongo):
    from upsell_agent.api.leads import lead_profile

    created = await _new_lead()
    profile = await lead_profile(DEALER, created["lead_id"])
    assert profile["cadence"]["day"] == 1 and profile["cadence"]["touch_number"] == 2
    assert profile["cadence"]["next_touch"]["theme"] == "name_nudge"
