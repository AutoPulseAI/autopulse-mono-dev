"""PLAN_4 stream X3 items 2, 3, 9, 10: conversation leverage, offered times, invented facts in words,
auto-responders. Pure functions; the cases are the real gpt-5-mini transcripts of audit 4
(evals/reports/conversation_cost/conversation_cost_gpt-5-mini_streamQ_20261004-1309.md)."""

from datetime import UTC, datetime

from upsell_agent.agent.conversation import ConversationState, VisitState
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.visit_offer import customer_objective, plan_visit
from upsell_agent.guardrails.draft_guard import check_draft
from upsell_agent.slots.profile import build_profile

NOW = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)
TIMES = [{"iso": "2026-10-03T10:00:00-04:00", "date": "2026-10-03", "time": "10:00", "display": "Saturday at 10:00 AM"}]


def _fact(path, value):
    return {"_id": f"f-{path}", "path": path, "value": value, "pending": False, "source": "bot_extracted",
            "valid_from": NOW, "observed_at": NOW}


def _profile(lead_type=LeadType.SALES, *facts):
    return build_profile(lead_type, list(facts), now=NOW)


def _offer(profile, attempt_before=0, objection=None):
    visit = VisitState(attempts=attempt_before, angles_used=["primary_interest"] * attempt_before,
                       declined=attempt_before > 0, declined_turn=0)
    return plan_visit(profile=profile, extraction={"visit_objection": objection} if objection else {},
                      conversation=ConversationState(turn=10, visit=visit if attempt_before else None),
                      active_booking=None, built_times=TIMES, booked_this_turn=False, now=NOW)


# --- Item 2: the customer's own objective is the reason for the visit ----------------------------

def test_payment_target_becomes_the_reason_for_the_visit():
    # credit-1 C7: "I'd want to keep it under 400 a month" -> "Thanks, Denise. I've made a note of that."
    profile = _profile(LeadType.SALES, _fact("interest.model", "Toyota RAV4"), _fact("interest.monthly_payment", 400))
    for attempt_before in (0, 1, 2):
        plan = _offer(profile, attempt_before)
        assert plan.fire
        assert "$400-a-month target" in plan.value_proposition, (attempt_before, plan.value_proposition)


def test_trade_payoff_becomes_the_reason_and_objection_keeps_it():
    profile = _profile(LeadType.TRADE_IN, _fact("trade_in.model", "Honda Accord"), _fact("trade_in.payoff", "9000"))
    assert customer_objective(profile) == ("so the team can look at your Honda Accord in person and see where your "
                                           "$9,000 payoff leaves you")
    plan = _offer(profile, 1, objection="time_convenience")
    assert plan.value_proposition.startswith("we can work around your schedule, so the team can look at your Honda")


def test_no_canned_availability_or_duration_claims_in_any_reason():
    # The canned "while it's still available" made the guard reject every draft that used it (credit-1 C7, C11,
    # C13), so the template "I've made a note of that" went out instead of the offer.
    profile = _profile(LeadType.SALES, _fact("interest.model", "Toyota RAV4"))
    for attempt_before in (0, 1, 2):
        reason = _offer(profile, attempt_before).value_proposition
        assert "available" not in reason and "minutes" not in reason and "quick" not in reason, reason


def test_a_reason_built_from_their_numbers_passes_the_guard():
    profile = _profile(LeadType.SALES, _fact("interest.model", "Toyota RAV4"), _fact("interest.monthly_payment", 400))
    reason = _offer(profile, 2).value_proposition
    draft = {"sms_text": f"Would Saturday at 10:00 AM work to come in, {reason}?",
             "email_subject": "Visit", "email_body": f"Would Saturday at 10:00 AM work, {reason}?"}
    result = check_draft(draft, customer_texts=["I'd want to keep it under 400 a month"],
                         known_values=["Saturday at 10:00 AM", reason])
    assert result["passed"], result["violations"]


# --- Item 9: invented facts in words (real replies from the audit-4 transcripts) -----------------------

def _guard(sms, customer=("hi",)):
    return check_draft({"sms_text": sms, "email_subject": "Re", "email_body": sms}, customer_texts=list(customer),
                       known_values=[])


import pytest


@pytest.mark.parametrize("reply", [
    "It usually takes about an hour to an hour and a half.",                      # service-1 C6
    "Most take about one to three hours, and the team can confirm when you come in, Gary",  # service-3 C5 (no hedge
    # on the duration: the hedge is about another thing in a following sentence)
    "We try to prequalify with a soft pull first so your score doesn't change.",  # credit-1 C9
    "No, you don't need to bring the title.",                                     # trade-1 C14
    "If you want financing, bring proof of income (pay stubs or bank statements) and your social security number.",
    "We don't share prices over text.",                                           # credit-2 C4
    "The appraisal is free and there's no cost to you.",                          # HANDOFF known gap 1
    "Yes — the team will confirm whether that specific vehicle has AWD.",          # general-1 C3
])
def test_invented_word_claims_are_rejected(reply):
    result = _guard(reply)
    assert not result["passed"] and not result["checks"]["no_invented_word_claims"], reply


@pytest.mark.parametrize("reply", [
    "The team will confirm whether that specific vehicle has AWD.",
    "The team will confirm whether they run a soft pull or a hard pull before anything is done.",
    "The team can tell you how long it takes when you book.",
    "Would Saturday at 10:00 AM work to come by?",
    "There's no obligation - coming by just lets you see it in person.",
])
def test_safe_wording_passes(reply):
    assert _guard(reply)["checks"]["no_invented_word_claims"], reply


def test_a_duration_the_customer_gave_may_be_repeated():
    assert _guard("We'll keep it under an hour.", customer=["I only have an hour"])["checks"]["no_invented_word_claims"]
