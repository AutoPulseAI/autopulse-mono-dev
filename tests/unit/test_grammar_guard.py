"""The guard's mechanical grammar rule (MASTER_PLAN_4 stream G, guardrails/grammar.py): catches clear
mistakes, never flags what a careful writer sends, and never touches the client's fixed wording."""

import pytest

from upsell_agent.agent import appointment, cadence, sold_delivered, sold_pending, templates
from upsell_agent.agent.nodes.guard import mandated_wording
from upsell_agent.compliance.opt_out import NL_CONFIRMATION
from upsell_agent.guardrails.grammar import check_draft_grammar, grammar_problems

GOOD = [
    "Thanks, Maria! Are you looking for a new or a used vehicle?",
    "So we can work out what your car is worth, about how many miles are on it?",
    "We have a 2022 Toyota RAV4 XLE in silver with 18,400 miles. Would you like to see it on Saturday at 10:00 AM?",
    "Got it - Saturday, September 27. I've requested 10:00 AM, and the team will confirm shortly.",
    "It has 18\" alloy wheels and an 8-inch screen.",
    "An hour is all it takes, and an SUV like this one is a great fit for a family.",
    "A used car is a good option, and a one-time fee is not something we'd ever invent.",
    "We're open Mon-Fri, 9 a.m. to 6 p.m. Our website is sunrisemotors.com.",
    "You can see it here: https://example.com/vehicles/123",
    "I'm happy to help. I'll pass your notes to the service team.",
    "Sure. (The team will confirm the exact time.) Which day works best?",
    "Hi Maria,\n\nThanks for reaching out! The team will follow up shortly.\n\nThanks,\nThe Sunrise Motors Team",
    "That that question came up before is fine.",
    "An F-150 or a RAV4? Both are in stock.",
    "Is it available? Yes... and it's ready for a test drive.",
    # Real AI lines from the client's examples (docs/data/conversations.md).
    ("Hi John, this is Ava with ABC Toyota. I received your request regarding financing for the 2023 Toyota Camry. "
     "I can help you with that. Are you planning to use a vehicle as a trade-in?"),
    "Perfect. About how many miles are on the Altima, and do you still owe anything on it?",
    ("Great. I'll reserve 10:30 tomorrow for you. I'll note that you're bringing the 2018 Altima with "
     "approximately 82,000 miles and about a $9,000 payoff so the team is prepared to evaluate it with you."),
    "That's exactly why an in-person appraisal would be useful.",
    "Got it. And how would you describe the overall condition—any accidents, body damage or major mechanical issues?",
    ("Thank you. That helps us make sure we're looking at the appropriate maintenance for the vehicle's current "
     "mileage. Have you had the 60,000-mile maintenance performed yet?"),
    # Real gpt-5-mini replies (stream G measurement, 4 Oct 2026).
    ("Hi Maria. About how many miles are on your trade-in? It can be a rough number. Also, how would you describe "
     "its condition: excellent, good, fair, or poor? That helps us estimate its value for a trade-in."),
]

BAD = [
    ("thanks Maria! Are you looking for new or used?", "lowercase"),
    ("Thanks! are you looking for new or used?", "lowercase"),
    ("We have the the RAV4 in silver.", "doubled word"),
    ("Thanks , Maria! Which day works?", "space before"),
    ("Thanks Maria ! Which day works?", "space before"),
    ("We can help today.See you soon!", "no space after"),
    ("Hi,Maria. Which day works?", "comma"),
    ("Thanks, Maria! Which day works", "doesn't end"),
    ("Sure, i can check that for you.", '"i"'),
    ("Sure, i'm on it.", '"i"'),
    ("The team will confirm (it only takes a minute.", "parentheses"),
    ('You said "blue and we have one.', "quotation"),
    ("It takes a hour.", "an hour"),
    ("Would you like a oil change?", "an oil"),
    ("It's an used car.", "a used"),
    ("We have an car ready.", "a car"),
    ("Would you like a upgrade?", "an upgrade"),
]


@pytest.mark.parametrize("text", GOOD)
def test_good_writing_passes(text):
    assert grammar_problems(text, needs_final_punctuation="\n" not in text) == []


@pytest.mark.parametrize("text,problem", BAD)
def test_clear_mistakes_are_caught(text, problem):
    problems = grammar_problems(text, needs_final_punctuation=True)
    assert problems and any(problem in p for p in problems), problems


def test_the_clients_fixed_wording_is_exempt():
    # Touch 2 is literally "{FirstName}?", and the client's day-before text keeps its own commas.
    decision = {"touch": {"fixed_text": "maria?"}}
    assert check_draft_grammar({"sms_text": "maria?", "email_body": "maria?"}, exempt=mandated_wording(decision)) == []
    intro = "hello maria from the store."  # deliberately "wrong", to prove it's never checked
    decision = {"touch1": {"intro": intro, "ending": "Tell me, what are you driving now?"}}
    draft = {"sms_text": f"{intro} We have it in silver. Tell me, what are you driving now?",
             "email_body": f"{intro}\n\nWe have it in silver."}
    assert check_draft_grammar(draft, exempt=mandated_wording(decision)) == []
    # ...but what the AI wrote around it still is.
    bad = {"sms_text": f"{intro} we have it in silver. Tell me, what are you driving now?", "email_body": "Ok."}
    assert check_draft_grammar(bad, exempt=mandated_wording(decision))


def test_a_violation_names_the_version_and_the_problem():
    out = check_draft_grammar({"sms_text": "thanks!", "email_body": "Hi Maria,\n\nThanks for the the note."})
    assert out == ['grammar in the SMS: a sentence starts with a lowercase letter ("thanks")',
                   'grammar in the email: a doubled word ("the the")']


def _fixed_messages() -> list[str]:
    """Every fixed message the code sends without the AI (proofread in stream G)."""
    texts = []
    for lead_type in templates.FIRST_REPLY:
        rendered = templates.render_first_reply(lead_type, "Maria Lopez")
        texts += [rendered["sms_text"], rendered["email_body"]]
    for kind in templates.HOLDING_REPLIES:
        rendered = templates.render_holding_reply(kind, "Maria Lopez")
        texts += [rendered["sms_text"], rendered["email_body"]]
    texts += [templates.SOLD_VEHICLE_FALLBACK_TEXT, NL_CONFIRMATION]
    for touch in range(1, 8):
        rendered = sold_pending.render_touch(touch, first_name="Maria", dealership="Sunrise Motors",
                                             vehicle="2024 Toyota RAV4", documents=True)
        texts.append(rendered["sms_text"])
    texts += [sold_pending.escalation_reply("Maria"), sold_pending.info_received_reply("Maria")]
    vehicle = {"year": 2024, "make": "Toyota", "model": "RAV4"}
    texts.append(sold_delivered.render_checkin(first_name="Maria", dealership="Sunrise Motors", vehicle=vehicle,
                                               first_service=None, offer_service=True)["sms_text"])
    texts.append(sold_delivered.render_birthday(first_name="Maria", dealership="Sunrise Motors")["sms_text"])
    texts.append(sold_delivered.render_anniversary(first_name="Maria", dealership="Sunrise Motors",
                                                   vehicle=vehicle, year=2)["sms_text"])
    texts.append(cadence.touch1_intro(customer_first_name="Maria", agent_name=None, dealership="Sunrise Motors",
                                      city="Springfield", state_code="NJ", vehicle="2024 Toyota RAV4"))
    texts.append(appointment.reply_text("reschedule", customer_name="Maria Lopez", appt=None))
    texts.append(appointment.reply_text("clarify", customer_name="Maria Lopez", appt=None))
    return texts


@pytest.mark.parametrize("text", _fixed_messages())
def test_every_fixed_message_passes_the_grammar_rule(text):
    assert grammar_problems(text, needs_final_punctuation="\n" not in text) == []
