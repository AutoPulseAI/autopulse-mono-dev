"""MASTER_PLAN_3 B4, the visit offer (agent/visit_offer.py): eligibility,
angle selection, the 3-attempt decline sequence, and the dated follow-up
after a 3rd decline. Pure functions, like tests/unit/test_after_hours.py."""

from datetime import UTC, datetime

from upsell_agent.agent.conversation import ConversationState, OpenQuestion, VisitState
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.visit_offer import (
    MAX_ATTEMPTS,
    declines_visit,
    eligible,
    plan_visit,
    wants_visit,
)
from upsell_agent.slots.profile import build_profile

NOW = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)
TIMES = [{"iso": "2026-10-03T10:00:00-04:00", "date": "2026-10-03", "time": "10:00", "display": "Saturday at 10:00 AM"},
         {"iso": "2026-10-03T10:30:00-04:00", "date": "2026-10-03", "time": "10:30", "display": "Saturday at 10:30 AM"}]


def _fact(path, value):
    return {"_id": f"f-{path}", "path": path, "value": value, "pending": False, "source": "bot_extracted",
            "valid_from": NOW, "observed_at": NOW}


def _profile(lead_type=LeadType.SALES, *facts):
    return build_profile(lead_type, list(facts), now=NOW)


def _conversation(turn=0, visit=None):
    return ConversationState(turn=turn, visit=visit)


# --- Eligibility (B0.12) ----------------------------------------------------------

def test_not_eligible_with_nothing_known():
    assert eligible(_profile(), {}) is False


def test_eligible_once_model_and_timeline_are_both_known():
    profile = _profile(LeadType.SALES, _fact("interest.model", "Toyota RAV4"), _fact("interest.timeline", "this_month"))
    assert eligible(profile, {}) is True


def test_model_alone_is_not_enough():
    profile = _profile(LeadType.SALES, _fact("interest.model", "Toyota RAV4"))
    assert eligible(profile, {}) is False


def test_a_buying_signal_is_eligible_right_away():
    assert eligible(_profile(), {"wants_visit": True, "wants_visit_confidence": 0.9}) is True
    assert wants_visit({"wants_visit": True, "wants_visit_confidence": 0.5}) is False  # below the bar


def test_trade_in_and_service_leads_are_eligible_too():
    # MASTER_PLAN_3 B4, architecture §15 decision 106 (client override): every lead type, not sales-only.
    trade = _profile(LeadType.TRADE_IN, _fact("trade_in.model", "Civic"), _fact("interest.timeline", "this_week"))
    assert eligible(trade, {}) is True
    service = _profile(LeadType.SERVICE, _fact("vehicle.model", "Outback"), _fact("contact.best_time", "morning"))
    assert eligible(service, {}) is True


# --- Declines and confidence ------------------------------------------------------

def test_declines_visit_needs_the_confidence_bar():
    assert declines_visit({"declines_visit": True, "declines_visit_confidence": 0.5}) is False
    assert declines_visit({"declines_visit": True, "declines_visit_confidence": 0.9}) is True


# --- The offer itself --------------------------------------------------------------

def test_first_offer_is_attempt_one_with_the_primary_interest_angle():
    profile = _profile(LeadType.SALES, _fact("interest.model", "Toyota RAV4"), _fact("interest.timeline", "this_month"))
    plan = plan_visit(profile=profile, extraction={}, conversation=_conversation(), active_booking=None,
                      built_times=TIMES, booked_this_turn=False, now=NOW)
    assert plan.fire and plan.attempt == 1 and plan.angle == "primary_interest"
    assert "RAV4" in plan.value_proposition
    assert plan.record["attempts"] == 1 and plan.record["angles_used"] == ["primary_interest"]
    assert plan.record["offered_times"] == TIMES


def test_not_eligible_yet_offers_nothing():
    plan = plan_visit(profile=_profile(), extraction={}, conversation=_conversation(), active_booking=None,
                      built_times=[], booked_this_turn=False, now=NOW)
    assert plan.fire is False and plan.record is None


def test_already_booked_makes_no_more_offers():
    profile = _profile(LeadType.SALES, _fact("interest.model", "RAV4"), _fact("interest.timeline", "this_month"))
    plan = plan_visit(profile=profile, extraction={}, conversation=_conversation(), active_booking={"_id": "b1"},
                      built_times=TIMES, booked_this_turn=False, now=NOW)
    assert plan.fire is False


# --- The 3-attempt decline sequence (B4 item 4) -------------------------------------

def _offered(attempt, angles, turn=1):
    return VisitState(attempts=attempt, angles_used=angles, offered_times=TIMES, offered_turn=turn)


def test_a_decline_parks_the_offer_without_stopping():
    conversation = _conversation(turn=1, visit=_offered(1, ["primary_interest"]))
    plan = plan_visit(profile=_profile(), extraction={"declines_visit": True, "declines_visit_confidence": 0.9},
                      conversation=conversation, active_booking=None, built_times=[], booked_this_turn=False, now=NOW)
    assert plan.fire is False and plan.record["declined"] is True and plan.record["stopped"] is False
    assert plan.schedule_followup is False


def test_attempt_two_uses_a_different_angle_than_attempt_one():
    profile = _profile(LeadType.SALES, _fact("interest.model", "RAV4"), _fact("interest.timeline", "this_month"))
    # Declined at reply #1; reply #4 is past the 3-reply parking window.
    conversation = _conversation(turn=4, visit=VisitState(attempts=1, angles_used=["primary_interest"],
                                                          offered_times=[], offered_turn=1, declined=True,
                                                          declined_turn=1))
    plan = plan_visit(profile=profile, extraction={}, conversation=conversation, active_booking=None,
                      built_times=TIMES, booked_this_turn=False, now=NOW)
    assert plan.fire and plan.attempt == 2 and plan.angle == "objection" and plan.angle != "primary_interest"


def test_attempt_two_uses_the_seen_objection():
    conversation = _conversation(turn=1, visit=VisitState(attempts=1, angles_used=["primary_interest"],
                                                          objections=["wants_numbers"]))
    plan = plan_visit(profile=_profile(), extraction={}, conversation=conversation, active_booking=None,
                      built_times=TIMES, booked_this_turn=False, now=NOW)
    assert plan.attempt == 2 and "numbers" in plan.value_proposition


def test_attempt_three_uses_a_third_distinct_angle():
    conversation = _conversation(turn=1, visit=VisitState(attempts=2, angles_used=["primary_interest", "objection"]))
    plan = plan_visit(profile=_profile(LeadType.TRADE_IN), extraction={}, conversation=conversation,
                      active_booking=None, built_times=TIMES, booked_this_turn=False, now=NOW)
    assert plan.attempt == 3 and plan.angle == "value_proposition" and "appraisal" in plan.value_proposition


def test_third_decline_stops_offering_and_schedules_the_dated_followup():
    conversation = _conversation(turn=3, visit=_offered(MAX_ATTEMPTS, ["primary_interest", "objection",
                                                                       "value_proposition"], turn=3))
    plan = plan_visit(profile=_profile(), extraction={"declines_visit": True, "declines_visit_confidence": 0.9},
                      conversation=conversation, active_booking=None, built_times=[], booked_this_turn=False, now=NOW)
    assert plan.record["stopped"] is True and plan.schedule_followup is True
    assert plan.followup_due == "2026-10-02"  # +3 days, no date named
    assert plan.handoff is False  # no staff-only question open


def test_third_decline_with_a_customer_named_date_uses_it():
    conversation = _conversation(turn=3, visit=_offered(MAX_ATTEMPTS, ["primary_interest", "objection",
                                                                       "value_proposition"], turn=3))
    plan = plan_visit(profile=_profile(), extraction={"declines_visit": True, "declines_visit_confidence": 0.9,
                                                       "visit_later_when": "in a month"},
                      conversation=conversation, active_booking=None, built_times=[], booked_this_turn=False, now=NOW)
    assert plan.followup_due == "2026-10-29"  # "in a month" resolved from NOW (slots/dates.py)


def test_third_decline_with_a_staff_only_question_open_hands_off():
    conversation = ConversationState(
        turn=3, visit=_offered(MAX_ATTEMPTS, ["primary_interest", "objection", "value_proposition"], turn=3),
        open_questions=[OpenQuestion(text="How much can you offer for financing?", label="restricted")])
    plan = plan_visit(profile=_profile(), extraction={"declines_visit": True, "declines_visit_confidence": 0.9},
                      conversation=conversation, active_booking=None, built_times=[], booked_this_turn=False, now=NOW)
    assert plan.handoff is True


def test_stopped_offer_is_never_repeated():
    conversation = _conversation(turn=4, visit=VisitState(attempts=MAX_ATTEMPTS,
                                                          angles_used=["primary_interest", "objection",
                                                                      "value_proposition"], stopped=True))
    profile = _profile(LeadType.SALES, _fact("interest.model", "RAV4"), _fact("interest.timeline", "this_month"))
    plan = plan_visit(profile=profile, extraction={}, conversation=conversation, active_booking=None,
                      built_times=TIMES, booked_this_turn=False, now=NOW)
    assert plan.fire is False


def test_a_declined_offer_is_parked_for_three_replies():
    profile = _profile(LeadType.SALES, _fact("interest.model", "RAV4"), _fact("interest.timeline", "this_month"))
    parked = VisitState(attempts=1, angles_used=["primary_interest"], declined=True, declined_turn=2)
    for turn in (2, 3, 4):
        plan = plan_visit(profile=profile, extraction={}, conversation=_conversation(turn=turn, visit=parked),
                          active_booking=None, built_times=TIMES, booked_this_turn=False, now=NOW)
        assert plan.fire is False and "parked" in plan.why
    plan = plan_visit(profile=profile, extraction={}, conversation=_conversation(turn=5, visit=parked),
                      active_booking=None, built_times=TIMES, booked_this_turn=False, now=NOW)
    assert plan.fire is True and plan.attempt == 2


def test_an_unrelated_reply_keeps_the_times_on_the_table_once():
    profile = _profile(LeadType.SALES, _fact("interest.model", "RAV4"), _fact("interest.timeline", "this_month"))
    first = plan_visit(profile=profile, extraction={}, conversation=_conversation(turn=1, visit=_offered(1, ["primary_interest"])),
                       active_booking=None, built_times=TIMES, booked_this_turn=False, now=NOW)
    assert first.fire is False and first.record["offered_times"] == TIMES and first.record["offered_turn"] == 2
    held = VisitState.model_validate(first.record)
    second = plan_visit(profile=profile, extraction={}, conversation=_conversation(turn=2, visit=held),
                        active_booking=None, built_times=TIMES, booked_this_turn=False, now=NOW)
    assert second.fire is False and second.record["offered_times"] == []
    third = plan_visit(profile=profile, extraction={}, conversation=_conversation(turn=3, visit=VisitState.model_validate(second.record)),
                       active_booking=None, built_times=TIMES, booked_this_turn=False, now=NOW)
    assert third.fire is True and third.attempt == 2
