"""PLAN_4 stream X1 item 9 (TCPA PDF §10): the AI may never state or infer consent or eligibility. Compose is told
so, and the guard rejects a draft that says it."""

import pytest

from upsell_agent.agent.llm import COMPOSE_INSTRUCTIONS
from upsell_agent.guardrails.draft_guard import check_draft


def _draft(sms: str) -> dict:
    return {"sms_text": sms, "email_subject": "Your inquiry", "email_body": sms}


@pytest.mark.parametrize("sms", [
    "Since you opted in to our updates, here are this week's specials.",
    "You signed up for texts from us, so here's a quick note.",
    "You're subscribed to our alerts.",
    "You consented to receive messages from Demo Motors.",
    "You gave us permission to text you about your trade.",
    "Per your opt-in, we're reaching out about the CR-V.",
    "Good news: you're eligible for our loyalty pricing.",
    "You qualify for the trade-in bonus.",
    "You're not on any do-not-call list, so we can keep in touch.",
    "We're allowed to text you about service reminders.",
    "As an existing customer relationship we wanted to check in.",
    "We have your consent to send updates.",
])
def test_a_draft_that_states_consent_or_eligibility_is_rejected(sms):
    result = check_draft(_draft(sms), customer_texts=[], known_values=[])
    assert result["checks"]["no_consent_claims"] is False and not result["passed"]
    assert any("consent or eligibility" in v for v in result["violations"])


@pytest.mark.parametrize("sms", [
    "Thanks for reaching out, Maria! The CR-V is still here. Want to come see it Saturday?",
    "Reply STOP to opt out.",
    "Happy to help you sign up for a test drive slot.",
    "The 2022 RAV4 qualifies for the certified pre-owned warranty per the listing.",
])
def test_ordinary_drafts_pass_the_consent_check(sms):
    assert check_draft(_draft(sms), customer_texts=[], known_values=["2022"])["checks"]["no_consent_claims"]


def test_compose_is_told_never_to_state_consent_or_eligibility():
    assert "Never state or suggest that the customer consented" in COMPOSE_INSTRUCTIONS
    assert "eligible" in COMPOSE_INSTRUCTIONS and "do-not-call" in COMPOSE_INSTRUCTIONS
