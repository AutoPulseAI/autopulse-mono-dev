"""PLAN_4 stream Q: conversation quality and over-escalation. Each test is a case seen in the real-model runs
(gpt-5-mini, evals/conversation_cost.py) - see docs/plans/PLAN_4/stream_Q.md."""

from datetime import UTC, datetime

from tests.unit.test_booking_tool import TUESDAY_NOON, _dealer
from tests.unit.test_slots import SALES_ALL, _fact, _profile
from upsell_agent.agent import cadence
from upsell_agent.agent.conversation import ConversationState, after_turn
from upsell_agent.agent.language import SPANISH, customer_language
from upsell_agent.agent.nodes.compose import place_touch1_intro
from upsell_agent.agent.nodes.decide import real_not_interested_reason, urgency
from upsell_agent.agent.nodes.validate import offer_not_payoff
from upsell_agent.agent.offline_model import _HUMAN
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.templates import render_continue_reply
from upsell_agent.guardrails.draft_guard import check_draft
from upsell_agent.guardrails.grammar import grammar_problems
from upsell_agent.guardrails.wording import (
    invented_names,
    repeated_vehicle_name,
    unverified_features,
    vin_in_text,
)
from upsell_agent.slots.policy import Flags, next_action
from upsell_agent.tools import booking_tool

RAV4 = {"vin": "DEV77104D87E42D2C", "year": 2022, "make": "Toyota", "model": "RAV4", "trim": "XLE",
        "body_type": "SUV", "exterior_color": "Blue", "miles": 31200}


# --- 1. Over-escalation ------------------------------------------------------------------------------

def _urgent(reason):
    return {"urgent": True, "urgent_confidence": 0.9, "urgent_reason": reason}


def test_buying_urgency_drives_the_appointment_not_a_handoff():
    # "hey yeah i need a truk for work asap" was handed off at turn 1.
    assert urgency(_urgent("needed_within_48h"), backstop=False) == ("buying", "needed_within_48h")
    assert urgency(_urgent("external_deadline"), backstop=False)[0] == "buying"
    assert urgency({}, backstop=True) == ("buying", "needed_within_48h")
    assert urgency({}, backstop=False) == (None, "none")


def test_a_genuine_problem_still_escalates():
    assert urgency(_urgent("safety_problem"), backstop=False)[0] == "escalate"
    assert urgency(_urgent("no_transportation"), backstop=True)[0] == "escalate"
    # Below the bar it's nothing at all.
    assert urgency({**_urgent("safety_problem"), "urgent_confidence": 0.5}, backstop=False)[0] is None


def test_mentioning_a_manager_is_not_asking_for_a_person():
    assert not _HUMAN.search("the manager promised me 20% off")
    assert not _HUMAN.search("your salesman said it had AWD")
    for asked in ("Can I talk to a person please?", "I want a manager", "can a manager call me",
                  "let me speak to the manager"):
        assert _HUMAN.search(asked), asked


def test_not_interested_restated_is_not_a_reason():
    # "not interested anymore" came back as its own reason, so the lead was handed off without the ask-why.
    for said in ("not interested anymore", "Not interested any more.", "I'm good", "no longer in the market",
                 "im not interested in it anymore", "nah"):
        assert real_not_interested_reason(said) is None, said
    assert real_not_interested_reason("found one cheaper somewhere else") == "found one cheaper somewhere else"


def test_a_time_with_no_day_answers_the_offered_times():
    dealer = _dealer()
    offered = booking_tool.format_offer(booking_tool.candidate_slots(dealer, TUESDAY_NOON)[:3], dealer)
    available = booking_tool.candidate_slots(dealer, TUESDAY_NOON)
    first = datetime.fromisoformat(offered[0]["iso"])
    later = first.replace(hour=first.hour + 1) if first.hour < 17 else first
    pick = booking_tool.match_pick(later.strftime("%-I%p").lower(), offered, dealer, TUESDAY_NOON, available=available)
    assert pick.matched and pick.matched["iso"] in {o["iso"] for o in offered} | {later.isoformat()}


def test_a_time_that_isnt_open_gets_the_nearest_open_times():
    dealer = _dealer()
    available = booking_tool.candidate_slots(dealer, TUESDAY_NOON)
    pick = booking_tool.match_pick("Wednesday after work, like 8pm?", [], dealer, TUESDAY_NOON, available=available)
    assert pick.matched is None and pick.wanted is not None
    near = booking_tool.nearest_times(available, pick.wanted, dealer)
    assert near and all(t.astimezone(dealer.tz).date() == pick.wanted.date() for t in near)
    assert near == sorted(near) and near[-1].astimezone(dealer.tz).hour == 18  # the last slot before 7 PM


def test_bare_times():
    assert booking_tool.bare_time("3pm").hour == 15
    assert booking_tool.bare_time("10 works").hour == 10
    assert booking_tool.bare_time("at 4:30").minute == 30
    for not_a_time in ("Same time works", "I have 3 kids", "I can put maybe 2000 down"):
        assert booking_tool.bare_time(not_a_time) is None


def test_a_double_guard_failure_hands_off_only_the_second_time_in_a_row():
    state = ConversationState()
    now = datetime(2026, 9, 22, tzinfo=UTC)
    common = {"now": now, "send_status": "sent", "shadow": False, "action": "answer", "asked_slots": [],
              "answered": [], "new_questions": [], "promises": []}
    state = after_turn(state, used_template=True, used_fallback=True, **common)
    assert state.fallbacks_in_a_row == 1
    assert after_turn(state, used_template=False, **common).fallbacks_in_a_row == 0


# --- 2. Repetition -------------------------------------------------------------------------------------

def test_a_value_is_asked_to_be_confirmed_once():
    pending = _fact("trade_in.has_trade", False, pending=True)
    first = next_action(_profile(LeadType.SALES, *SALES_ALL[:4], pending), Flags())
    assert first["action"] == "confirm" and first["confirm"]["fact_id"] == "f-trade_in.has_trade"
    again = next_action(_profile(LeadType.SALES, *SALES_ALL[:4], pending),
                        Flags(confirms={"f-trade_in.has_trade": 1}))
    assert "confirm" not in again and again["action"] != "confirm"
    assert all("trade_in.has_trade" not in a["slots"] for a in again["asks"])


def test_the_confirmation_is_counted_by_fact():
    now = datetime(2026, 9, 22, tzinfo=UTC)
    state = after_turn(ConversationState(), now=now, send_status="sent", shadow=False, action="confirm",
                       asked_slots=["trade_in.model"], answered=[], new_questions=[], used_template=False,
                       promises=[], confirmed_fact="fact-1")
    assert state.confirms == {"fact-1": 1}


# --- 3. Service leads -----------------------------------------------------------------------------------

def test_a_service_lead_gets_a_service_opening_and_no_sales_question():
    intro = cadence.touch1_intro(customer_first_name="Helen", agent_name=None, dealership="Sunrise Motors",
                                 city="Springfield", state_code="NJ", vehicle="2021 Toyota Camry", service=True)
    assert "purchase" not in intro and "service" in intro and "2021 Toyota Camry" in intro
    assert cadence.touch1_ending(False, service=True) is None
    assert cadence.touch1_ending(False) == "Tell me, what are you driving now?"


def test_touch1_intro_is_put_first_by_code():
    intro = ("Hello Ray, greetings from Sunrise Motors in Springfield, NJ. Thank you for getting in touch. "
             "I am excited to help you with your purchase.")
    draft = {"sms_text": intro + " We do offer financing.",
             "email_body": "Hello Ray,\n\nThanks for reaching out. We can help with financing.\n\nThanks,\nSunrise"}
    assert place_touch1_intro(draft, intro) == ["email"]
    assert draft["email_body"].startswith(intro + "\n\nWe can help with financing.")
    reworded = {"sms_text": "x", "email_body": "Hello Ray,\n\nGreetings from Sunrise Motors in Springfield, NJ. Thank "
                "you for getting in touch. I am excited to help you with your purchase. More."}
    place_touch1_intro(reworded, intro)
    assert reworded["email_body"] == intro + "\n\nMore." and reworded["email_body"].count("Greetings") == 0


# --- 4-6. Wording guards ---------------------------------------------------------------------------------

def test_no_vin_unless_asked():
    draft = {"sms_text": "We have a blue 2022 Toyota RAV4 XLE (VIN DEV77104D87E42D2C).", "email_body": ""}
    assert vin_in_text(draft, [RAV4], ["Is it still available?"])
    assert not vin_in_text(draft, [RAV4], ["What's the VIN?"])
    link = {"sms_text": "Here it is: https://dealer.example/v/DEV77104D87E42D2C", "email_body": ""}
    assert not vin_in_text(link, [RAV4], ["send me the link"])


def test_a_vehicle_is_named_once_per_sentence():
    clumsy = {"sms_text": "The 2022 Toyota RAV4 XLE we have is a 2022 Toyota RAV4 XLE, used, Blue, 31,200 miles.",
              "email_body": ""}
    assert repeated_vehicle_name(clumsy, [RAV4])
    assert not repeated_vehicle_name({"sms_text": "We have a blue 2022 Toyota RAV4 XLE with 31,200 miles.",
                                      "email_body": ""}, [RAV4])


def test_features_not_on_the_record_are_never_stated():
    assert unverified_features({"sms_text": "We have a few 3-row options. A 2022 Toyota RAV4 XLE is one.",
                                "email_body": ""}, [RAV4])
    assert unverified_features({"sms_text": "That RAV4 does not have AWD.", "email_body": ""}, [RAV4])
    assert not unverified_features({"sms_text": "The team will confirm whether the RAV4 has AWD.", "email_body": ""},
                                   [RAV4])
    assert not unverified_features({"sms_text": "Got it, you need a 3-row SUV.", "email_body": ""}, [RAV4])
    awd = {**RAV4, "trim": "XLE AWD"}
    assert not unverified_features({"sms_text": "That RAV4 XLE AWD is blue.", "email_body": ""}, [awd])


def test_no_invented_staff_names():
    draft = {"sms_text": "I'm with Sunrise Motors - Tyler, this is Alex from the sales team.", "email_body": ""}
    assert invented_names(draft, allowed=["Sunrise Motors", "Tyler Brooks"], customer_texts=["who is this?"])
    assert not invented_names(draft, allowed=["Sunrise Motors", "Alex", "Tyler Brooks"], customer_texts=[])
    plain = {"sms_text": "This is Sunrise Motors, Tyler. Thanks!", "email_body": ""}
    assert not invented_names(plain, allowed=["Sunrise Motors", "Tyler Brooks"], customer_texts=[])


def test_a_named_vehicles_own_year_and_the_customers_time_are_allowed_numbers():
    draft = {"sms_text": "That 2022 Toyota RAV4 XLE has 31,200 miles. I can hold 3:00 PM for you.",
             "email_subject": "s", "email_body": "b"}
    result = check_draft(draft, customer_texts=["What's the mileage on it?", "3pm"], known_values=[],
                         inventory=[RAV4])
    assert result["checks"]["no_invented_numbers"], result["violations"]


# --- 7. Misread values ------------------------------------------------------------------------------------

def test_someone_elses_offer_is_not_a_payoff():
    assert offer_not_payoff("trade_in.payoff", "Carvana offered me 24k")
    assert not offer_not_payoff("trade_in.payoff", "I still owe about 24k on it")
    assert not offer_not_payoff("trade_in.mileage", "Carvana offered me 24k")


# --- 8. The fallback keeps the context --------------------------------------------------------------------

def test_the_mid_conversation_fallback_follows_decide_not_the_first_reply():
    asks = [{"question": "When are you hoping to get your next vehicle?", "slots": ["interest.timeline"]}]
    asked = render_continue_reply("Jordan Price", {"asks": asks})
    assert asked["sms_text"] == "Thanks, Jordan. When are you hoping to get your next vehicle?"
    assert asked["asks"]["sms"] == ["interest.timeline"] and "new or" not in asked["sms_text"]
    checking = render_continue_reply("Jordan", {"answer_questions": [{"text": "How long will it take?"}]})
    assert "check on that with the team" in checking["sms_text"] and checking["promises"]
    assert render_continue_reply("Jordan", {})["sms_text"] == "Thanks, Jordan. I've made a note of that."


# --- 9. Language -------------------------------------------------------------------------------------------

def test_the_customers_language_is_detected():
    assert customer_language("Hola, ¿hablan español?") == SPANISH
    assert customer_language("Tengo un Nissan Altima 2016") == SPANISH
    assert customer_language("A las 11", ["Hola, ¿hablan español?"]) == SPANISH  # too short: earlier messages
    assert customer_language("Gracias", ["¿Puedo ir el sábado en la mañana?"]) == SPANISH
    assert customer_language("Is the 2021 Camry still there?") is None
    assert customer_language("ok", ["I want a used RAV4"]) is None


def test_a_spanish_fallback_is_in_spanish():
    reply = render_continue_reply("Luis", {"reply_language": SPANISH, "asks": [{"question": "x", "slots": ["a"]}]})
    assert reply["sms_text"] == "Gracias, Luis. Ya tomé nota." and reply["asks"]["sms"] == []


def test_the_grammar_rule_does_not_judge_spanish_by_english_rules():
    text = "¡Claro que sí, Luis! Se lo paso a ella y a usted le confirmamos la hora. ¿Le parece bien?"
    assert grammar_problems(text, needs_final_punctuation=True, english=False) == []
    assert grammar_problems("a ellos. Es todo.", english=False) == ['a sentence starts with a lowercase letter ("a")']
    assert grammar_problems("We have a SUV and an hour.", english=True) == []
    assert grammar_problems("i can help.", english=True) == ['"i" instead of "I"']


# --- Found in the first stream Q real run --------------------------------------------------------------------

def test_talking_about_the_recall_the_customer_raised_is_not_a_recall_claim():
    from upsell_agent.guardrails.service_claims import check_service_claims

    reply = "Thanks for letting us know about the recall letter. The team will check the recall for your Silverado."
    assert check_service_claims(reply, None, customer_said_recall=True) == []
    assert check_service_claims(reply, None)  # nobody mentioned one: still a claim
    assert check_service_claims("Your Silverado has an open recall.", None, customer_said_recall=True)


def test_a_time_typed_without_a_colon_allows_its_numbers():
    draft = {"sms_text": "Got it, I'll note 7:30 AM tomorrow.", "email_subject": "s", "email_body": "b"}
    assert check_draft(draft, customer_texts=["early like 730"], known_values=[])["checks"]["no_invented_numbers"]


def test_same_time_while_moving_a_booking_means_the_bookings_own_time():
    from upsell_agent.agent.nodes.decide import _same_time_as

    assert _same_time_as("Same time works", {"bookingTime": "15:00"}) == "3:00 pm"
    assert _same_time_as("Same time works", {"bookingTime": "09:30"}) == "9:30 am"
    assert _same_time_as("Friday at 4", {"bookingTime": "15:00"}) == "Friday at 4"
    assert _same_time_as("Same time works", None) == "Same time works"


def test_a_spanish_first_reply_fallback_is_in_spanish():
    reply = render_continue_reply("Luis Hernandez", {"reply_language": SPANISH}, first=True)
    assert reply["sms_text"].startswith("Hola Luis, gracias") and reply["email_body"].startswith("Hola Luis,\n\nGracias")


def test_two_different_vehicles_of_the_same_year_and_model_are_not_a_repeat():
    inv = [{"year": 2025, "model": "RAV4", "trim": "XLE Hybrid"}, {"year": 2025, "model": "RAV4", "trim": "LE"}]
    draft = {"sms_text": "I have a 2025 Toyota RAV4 XLE Hybrid in white and a 2025 Toyota RAV4 LE in silver.",
             "email_body": ""}
    assert repeated_vehicle_name(draft, inv) == []


def test_spanish_day_and_time_words_reach_the_booking_code():
    from upsell_agent.agent.language import dates_to_english

    assert dates_to_english("¿Puedo ir el sábado en la mañana?") == "¿Puedo ir el Saturday morning?"
    assert dates_to_english("A las 11") == "at 11"
    assert dates_to_english("Mañana a las 3:30") == "tomorrow at 3:30"
    assert booking_tool.preferred_day(dates_to_english("¿Puedo ir el sábado en la mañana?"), _dealer(),
                                      TUESDAY_NOON).part_words


def test_spanish_booking_words_need_a_real_booking():
    from upsell_agent.agent.nodes.guard import invalid_booking_wording

    draft = {"sms_text": "Perfecto, nos veremos a las 11:00.", "email_body": ""}
    assert invalid_booking_wording({"visit": {}}, draft)
    assert not invalid_booking_wording({"visit": {"status": "confirmed"}}, draft)
