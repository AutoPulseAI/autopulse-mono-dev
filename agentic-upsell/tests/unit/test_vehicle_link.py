"""Client, 20 Oct 2026 (Joel Clymer): Betsy's AI Studio answer "Here is a link to the vehicle where you can locate the
vehicle history report ... {vehicle_link}" went out with no link."""

from upsell_agent import ai_studio
from upsell_agent.agent import cannot_supply as cs
from upsell_agent.agent.vehicle_media import vehicle_page_url

BETSY = ("Here is a link to the vehicle where you can locate the vehicle history report. If everything is to your "
         "liking, what day works best for you to meet with us at the dealership? {vehicle_link}")
MAZDA = {"vin": "3MZBPAAM0RM123456", "year": 2024, "make": "Mazda", "model": "Mazda3", "miles": 18250,
         "page_url": "https://dealer.example/vdp/mazda3"}


def _with(topic, text, monkeypatch):
    monkeypatch.setitem(cs._REPLIES, topic, ai_studio._studio_to_script(text, topic))


def test_her_vehicle_link_is_the_vehicle_page_not_the_calculator(monkeypatch):
    _with("studio_carfax", BETSY, monkeypatch)
    out = cs.reply("studio_carfax", vehicle_url=MAZDA["page_url"]).text
    assert out.endswith("https://dealer.example/vdp/mazda3") and "calculator" not in out


def test_no_page_never_says_here_is_a_link(monkeypatch):
    _with("studio_carfax", BETSY, monkeypatch)
    out = cs.reply("studio_carfax", vehicle_url=None).text
    assert "link" not in out.lower() and out.startswith("If everything is to your liking")


def test_the_payment_answer_keeps_the_calculator():
    assert "{calculator}" in ai_studio._studio_to_script("We'd love to help.{vehicle_link} Our manager...", "payment")


def test_the_page_is_found_from_the_lead_or_the_vehicle_it_names():
    lead = {"data": {"vehicle": {"year": "2024", "make": "Mazda", "model": "Mazda3"}}}
    assert vehicle_page_url(lead, {}, [MAZDA]) == MAZDA["page_url"]
    assert vehicle_page_url({}, {}, [MAZDA], "carfax for 3MZBPAAM0RM123456 please") == MAZDA["page_url"]
    assert vehicle_page_url({}, {}, [MAZDA]) is None


def test_her_answers_can_use_the_cars_data(monkeypatch):
    _with("studio_miles", "It has {mileage} on it. Would you like to see it?", monkeypatch)
    assert cs.reply("studio_miles", vehicle=MAZDA).text == "It has 18,250 miles on it. Would you like to see it?"
    assert cs.reply("studio_miles", vehicle={}).text == "Would you like to see it?"


def test_the_guard_stops_a_link_that_is_not_there():
    from upsell_agent.agent.nodes.guard import link_promised_but_missing
    assert link_promised_but_missing({"sms_text": "Here is a link to the vehicle. What day works?"})
    assert not link_promised_but_missing({"sms_text": "Here is the link: https://dealer.example/vdp/x"})
    assert not link_promised_but_missing({"sms_text": "What day works best for you?"})


def test_a_time_to_come_in_with_no_day_is_booked():
    """Client, 20 Oct 2026 (Betsy: "the customer says I can come at 7 and ai abandons")."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from upsell_agent.devtools import simulate
    from upsell_agent.integrations.dealer_profile import profile_from_record
    from upsell_agent.tools import booking_tool as bt
    dealer = profile_from_record("d", {"dealer_account_information": {
        "time_zone": "America/New_York", "weekly_availability": simulate.DEV_WEEKLY_AVAILABILITY}})
    now = datetime(2026, 10, 20, 11, 0, tzinfo=ZoneInfo("America/New_York"))
    open_ = bt.available_times(dealer, [], now)
    assert bt.match_pick("I can come at 4", [], dealer, now, available=open_).matched["display"] == "today at 4:00 PM"  # Betsy, 27 Oct 2026: today is "today"
    assert bt.match_pick("4 works", [], dealer, now, available=open_).matched
    late = bt.match_pick("I can come at 7", [], dealer, now, available=open_)
    assert late.ambiguous and late.wanted  # not open: the nearest open times are offered, never silence
    assert not bt.match_pick("I get off work at 4", [], dealer, now, available=open_).matched


def test_a_visit_in_the_past_is_not_one_to_confirm():
    """Live, 20 Oct 2026 (Sadhana): "You're all set for Thursday, October 15" sent five days later."""
    from datetime import UTC, datetime, timedelta
    from zoneinfo import ZoneInfo

    from upsell_agent.agent.nodes.decide import _visit_is_over
    from upsell_agent.devtools import simulate
    from upsell_agent.integrations.dealer_profile import profile_from_record
    dealer = profile_from_record("d", {"dealer_account_information": {
        "time_zone": "America/New_York", "weekly_availability": simulate.DEV_WEEKLY_AVAILABILITY}})
    now = datetime(2026, 10, 20, 15, 0, tzinfo=ZoneInfo("America/New_York"))
    past = {"bookingDate": datetime(2026, 10, 15, 4, 0, tzinfo=UTC).replace(tzinfo=None), "bookingTime": "14:00",
            "booking_status": "pending"}  # the platform stores a naive UTC date
    soon = {"bookingDate": datetime(2026, 10, 22, 4, 0, tzinfo=UTC).replace(tzinfo=None), "bookingTime": "14:00",
            "booking_status": "pending"}
    assert _visit_is_over(past, dealer, now) and not _visit_is_over(soon, dealer, now)
    assert _visit_is_over({**soon, "booking_status": "completed"}, dealer, now)
    assert not _visit_is_over(soon, dealer, now - timedelta(days=1))


def test_a_booked_date_is_not_an_invented_number():
    """Found 21 Oct 2026: "you're all set for Tuesday, September 22 at 4:00 PM" failed the guard for "22"."""
    from upsell_agent.guardrails.draft_guard import check_draft
    draft = {"sms_text": "Great - you're all set for Tuesday, September 22 at 4:00 PM.", "email_body": "", "email_subject": ""}
    bad = check_draft(draft, customer_texts=["I can come at 4"], known_values=[])
    ok = check_draft(draft, customer_texts=["I can come at 4"], known_values=["September 22"])
    assert any("22" in v for v in bad["violations"]) and not any("never gave" in v for v in ok["violations"])


def test_a_model_year_is_never_a_payment():
    """Found 21 Oct 2026 (eval): "What's the payment on the 2024 RAV4?" became a "$2,024/month goal"."""
    from upsell_agent.agent.nodes.validate import model_year_not_money
    said = "What's the payment on the 2024 RAV4?"
    assert model_year_not_money({"path": "interest.monthly_payment", "value": 2024}, said)
    assert not model_year_not_money({"path": "interest.monthly_payment", "value": 550}, "under $550 a month")
    assert not model_year_not_money({"path": "interest.budget", "value": 2000}, "I can put $2000 down")
    assert not model_year_not_money({"path": "interest.model", "value": "2024 RAV4"}, said)


def test_a_price_objection_is_answered_and_the_visit_offered_again_at_once():
    """Scope (blueprint 3C; Betsy's payment example): "Just give me your best price first" -> attempt 2 now."""
    from datetime import UTC, datetime

    from tests.unit.test_slots import SALES_ALL, _profile
    from upsell_agent.agent.conversation import ConversationState
    from upsell_agent.agent.qualification import LeadType
    from upsell_agent.agent.visit_offer import VisitState, plan_visit
    times = [{"iso": "2026-10-21T13:00:00-04:00", "date": "2026-10-21", "time": "13:00", "display": "Wednesday at 1:00 PM"},
             {"iso": "2026-10-21T15:00:00-04:00", "date": "2026-10-21", "time": "15:00", "display": "Wednesday at 3:00 PM"}]
    conversation = ConversationState(turn=3, visit=VisitState(attempts=1, offered_times=times, offered_turn=3,
                                                              angles_used=["primary_interest"]))
    objection = {"declines_visit": True, "declines_visit_confidence": 0.9, "visit_objection": "wants_numbers"}
    plan = plan_visit(profile=_profile(LeadType.SALES, *SALES_ALL[:2]), extraction=objection, conversation=conversation,
                      active_booking=None, built_times=times, booked_this_turn=False, now=datetime.now(UTC))
    assert plan.fire and plan.attempt == 2 and plan.angle == "objection"
    not_yet = {"declines_visit": True, "declines_visit_confidence": 0.9, "visit_objection": "time_convenience"}
    parked = plan_visit(profile=_profile(LeadType.SALES, *SALES_ALL[:2]), extraction=not_yet, conversation=conversation,
                        active_booking=None, built_times=times, booked_this_turn=False, now=datetime.now(UTC))
    assert not parked.fire


def test_the_guard_stops_dead_end_wording():
    from upsell_agent.agent.nodes.guard import dead_end_wording
    assert dead_end_wording({}, {"sms_text": "I can set up a drive when you’re ready."})
    assert dead_end_wording({}, {"sms_text": "Let me know when you'd like to come in."})
    assert not dead_end_wording({}, {"sms_text": "Would Tuesday at 1:00 PM or 3:00 PM work?"})
