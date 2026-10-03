"""Guard (architecture §7): nothing the AI wrote is sent until it passes
guardrails/draft_guard.py, including the grounding check on any vehicle it
named (MASTER_PLAN_3 Phase 4). One rewrite is allowed; a second failure sends
the safe template and flags the lead for a human.

Also checked here: every question Decide gave was answered (MASTER_PLAN_2
Phase 5), no version asks more than two questions (MASTER_PLAN_3 Bq,
counted as question marks), an after-hours "offer" carries its choice
question (MASTER_PLAN_3 B1: seen live, the real model sometimes dropped it),
a reply after the first one doesn't open with a fresh greeting (seen live, 1
Oct: "Hello, Test!" repeated mid-conversation), and booking wording matches
a real, current booking's status (MASTER_PLAN_3 B5 item 7, architecture §15
decision 60): never "booked"/"confirmed" for a merely-requested (pending)
visit, and never any of those words with no active booking on the lead at
all - "never claim a booking that doesn't exist" (B4's principle 4). And no
link unless the customer asked for one (MASTER_PLAN_4 F3)."""

import re
from typing import Any

from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.vehicle_media import wants_link
from upsell_agent.guardrails.draft_guard import SMS_MAX, TOUCH1_SMS_MAX, check_draft
from upsell_agent.guardrails.link_guard import disallowed_links
from upsell_agent.guardrails.plain_language import find_jargon
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.policy import MAX_ASKS_PER_MESSAGE

MAX_REWRITES = 1
# "Hello, Name!" / "Hi Name," at the very start of a reply.
_GREETING = re.compile(r"^\s*(hello|hi|hey)\b[\s,!]*\w*[\s,!]", re.IGNORECASE)


def known_from_sources(state: AgentState) -> list[str]:
    """Texts the reply may take numbers from besides the customer's own words
    (MASTER_PLAN_2 Phase 6): the dealer's own details (hours, street number,
    phone) and the customer's values in plain words ("$35,000", "Saturday,
    September 27")."""
    pack = state.context_pack or {}
    info = (pack.get("dealer") or {}).get("info") or {}
    texts = [info.get(k) for k in ("address", "phone", "website", "hours_summary")]
    texts += list((info.get("hours") or {}).values())
    texts += [s.get("display") for s in pack.get("profile") or []]
    return [t for t in texts if t]
ANSWERING_ACTIONS = {"answer", "clarify"}


def _key(text: str) -> str:
    return " ".join("".join(ch for ch in text.lower() if ch.isalnum() or ch.isspace()).split())


def unanswered_questions(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """Questions Decide told Compose to answer that the draft says it didn't
    (MASTER_PLAN_2 Phase 5): the draft goes back for one rewrite."""
    if decision.get("action") not in ANSWERING_ACTIONS:
        return []
    answered = {_key(q) for q in draft.get("answered_questions") or []}
    return [q["text"] for q in decision.get("answer_questions") or [] if _key(q["text"]) not in answered]


def too_many_questions(draft: dict[str, Any]) -> list[str]:
    """Versions of the draft that ask more than MAX_ASKS_PER_MESSAGE questions."""
    return [f"the {name} asks {count} questions (at most {MAX_ASKS_PER_MESSAGE})"
            for name, key in (("SMS", "sms_text"), ("email", "email_body"))
            if (count := str(draft.get(key) or "").count("?")) > MAX_ASKS_PER_MESSAGE]


def repeats_greeting(conversation_turn: int, draft: dict[str, Any]) -> list[str]:
    """The SMS of a reply that isn't the first one shouldn't open with a fresh
    greeting (seen live, 1 Oct: repeated after an after-hours re-offer). Email
    keeps its salutation every time, like any email thread."""
    if conversation_turn <= 0 or not _GREETING.match(str(draft.get("sms_text") or "")):
        return []
    return ["the SMS greets the customer again (this isn't the first reply)"]


def missing_after_hours_choice(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """An "offer" (MASTER_PLAN_3 B1) must end with the "now or when we open?"
    choice; seen live (1 Oct) dropping it for a plain closing line instead."""
    if ((decision.get("after_hours") or {}).get("mode")) != "offer":
        return []
    return [f"the {name} doesn't offer the after-hours choice" for name, key in
            (("SMS", "sms_text"), ("email", "email_body"))
            if "which would you like" not in str(draft.get(key) or "").lower()]


_CONFIRMED_WORDING = re.compile(r"\b(booked|confirmed|see you (?:on|at|then))\b", re.IGNORECASE)
_REQUESTED_WORDING = re.compile(r"\brequested\b", re.IGNORECASE)


def invalid_booking_wording(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """MASTER_PLAN_3 B5 item 7, architecture §15 decision 60: booking words
    are allowed only when the lead has a real, active booking (read fresh
    this turn, agent/nodes/decide.py), and must match its actual status -
    "requested" while pending, "booked"/"confirmed" only once confirmed."""
    visit = decision.get("visit") or {}
    status = visit.get("status")
    active = status in ("pending", "confirmed")
    violations = []
    for name, key in (("SMS", "sms_text"), ("email", "email_body")):
        text = str(draft.get(key) or "")
        confirmed_words, requested_words = _CONFIRMED_WORDING.search(text), _REQUESTED_WORDING.search(text)
        if not (confirmed_words or requested_words):
            continue
        if not active:
            violations.append(f"the {name} claims a booking, but there's no active booking on this lead")
        elif confirmed_words and status != "confirmed":
            violations.append(f"the {name} says the visit is booked/confirmed, but it's only {status}")
    return violations


async def guard(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    if state.fallback_reason:  # Compose failed: nothing to check
        result = {"passed": False, "checks": {}, "violations": [state.fallback_reason], "next": "fallback"}
        span.output = result
        span.reasoning = [f"No draft ({state.fallback_reason}); using the template."]
        span.edge_label = "fallback"
        return {"guard_result": result}

    pack = state.context_pack or {}
    customer_texts = [state.customer_text or state.inbound_text] + [
        m["text"] for m in pack.get("working_memory", []) if m["direction"] == "inbound"]
    known = [s["value"] for s in (state.profile or {}).get("slots", []) if s.get("value") is not None]
    if state.campaign:
        # The dealer wrote the campaign: its name and offer may be repeated.
        known += [state.campaign.get(k) for k in ("name", "goal", "subject", "body")]
    known += known_from_sources(state)
    if (state.decision or {}).get("quiet_hours"):
        # The send check's own resume time (decision 29): "the team will pick this up at 8:00 AM".
        known.append("8:00 AM")
    if opens := ((state.decision or {}).get("after_hours") or {}).get("opens_at"):
        # When the dealership opens again (MASTER_PLAN_3 B1), from its own hours.
        known.append(opens)
    if visit_offer := (state.decision or {}).get("visit_offer"):
        # The times just offered (MASTER_PLAN_3 B4), built from real availability, not invented.
        known += [t.get("display") for t in visit_offer.get("times") or []]
    visit = (state.decision or {}).get("visit") or {}
    # The booking's own time, or the picked time that was just taken (MASTER_PLAN_3 B5), both real.
    known += [visit[k] for k in ("display", "slot_taken") if visit.get(k)]
    # The day the customer asked for, and the day offered instead when it had no open time (both real).
    known += [v for k in ("asked", "offered_day") if (v := (visit.get("day_request") or {}).get(k))]
    if next_action := (state.decision or {}).get("next_action"):
        # The date the customer asked us to get back to them (MASTER_PLAN_3 C3), worked out in code from
        # their own words (slots/dates.py), and its time: confirmed back to them, never invented.
        known += [next_action.get("display"), next_action.get("date"), next_action.get("time")]
    inventory = pack.get("inventory") or []
    draft = state.draft or {}
    # check_draft itself allows a mentioned vehicle's own year/miles and does
    # the vin/trim/make grounding check (MASTER_PLAN_3 Phase 3 decision C, Phase 4).
    result = check_draft(state.draft, customer_texts=customer_texts, known_values=known, inventory=inventory,
                         sms_max=TOUCH1_SMS_MAX if (state.decision or {}).get("touch1") else SMS_MAX)
    jargon = find_jargon(f"{draft.get('sms_text', '')}\n{draft.get('email_subject', '')}\n{draft.get('email_body', '')}")
    result["checks"]["plain_language"] = not jargon
    if jargon:
        result["passed"] = False
        result["violations"].append("internal terms a customer wouldn't understand: " + ", ".join(jargon))
    unanswered = unanswered_questions(state.decision or {}, state.draft or {})
    result["checks"]["answers_the_questions"] = not unanswered
    if unanswered:
        result["passed"] = False
        result["violations"].append("didn't answer: " + "; ".join(unanswered))
    too_many = too_many_questions(state.draft or {})
    result["checks"]["at_most_two_questions"] = not too_many
    if too_many:
        result["passed"] = False
        result["violations"] += too_many
    missing_choice = missing_after_hours_choice(state.decision or {}, state.draft or {})
    result["checks"]["after_hours_choice_offered"] = not missing_choice
    if missing_choice:
        result["passed"] = False
        result["violations"] += missing_choice
    # The after-hours morning message is meant to open with a fresh greeting
    # ("Good morning, the team is in now") whatever the turn (MASTER_PLAN_3 B1
    # decision 95): exempt from the no-repeated-greeting check.
    is_resume = ((state.decision or {}).get("after_hours") or {}).get("mode") == "resume"
    conversation_turn = 0 if is_resume else ((state.context_pack or {}).get("conversation") or {}).get("turn", 0)
    greeted_again = repeats_greeting(conversation_turn, state.draft or {})
    result["checks"]["no_repeated_greeting"] = not greeted_again
    if greeted_again:
        result["passed"] = False
        result["violations"] += greeted_again
    bad_booking_wording = invalid_booking_wording(state.decision or {}, state.draft or {})
    result["checks"]["booking_wording_matches_status"] = not bad_booking_wording
    if bad_booking_wording:
        result["passed"] = False
        result["violations"] += bad_booking_wording
    # MASTER_PLAN_4 F3: the photo, not the link - a link only when the customer asked, and only to a named
    # vehicle's own page (guardrails/link_guard.py).
    bad_links = disallowed_links(state.draft, inventory=inventory, link_requested=wants_link(state.extraction),
                                 allowed=[((pack.get("dealer") or {}).get("info") or {}).get("website")])
    result["checks"]["no_link_unless_asked"] = not bad_links
    if bad_links:
        result["passed"] = False
        result["violations"] += bad_links
    will_retry = not result["passed"] and state.retry_count < MAX_REWRITES
    result["next"] = "send" if result["passed"] else ("compose" if will_retry else "fallback")

    span.output = result
    span.reasoning = [f"{'✓' if ok else '✗'} {name.replace('_', ' ')}" for name, ok in result["checks"].items()]
    if result["violations"]:
        span.reasoning.append("Problems: " + "; ".join(result["violations"]))
    if not result["passed"]:
        span.reasoning.append("One rewrite allowed." if will_retry
                              else "Second failure: sending the template and flagging the lead for a human.")
    span.edge_label = "approved" if result["passed"] else ("rewrite" if will_retry else "fallback")

    if will_retry:
        await ctx.tracer.retry("guard", "compose", reason="; ".join(result["violations"]),
                               attempt=state.retry_count + 1)
        return {"guard_result": result, "retry_count": state.retry_count + 1}
    if not result["passed"]:
        return {"guard_result": result, "fallback_reason": "guard rejected the draft twice", "flag_human": True}
    return {"guard_result": result}
