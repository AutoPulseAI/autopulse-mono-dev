"""Betsy and Bibi, 27 Oct 2026 meeting (BUILD-PLAN-27-OCT.md): no promise of options nothing will send (item 7), and a
booked customer who isn't sure keeps the appointment, marked tentative (item 6)."""

import pytest

from upsell_agent.agent import appointment
from upsell_agent.agent.nodes.guard import unbacked_options_promise


@pytest.mark.parametrize(("text", "flagged"), [
    ("No pressure - if tomorrow ends up tough, I can line up options that fit.", True),
    ("I'll put together a few options for you.", True),
    ("Let me find you some alternatives.", True),
    ("We have the 2022 Highlander XLE and the 2021 Pilot EX-L in stock. Which one would you like to see?", False),
    ("You're all set for tomorrow at 1 PM.", False),
])
def test_a_promise_of_options_later_is_stopped(text, flagged):
    assert bool(unbacked_options_promise({"action": "acknowledge"}, {"sms_text": text})) is flagged


def test_a_handoff_may_say_a_manager_will_find_options():
    assert not unbacked_options_promise({"action": "handoff"}, {"sms_text": "I can find you some options."})


@pytest.mark.parametrize(("text", "maybe"), [
    ("I can't confirm because I might not make it due to the distance and health conditions but I would like to keep "
     "tomorrow in mind", True),
    ("maybe", True), ("I'll try to make it", True), ("not sure if I can", True),
    ("I need to cancel", False), ("I won't make it", False), ("yes", False), ("can I come at 3 instead?", False),
])
def test_maybe_is_not_no(text, maybe):
    assert appointment.is_maybe(text) is maybe


def test_our_own_question_is_never_the_customers():
    # Richard, 27 Oct 2026: "Am interested"; Extract listed our "Tell me, what are you driving now?" as his question.
    from upsell_agent.agent.nodes.decide import not_our_own_questions
    ours = ["Hi Richard, this is Nicole ... It's listed at $15,609. Tell me, what are you driving now?"]
    asked = [{"text": "What are you driving now?", "label": "answerable"},
             {"text": "Is it still available?", "label": "answerable"}]
    assert not_our_own_questions(asked, "Am interested. Is it still available?", ours) == [asked[1]]
    # The customer asking the same thing back is their question.
    assert not_our_own_questions(asked[:1], "what are you driving now? lol", ours) == asked[:1]


def test_a_form_line_or_none_is_no_question():
    from upsell_agent.agent.nodes.decide import not_our_own_questions
    asked = [{"text": "None"}, {"text": "Purchase Timeframe: unsure"}, {"text": "Do you have other bmw x3's?"}]
    assert not_our_own_questions(asked, "", []) == [asked[2]]


async def test_a_photo_whose_host_says_nothing_goes_through_the_crm():
    # The Tesla Model 3 lead, 27 Oct 2026: imageonthefly.autodatadirect.com answers HEAD with no type and no size.
    from upsell_agent.agent.vehicle_media import ImageCheck, pick_vehicle_photo
    from tests.unit.conftest import make_settings
    photo = "https://imageonthefly.autodatadirect.com/images/?width=1200&height=900&IMG=USD10TSC032B01300.jpg"

    class Hosts:
        async def check(self, url):
            if "autodatadirect" in url:
                return ImageCheck(False, "not an image (no content type)")
            return ImageCheck(True, "image/jpeg, 291 KB", 298109)

    settings = make_settings("test")
    records = [{"vin": "5YJ3E1EA0MF921244", "photo_urls": [photo]}]
    pick = await pick_vehicle_photo("68e6f270ac63d8a8eba32096", "5YJ3E1EA0MF921244", channel="email",
                                    settings=settings, records=records, checker=Hosts())
    assert pick.urls == ["https://www.autopulse.ai/api/media/vehicle/68e6f270ac63d8a8eba32096/5YJ3E1EA0MF921244/0.jpg"]


async def test_a_photo_that_is_really_broken_is_still_not_sent():
    from upsell_agent.agent.vehicle_media import ImageCheck, pick_vehicle_photo
    from tests.unit.conftest import make_settings

    class Broken:
        async def check(self, url):
            return ImageCheck(False, "HEAD answered 404")

    pick = await pick_vehicle_photo("d", "5YJ3E1EA0MF921244", channel="email", settings=make_settings("test"),
                                    records=[{"vin": "5YJ3E1EA0MF921244", "photo_urls": ["https://x.example/a.jpg"]}],
                                    checker=Broken())
    assert pick.urls == []


@pytest.mark.parametrize(("text", "short"), [
    ("Yes, the 2021 Model 3 Standard Range Plus in Red Multi-Coat is here with 69,248 miles. Tell me, what are you "
     "driving now?",
     "Yes, the 2021 Model 3 Standard Range Plus in Red Multi-Coat is here. Tell me, what are you driving now?"),
    ("The 2019 BMW 5 Series 530i you asked about is here in Jet Black with 65,039 miles. It's listed at $15,609.",
     "The 2019 BMW 5 Series 530i you asked about is here in Jet Black. It's listed at $15,609."),
    ("It's here in Solar Silver, with 45,669 miles, and it's listed at $31,000.",
     "It's here in Solar Silver, and it's listed at $31,000."),
    ("The Odyssey is here. It has 45,669 miles. Tell me, what are you driving now?",
     "The Odyssey is here. Tell me, what are you driving now?"),
])
def test_the_first_text_leaves_the_miles_out(text, short):
    # Betsy, 27 Oct 2026 meeting: year, make, model and price, not the miles.
    from upsell_agent.agent.turn import without_mileage
    assert without_mileage(text) == short


def test_a_missing_name_is_asked_again_two_days_later_at_most_twice():
    from datetime import UTC, datetime, timedelta

    from upsell_agent.agent.nodes.decide import _may_ask_name
    now = datetime(2026, 10, 28, 15, tzinfo=UTC)
    assert _may_ask_name({}, now)
    assert not _may_ask_name({"name_asked": now - timedelta(hours=5), "name_asks": 1}, now)
    assert _may_ask_name({"name_asked": now - timedelta(days=3), "name_asks": 1}, now)
    assert _may_ask_name({"name_asked": (now - timedelta(days=3)).replace(tzinfo=None)}, now)  # Mongo's naive UTC
    assert not _may_ask_name({"name_asked": now - timedelta(days=9), "name_asks": 2}, now)


def test_no_other_cars_in_the_first_text_or_after_booking_unless_asked():
    from upsell_agent.agent.nodes.guard import unasked_alternatives
    pack = {"inventory": [{"vin": "OWN1", "original_inquiry": True}, {"vin": "OTHER2"}], "stock_search": {}}
    two = {"sms_vins": ["OWN1", "OTHER2"], "email_vins": ["OWN1"]}
    assert unasked_alternatives(pack, {"touch1": {"vin": "OWN1"}}, two)  # the greeting
    assert unasked_alternatives(pack, {"visit": {"status": "pending"}}, two)  # booked
    assert not unasked_alternatives(pack, {"visit": {"status": "pending", "just_booked": True}}, two)
    assert not unasked_alternatives(pack, {"action": "answer"}, two)  # mid-conversation: allowed
    assert not unasked_alternatives({**pack, "stock_search": {"asked": True}}, {"touch1": {}}, two)  # they asked
    assert not unasked_alternatives(pack, {"touch1": {"vin": "OWN1"}}, {"sms_vins": ["OWN1"]})


def test_an_older_lead_is_placed_on_its_own_day_of_the_cadence():
    # Betsy, 27 Oct 2026 meeting: a new client's last 90 days of leads go in at their own lead dates.
    from datetime import UTC, datetime, timedelta
    from zoneinfo import ZoneInfo

    from upsell_agent.agent import cadence
    ny = ZoneInfo("America/New_York")
    now = datetime(2026, 10, 28, 15, tzinfo=UTC)
    fresh = cadence.started(cadence.CadenceState(), at=now, lead_since=now - timedelta(hours=2))
    assert fresh.started_at == now and fresh.touch_number == 2  # a new lead: Day 1, the name nudge next
    old = cadence.started(cadence.CadenceState(), at=now, lead_since=now - timedelta(days=40))
    assert old.started_at == now - timedelta(days=40) and old.touch_number == 3
    planned = cadence.plan_touch(old, now=now, tz=ny, first_contact_done=True)
    assert planned.day == 58 and planned.due_at > now  # the next grid day after day 41: one touch, no burst
    too_old = cadence.started(cadence.CadenceState(), at=now, lead_since=now - timedelta(days=120))
    assert too_old.started_at == now  # past the 90 days: not backdated
    again = cadence.started(cadence.CadenceState(), at=now, reentered=True, lead_since=now - timedelta(days=40))
    assert again.started_at == now  # re-entry starts its own fresh schedule, as before


def test_on_the_hour_sends_are_spread_and_each_lead_keeps_its_minute():
    # Betsy, 27 Oct 2026 meeting: 150 follow-ups at 10:00 sharp and "the database goes down".
    from datetime import UTC, datetime

    from upsell_agent.scheduler.followups import SPREAD_MINUTES, spread_out
    ten = datetime(2026, 10, 28, 14, 0, tzinfo=UTC)
    minutes = {spread_out(ten, f"lead{n}").minute for n in range(200)}
    assert len(minutes) > 30 and max(minutes) < SPREAD_MINUTES
    assert spread_out(ten, "lead7") == spread_out(ten, "lead7")
    picked = datetime(2026, 10, 28, 14, 10, tzinfo=UTC)
    assert spread_out(picked, "lead7") == picked  # a time someone chose is kept


async def test_a_working_status_the_crm_missed_is_retried(mongo, monkeypatch):
    # Live, 28 Oct 2026: 63 leads never showed Managerial Review in the CRM - the hourly retry only knew closings.
    from upsell_agent.agent import crm_status
    from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION
    sent = []

    class Crm:
        async def set_lead_status(self, dealer_id, lead_id, status, *, reason, closed_at):
            sent.append(status)
            return {"updated": True}

    monkeypatch.setattr(crm_status, "_client", lambda platform: Crm())

    async def live(_dealer):
        return "live"
    monkeypatch.setattr("upsell_agent.integrations.dealer_mode.dealer_ai_mode", live)
    await mongo[AI_LEAD_STATE_COLLECTION].insert_one({"lead_id": "L1", "dealer_id": "D1", "crm_status_sync": {
        "status": "failed", "crm_status": "Managerial Review", "event": "team_promise", "reason_text": "x"}})
    assert await crm_status.retry_failed() == {"retried": 1, "synced": 1}
    assert sent == ["Managerial Review"]
    assert (await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": "L1"}))["crm_status_sync"]["status"] == "updated"


async def test_a_status_update_that_times_out_is_tried_once_more_at_once(mongo, monkeypatch):
    import httpx

    from upsell_agent.agent import crm_status
    from upsell_agent.integrations.mongodb import dealer_scoped_db
    answers = [httpx.ReadTimeout("slow"), {"updated": True}]

    class Slow:
        async def set_lead_status(self, *a, **k):
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer

    async def live(_dealer):
        return "live"
    monkeypatch.setattr(crm_status, "_client", lambda platform: Slow())
    monkeypatch.setattr(crm_status, "RETRY_AFTER_S", 0)
    monkeypatch.setattr("upsell_agent.integrations.dealer_mode.dealer_ai_mode", live)
    result = await crm_status.sync_status(dealer_scoped_db("D1"), "L2", "Managerial Review", reason="x",
                                          event_kind="team_promise")
    assert result["status"] == "updated" and not answers


@pytest.mark.parametrize(("status", "email_too"), [("sent", False), ("duplicate", False), ("held", False),
                                                   ("unknown", False), ("failed", True), ("suppressed", True)])
def test_one_channel_per_message_the_email_only_when_the_text_cannot_go(status, email_too):
    # The user, 28 Oct 2026: a text and its email copy is a duplicate of the same message.
    from upsell_agent.channels.sender import SendOutcome, needs_other_channel
    assert needs_other_channel(SendOutcome(status=status, idempotency_key="k", channel="sms")) is email_too
