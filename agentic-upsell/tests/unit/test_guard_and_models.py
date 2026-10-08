"""The draft guard (never invent numbers / approvals / availability, channel
format) and the offline model's extraction rules (MASTER_PLAN_1 Stage 8)."""

import pytest

from upsell_agent.agent.offline_model import compose, extract
from upsell_agent.guardrails.draft_guard import check_draft

GOOD = {"sms_text": "Thanks! Which model do you have in mind?", "email_subject": "Your inquiry",
        "email_body": "Hi Maria,\n\nWhich model do you have in mind?\n\nThanks"}


def _guard(draft, texts=(), known=()):
    return check_draft(draft, customer_texts=list(texts), known_values=list(known))


def test_a_plain_question_passes():
    result = _guard(GOOD)
    assert result["passed"] and result["violations"] == []


@pytest.mark.parametrize(("sms", "problem"), [
    ("We can offer $500 off today!", "numbers the customer never gave us"),
    ("Your trade is worth 12,000.", "numbers the customer never gave us"),
    ("Good news - you're approved!", "approval or guarantee language"),
    ("That price is guaranteed.", "approval or guarantee language"),
    ("The RAV4 is in stock and ready.", "claims a vehicle is available / in stock"),
    ("x" * 321, "SMS must be"),
    ("", "SMS must be"),
])
def test_bad_drafts_are_caught(sms, problem):
    result = _guard({**GOOD, "sms_text": sms})
    assert not result["passed"]
    assert any(problem in v for v in result["violations"])


def test_numbers_the_customer_gave_are_allowed():
    draft = {**GOOD, "sms_text": "Got it - a budget of $35,000 and a 2019 Civic with 60,000 miles."}
    assert _guard(draft, texts=["My budget is $35k", "about 60k miles"], known=[2019])["passed"]
    assert not _guard(draft, texts=["My budget is $35k"])["passed"]


def test_email_needs_subject_and_body():
    assert not _guard({**GOOD, "email_subject": ""})["passed"]
    assert not _guard(None)["passed"]


SLOTS = [{"path": p} for p in (
    "interest.new_or_used", "interest.model", "interest.budget", "interest.monthly_payment", "interest.timeline",
    "interest.service_needed", "interest.lead_type", "trade_in.has_trade", "trade_in.year", "trade_in.make",
    "trade_in.model", "trade_in.mileage", "trade_in.condition", "trade_in.payoff", "vehicle.year", "vehicle.make",
    "vehicle.model", "vehicle.mileage", "contact.best_time")]


def _extract(text, lead_type="sales"):
    result = extract({"customer_text": text, "lead_type": lead_type, "allowed_slots": SLOTS})
    return {v["path"]: v["value"] for v in result["values"]}, result


@pytest.mark.parametrize(("text", "lead_type", "expected"), [
    ("I want a new Toyota RAV4", "sales", {"interest.new_or_used": "new", "interest.model": "Toyota RAV4"}),
    ("Budget around $30k, looking to buy this month", "sales", {"interest.budget": 30000,
                                                                "interest.timeline": "this_month"}),
    ("I can do $450 a month", "sales", {"interest.monthly_payment": 450}),
    ("No trade-in", "sales", {"trade_in.has_trade": False}),
    ("I'd trade my 2018 Jeep Wrangler, 71k miles, fair condition, it's paid off", "sales",
     {"trade_in.has_trade": True, "trade_in.year": 2018, "trade_in.make": "Jeep", "trade_in.model": "Wrangler",
      "trade_in.mileage": 71000, "trade_in.condition": "fair", "trade_in.payoff": 0}),
    ("2020 Subaru Outback, 54,000 miles, needs brakes, mornings are best", "service",
     {"vehicle.year": 2020, "vehicle.make": "Subaru", "vehicle.model": "Outback", "vehicle.mileage": 54000,
      "interest.service_needed": "brakes", "contact.best_time": "morning"}),
    ("I want to book service", "general", {"interest.lead_type": "service"}),
])
def test_offline_extraction(text, lead_type, expected):
    values, _ = _extract(text, lead_type)
    assert values == expected


def test_offline_extraction_quotes_come_from_the_text_and_hedges_lower_confidence():
    _, result = _extract("It's a 2019 Civic with about 60,000 miles", "trade_in")
    for value in result["values"]:
        assert value["quote"].lower() in "it's a 2019 civic with about 60,000 miles"
    mileage = next(v for v in result["values"] if v["path"] == "trade_in.mileage")
    assert mileage["confidence"] < 0.7


def test_offline_extraction_flags_people_and_questions():
    _, result = _extract("This is ridiculous. Can a manager call me? Is it AWD?")
    assert result["wants_human"] and result["upset"] and result["upset_confidence"] >= 0.8
    assert not result["annoyed_at_bot"]
    assert result["questions"] == [{"text": "Can a manager call me?", "label": "answerable"},
                                   {"text": "Is it AWD?", "label": "answerable"}]


def test_offline_compose_asks_only_what_decide_chose_and_fits_sms():
    draft = compose({"action": "ask", "asks": [{"label": "Budget", "question": "Roughly how much would you like to spend?",
                                                "explanation": "A rough price helps us show you vehicles that fit."}],
                     "customer_first_name": "Maria", "customer_text": "hi"})
    assert draft["sms_text"] == "Thanks! Roughly how much would you like to spend?" and len(draft["sms_text"]) <= 320
    older = compose({"action": "ask", "asks": [{"label": "Budget", "hint": "roughly what budget you're working with"}],
                     "customer_first_name": "Maria", "customer_text": "hi"})
    assert "budget" in older["sms_text"]
    assert draft["email_body"].startswith("Hi Maria,")
    assert _guard(draft)["passed"]


# --- Burst test findings (Stage 12) -----------------------------------------------------

@pytest.mark.parametrize("sms", [
    "Thanks for replying to our spring RAV4 event!",
    "The CX-5, the F-150 and the 4Runner are all worth a look.",
    "See you at your 2nd visit.",
])
def test_model_names_with_digits_are_not_numbers(sms):
    assert _guard({**GOOD, "sms_text": sms})["passed"]


def test_thousands_shorthand_matches_the_full_number_both_ways():
    said_k = ["My budget is $30k, it has about 60k miles"]
    assert _guard({**GOOD, "sms_text": "A $30,000 budget and 60,000 miles - got it."}, texts=said_k)["passed"]
    said_full = ["budget is $30,000"]
    assert _guard({**GOOD, "sms_text": "Got it, $30k."}, texts=said_full)["passed"]


def test_a_shorter_number_is_not_allowed_just_because_it_prefixes_a_given_one():
    # The old normalizer stripped trailing zeros, so $30,000 made $3 "known".
    result = _guard({**GOOD, "sms_text": "We can take $3 off."}, texts=["budget is $30,000"])
    assert not result["passed"] and "$3" in result["violations"][0]


def test_campaign_text_numbers_are_allowed_when_passed_as_known():
    draft = {**GOOD, "sms_text": "Our 20% off maintenance offer runs this month!"}
    assert not _guard(draft)["passed"]
    assert _guard(draft, known=["20% off all maintenance this month"])["passed"]


@pytest.mark.parametrize(("sms", "passes"), [
    ("Happy birthday, Maria! Hope it's a great day.", True),
    ("Happy 40th birthday, Maria!", False),
    ("Since you were born in 1985, here's a deal", False),
])
def test_never_a_birth_year_or_age(sms, passes):
    """Client, 8 Oct 2026: "we don't need to discuss birth year ever"."""
    draft = {"sms_text": sms, "email_subject": "Hi", "email_body": sms}
    result = check_draft(draft, customer_texts=[], known_values=["40", "1985"])
    assert result["checks"]["no_birth_year"] is passes
