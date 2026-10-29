"""The lead brief: the whole picture of this lead, in one short page, for the writer (agent/nodes/compose.py).

Code decides every turn (Decide's rules, the compliance engine, the client's scripts); the model only writes. It wrote
well only when it understood the situation, and it was handed dozens of separate fields instead - so it wrote
"robotic" replies (client, 13 Oct 2026 - Betsy: "it's not speaking naturally like I would talk ... extremely
robotic"). The brief tells it, in plain words: who this customer is and how they came to us, where the lead stands,
what we know and still need, what has happened so far, why code chose this message and what this one message is
for. Nothing here decides anything; it is read-only context built from what the turn already has.
"""

from typing import Any

from upsell_agent import clock

# What each action is for - the one goal the writer is writing toward.
# Client, 16 Oct 2026 (Betsy: "the AI is not appointment centric at all ... all agents need to be appointment
# oriented"): every goal ends with the visit.
_GOALS = {
    "answer": "Answer their question fully and naturally, then take the next step: present visit_offer's times when "
              "given, otherwise one qualifying question.",
    "ask": "Get the one detail we still need - asked the way a person would, saying how it helps them (it qualifies "
           "the lead for the visit).",
    "confirm": "Check one thing they said, lightly, then take the next step.",
    "clarify": "Explain what our last question meant, simply, and ask it again.",
    "offer_visit": "Get them to pick one of the offered times. Give them a real reason to come in, from what they told us.",
    "acknowledge": "Reply warmly and briefly, then take the next step: one qualifying question, or the visit if they "
                   "sound ready.",
    "qualified": "Thank them and lock in the next step (the visit).",
    "partly_qualified": "Thank them and ask for the visit - what day works best?",
    "handoff": "Tell them, warmly, how a person will reach them.",
    "offer_human": "Offer a call or a text from a person.",
    "ask_why": "Gently find out what changed for them - one question.",
    "stop": "Nothing to write.",
}



# AI Studio > Status rules > Email subject lines (Betsy, 28 Oct 2026 meeting: "I can give you some subject lines that are
# really strong for getting opens"; the user: "a categorization of subject lines - if this customer has this intent, use
# this sort of subject line, but be creative"). Betsy's list replaces these in AI Studio.
SUBJECT_IDEAS: dict[str, list[str]] = {
    "sales": ["{first_name}, the {vehicle} you asked about", "Still thinking about the {vehicle}?",
              "A quick question about the {vehicle}"],
    "trade": ["What your {trade} could be worth", "A number for your trade-in", "Trading in your {trade}?"],
    "credit": ["Your financing options for the {vehicle}", "Getting you approved, step by step",
               "Payments that work for you"],
    "price_payment": ["Making the {vehicle} fit your budget", "Your payment options on the {vehicle}",
                      "The numbers on the {vehicle}"],
    "service": ["Your {vehicle}'s service", "Time for a service visit?", "Booking your service"],
    "general": ["Following up on your inquiry", "A quick question for you", "{first_name}, we're here to help"],
}
SUBJECT_RULE = ("Write a short, specific subject (under 50 characters) in this style, with this customer's car or "
                "name - never copy an example word for word, never all caps or clickbait.")

def _clean(text) -> str:
    from upsell_agent.agent.portal_text import clean_comments
    return clean_comments(text)


def _first(items: list[Any] | None) -> Any:
    return items[0] if items else None


def _said(message: dict[str, Any] | None) -> str | None:
    text = str((message or {}).get("text") or "").strip()
    return text[:240] if text else None


def build(*, decision: dict[str, Any], pack: dict[str, Any], lead: dict[str, Any] | None,
          lead_state: dict[str, Any] | None, customer_text: str | None, trigger: str | None) -> dict[str, Any]:
    lead, lead_state, pack = lead or {}, lead_state or {}, pack or {}
    data = lead.get("data") or {}
    memory = pack.get("working_memory") or []
    ours = [m for m in memory if m.get("direction") == "outbound"]
    theirs = [m for m in memory if m.get("direction") == "inbound"]
    stock = pack.get("stock_search") or {}
    inventory = pack.get("inventory") or []
    visit = decision.get("visit") or {}
    bucket = decision.get("bucket") or {}
    touch = decision.get("touch") or {}
    known = [f"{k.get('label')}: {k.get('value')}" for k in (pack.get("about_customer") or {}).get("known", [])]
    started = lead_state.get("opportunity_created_at") or lead_state.get("created_at")
    day = None
    try:
        if started:
            from upsell_agent.agent.lifecycle import _aware
            day = max(1, (clock.now() - _aware(started)).days + 1)
    except Exception:  # noqa: BLE001 - a brief is never worth a failed reply
        day = None
    fired = [r for r in decision.get("rules") or [] if r.get("result") == "fired"]

    from upsell_agent.agent.multi_vehicle import vehicle_label
    from upsell_agent.agent.templates import known_first_name
    vehicle = vehicle_label(lead)
    # Client, 16 Oct 2026: "get the user's missing information - name, number, email - whatever is missing in our CRM".
    missing = [what for what, have in (
        ("their first name", known_first_name(lead.get("name"))),
        ("a phone number", str(lead.get("phone") or "").strip() not in ("", "N/A", "n/a")),
        ("an email address", "@" in str(lead.get("email") or "") and not str(lead.get("email")).lower().startswith(
            ("no-reply", "noreply", "do-not-reply", "donotreply")))) if not have]
    specialist = (decision.get("specialist") or {}).get("id")
    return {
        # Betsy, 28 Oct 2026 meeting: email subject lines that get opened, by what the customer is after. Examples of the
        # style only - each subject is written fresh for this customer and car (AI Studio: Email subject lines).
        "email_subject": {"style_examples": SUBJECT_IDEAS.get(specialist) or SUBJECT_IDEAS.get("general") or [],
                          "rule": SUBJECT_RULE},
        "customer": {
            "came_from": lead.get("source") or lead.get("lead_source"),
            "bucket": bucket.get("bucket") or bucket.get("name"),
            "why_they_reached_out": bucket.get("intent"),
            "what_the_lead_form_said": (_clean(data.get("comments") or lead.get("comments"))[:400] or None),
            "vehicle_they_want": vehicle,
            "known_about_them": known[:12],
            "missing_contact": missing,
        },
        "where_it_stands": {
            "stage": lead_state.get("stage_label") or lead_state.get("stage"),
            "opportunity_day": f"Day {day} of 91" if day else None,
            "appointment": visit.get("display") if visit.get("status") in ("pending", "confirmed") else None,
            "offers_declined": (visit.get("attempts") if visit.get("declined") else None),
            "this_message_is": ("our first message to them" if trigger == "lead_created" and not ours
                                else f"a scheduled follow-up: {touch.get('label')}" if touch
                                else "a reply to their message" if trigger in ("inbound_message", "resume_at_opening")
                                else trigger),
        },
        "conversation_so_far": {
            "messages": len(memory),
            "our_last_message": _said(_first(list(reversed(ours)))),
            "their_last_message": customer_text or _said(_first(list(reversed(theirs)))),
        },
        "stock": {
            "exact_match": stock.get("exact") if stock else None,
            "vehicles_loaded": len(inventory),
            # 28 Oct 2026 meeting: a feature the customer asked about (all-wheel drive) is answered first.
            **({"feature_asked": stock["feature"]} if stock.get("feature") else {}),
        },
        "this_message": {
            "action": decision.get("action"),
            "why_code_chose_it": [r.get("why") for r in fired if r.get("why")][:3],
            "goal": _GOALS.get(str(decision.get("action")), "Move toward the appointment."),
        },
    }
