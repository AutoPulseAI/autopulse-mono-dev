"""Guard (architecture §7): nothing the AI wrote is sent until it passes
guardrails/draft_guard.py, including the grounding check on any vehicle it
named (MASTER_PLAN_3 Phase 4). One rewrite is allowed; a second failure sends
the safe template and flags the lead for a human.

Also checked here: every question Decide gave was answered (MASTER_PLAN_2
Phase 5), no version asks more than two questions (MASTER_PLAN_3 Bq,
counted as question marks), an after-hours "offer" carries its choice
question (MASTER_PLAN_3 B1: seen live, the real model sometimes dropped it),
a "later" (the reply when a customer chooses to wait for the team) and a
"resume" (the morning message once the team is in) each say so, rather than
a "later" reading like a response to a decline, or a "resume" opening cold
with the next question as if no time had passed (MASTER_PLAN_3 B1: both
seen live with a real model, 6 Oct 2026 - "tomorrow is fine" got "I won't
keep asking - I understand", and the next morning got a budget question
with no acknowledgment it was morning at all), a reply after the first one doesn't open with a fresh
greeting (seen live, 1 Oct: "Hello, Test!" repeated mid-conversation), and booking wording matches
a real, current booking's status (MASTER_PLAN_3 B5 item 7, architecture §15
decision 60): never "booked"/"confirmed" for a merely-requested (pending)
visit, and never any of those words with no active booking on the lead at
all - "never claim a booking that doesn't exist" (B4's principle 4). And no
link unless the customer asked for one (MASTER_PLAN_4 F3), and no mechanical
grammar mistake (MASTER_PLAN_4 stream G, guardrails/grammar.py)."""

import re
from typing import Any

from upsell_agent.agent import human_contact, service_request
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.language import message_language
from upsell_agent.agent.nodes.compose import just_captured
from upsell_agent.agent.state import AgentState
from upsell_agent.guardrails.draft_guard import SMS_MAX, TOUCH1_SMS_MAX, check_draft
from upsell_agent.guardrails.grammar import check_draft_grammar
from upsell_agent.guardrails.link_guard import disallowed_links
from upsell_agent.guardrails.plain_language import find_jargon
from upsell_agent.guardrails.wording import (
    invented_names,
    repeated_vehicle_name,
    unverified_features,
    vin_in_text,
)
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.policy import MAX_ASKS_PER_MESSAGE

MAX_REWRITES = 1
# PLAN_4 stream Q (client, 25 Sept: "The goal is not to escalate every customer ... allowing the lead to go cold"):
# a draft rejected twice sends the safe template; the lead goes to staff only when the previous reply was a
# template fallback too. Before, every double rejection handed off - in the stream E/Q runs that stopped the AI
# for most leads at their first or second message.
FALLBACKS_BEFORE_HANDOFF = 2
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


def _mask_links(text: Any, links: list[str]) -> Any:
    if not isinstance(text, str):
        return text
    for link in sorted(links, key=len, reverse=True):
        text = text.replace(link, "LINK")
    return text


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
    if decision.get("reply_language"):
        # Stream Q: translated, so its English words can't be checked; it is still a question.
        return [f"the {name} doesn't offer the after-hours choice" for name, key in
                (("SMS", "sms_text"), ("email", "email_body")) if "?" not in str(draft.get(key) or "")]
    return [f"the {name} doesn't offer the after-hours choice" for name, key in
            (("SMS", "sms_text"), ("email", "email_body"))
            if "which would you like" not in str(draft.get(key) or "").lower()]


# A resume message just needs to signal "we're available now" before it carries on - not literally "the team
# is in now" (agent/llm.py's instruction to Compose), since a real model's own close paraphrase is fine; only
# dropping the acknowledgment entirely (seen live, 6 Oct 2026: straight into a budget question) is the problem.
_RESUME_PHRASES = ("team is in", "we're open", "we are open", "we're back", "we are back", "open now", "back open")


def missing_resume_acknowledgment(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """A "resume" (MASTER_PLAN_3 B1) is the morning message after a customer chose to wait for the team; it
    must say so before doing anything else, not pick the conversation back up as if no time had passed."""
    if ((decision.get("after_hours") or {}).get("mode")) != "resume":
        return []
    if decision.get("reply_language"):
        # Stream Q: translated, so the English phrases above can't be checked here.
        return []
    return [f"the {name} doesn't say the team is in now before continuing" for name, key in
            (("SMS", "sms_text"), ("email", "email_body"))
            if not any(p in str(draft.get(key) or "").lower() for p in _RESUME_PHRASES)]


# "later" just needs to say the team will pick this up - not the literal instruction wording (agent/llm.py),
# a close paraphrase is fine; dropping it (seen live, 6 Oct 2026: "tomorrow is fine" got "I won't keep asking -
# I understand", as if the customer had asked to be left alone rather than chosen to wait) is the problem.
_LATER_PHRASES = ("pick this up", "pick it up", "when we open", "when the team opens", "team will", "team can",
                  "team is", "reach out", "follow up", "get back to you", "touch base")


def missing_later_acknowledgment(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """A "later" (MASTER_PLAN_3 B1) is the reply when the customer chose to wait for the team; it must say the
    team will pick this up, not read like a response to a decline or a request to stop asking."""
    if ((decision.get("after_hours") or {}).get("mode")) != "later":
        return []
    if decision.get("reply_language"):
        return []
    return [f"the {name} doesn't say the team will pick this up" for name, key in
            (("SMS", "sms_text"), ("email", "email_body"))
            if not any(p in str(draft.get(key) or "").lower() for p in _LATER_PHRASES)]


def mandated_wording(decision: dict[str, Any]) -> list[str]:
    """The client's exact wording in this draft (stream G): Touch 1's opening and closing and a touch's fixed
    text (Touch 2's "{FirstName}?"). Sent as written, so never grammar-checked."""
    touch1, touch = decision.get("touch1") or {}, decision.get("touch") or {}
    return [t for t in (touch1.get("intro"), touch1.get("ending"), touch.get("fixed_text")) if t]


def not_in_reply_language(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """Stream Q: a customer writing in Spanish gets a Spanish reply (seen: "Luis, Saturday morning works. I can
    offer Saturday at 9:00 AM ..." in the middle of a Spanish conversation). Touch 1's English intro is left out
    of the check."""
    language = decision.get("reply_language")
    if not language:
        return []
    intro = ((decision.get("touch1") or {}).get("intro") or "")
    return [f"the {name} isn't written in {language}, the customer's language" for name, key in
            (("SMS", "sms_text"), ("email", "email_body"))
            if message_language(str(draft.get(key) or "").replace(intro or "\0", " ")) == "English"]


def touch1_not_first(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """Touch 1 opens with the client's required intro, word for word (MASTER_PLAN_3 C4). Stream G saw
    gpt-5-mini put a "Hello Maria," salutation above it in the email, greeting the customer twice."""
    intro = ((decision.get("touch1") or {}).get("intro") or "").strip()
    if not intro:
        return []
    return [f"the {name} doesn't start with Touch 1's required opening" for name, key in
            (("SMS", "sms_text"), ("email", "email_body")) if not str(draft.get(key) or "").lstrip().startswith(intro)]


# Spanish too (stream Q, a reply in the customer's language): "nos vemos/veremos", "reservad@", "confirmad@",
# "agendad@" claim a booking; "solicitad@" is the requested wording.
_CONFIRMED_WORDING = re.compile(r"\b(booked|confirmed|see you (?:on|at|then)|nos (?:vemos|veremos)|(?:te|le|lo|la) esperamos|reservad[oa]s?|"
                                r"confirmad[oa]s?|agendad[oa]s?)\b", re.IGNORECASE)
_REQUESTED_WORDING = re.compile(r"\b(requested|solicitad[oa]s?)\b", re.IGNORECASE)


def invalid_booking_wording(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """MASTER_PLAN_3 B5 item 7, architecture §15 decision 60: booking words
    are allowed only when the lead has a real, active booking (read fresh
    this turn, agent/nodes/decide.py), and must match its actual status -
    "requested" while pending, "booked"/"confirmed" only once confirmed."""
    visit = decision.get("visit") or {}
    if visit.get("kind") == "service":
        # MASTER_PLAN_4 F2: service visits are requested, never booked - its own wording rule.
        return service_request.invalid_wording(visit, draft)
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
    # What Validate saved from this very message, in the plain words Compose was told to repeat back ("Got it -
    # Friday, September 25."): worked out in code from their words, not invented (stream Q: the context pack's
    # profile predates this turn's values, so a just-resolved date was rejected as an invented number).
    known += [c["display"] for c in just_captured(state) if c.get("display")]
    if (state.decision or {}).get("quiet_hours"):
        # The send check's own resume time (decision 29): "the team will pick this up at 8:00 AM".
        known.append("8:00 AM")
    if opens := ((state.decision or {}).get("after_hours") or {}).get("opens_at"):
        # When the dealership opens again (MASTER_PLAN_3 B1), from its own hours.
        known.append(opens)
    if visit_offer := (state.decision or {}).get("visit_offer"):
        # The times just offered (MASTER_PLAN_3 B4), built from real availability, not invented.
        known += [t.get("display") for t in visit_offer.get("times") or []]
        # PLAN_4 stream X3 item 2: the visit reason is built in code from the customer's own amounts.
        known.append(visit_offer.get("value_proposition"))
    visit = (state.decision or {}).get("visit") or {}
    # The booking's own time, or the picked time that was just taken (MASTER_PLAN_3 B5), both real.
    known += [visit[k] for k in ("display", "slot_taken", "time_not_open") if visit.get(k)]
    # Stream Q: the times our earlier reply offered (still on the table while they answer) and a service visit's
    # requested day - both real, but neither is in this turn's visit_offer, so the reply that mentioned them again
    # ("I have 2:00 PM or 3:00 PM Tuesday") was rejected as inventing numbers.
    earlier_visit = ((pack.get("conversation") or {}).get("visit") or {})
    known += [t.get("display") for t in earlier_visit.get("offered_times") or [] if t.get("display")]
    known += [v.get("display") for v in (earlier_visit.get("pending_pick"), earlier_visit.get("service_request"),
                                         visit.get("service_request")) if isinstance(v, dict) and v.get("display")]
    # The day the customer asked for, and the day offered instead when it had no open time (both real).
    known += [v for k in ("asked", "offered_day") if (v := (visit.get("day_request") or {}).get(k))]
    if next_action := (state.decision or {}).get("next_action"):
        # The date the customer asked us to get back to them (MASTER_PLAN_3 C3), worked out in code from
        # their own words (slots/dates.py), and its time: confirmed back to them, never invented.
        known += [next_action.get("display"), next_action.get("date"), next_action.get("time")]
    if person := human_contact.for_compose((state.decision or {}).get("human_contact")):
        # PLAN_4 stream H: the last 4 digits of the number on file, and when a person will call/text - all real.
        known += [person.get(k) for k in ("phone_last4", "call_when", "text_when") if person.get(k)]
    if referred := pack.get("referred_vehicle"):
        # PLAN_4 stream X3: the shown vehicle the customer refers back to, described from the fields it was shown
        # with (its year stays sayable even once it has sold and is no longer in this turn's stock).
        known += [referred.get("description"), *[o.get("description") for o in referred.get("ambiguous") or []]]
    inventory = pack.get("inventory") or []
    draft = state.draft or {}
    # check_draft itself allows a mentioned vehicle's own year/miles and does
    # the vin/trim/make grounding check (MASTER_PLAN_3 Phase 3 decision C, Phase 4).
    # The plan's own links were put in by code (agent/link_resolver.py): their digits aren't the AI's numbers.
    links = ((state.draft or {}).get("link_plan") or {}).get("urls") or []
    checked = {k: (_mask_links(v, links) if k in ("sms_text", "email_subject", "email_body") else v)
               for k, v in draft.items()} if links else state.draft
    result = check_draft(checked, customer_texts=customer_texts, known_values=known, inventory=inventory,
                         # Three segments for Touch 1, and for a reply in Spanish (stream Q: the same message runs
                         # about a fifth longer, and two over-length drafts handed a Spanish lead to staff).
                         sms_max=TOUCH1_SMS_MAX if (state.decision or {}).get("touch1") or (
                             state.decision or {}).get("reply_language") else SMS_MAX,
                         # MASTER_PLAN_4 D5/D6 (stream A4): a service outreach turn puts its event's facts here.
                         service_facts=(state.decision or {}).get("service_facts"))
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
    missing_resume = missing_resume_acknowledgment(state.decision or {}, state.draft or {})
    result["checks"]["resume_says_team_is_in"] = not missing_resume
    if missing_resume:
        result["passed"] = False
        result["violations"] += missing_resume
    missing_later = missing_later_acknowledgment(state.decision or {}, state.draft or {})
    result["checks"]["later_says_team_will_follow_up"] = not missing_later
    if missing_later:
        result["passed"] = False
        result["violations"] += missing_later
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
    # MASTER_PLAN_4 F3 / conversation_7: only the links this turn's plan allows (agent/link_resolver.py) - a
    # vehicle's own page, the homepage when they asked for it or weren't clear - and never an autopulse.ai one.
    bad_links = disallowed_links(state.draft, allowed=((state.draft or {}).get("link_plan") or {}).get("urls") or [],
                                 homepage=((pack.get("dealer") or {}).get("info") or {}).get("website"))
    result["checks"]["no_link_unless_asked"] = not bad_links
    if bad_links:
        result["passed"] = False
        result["violations"] += bad_links
    not_first = touch1_not_first(state.decision or {}, state.draft or {})
    result["checks"]["touch1_opening_first"] = not not_first
    if not_first:
        result["passed"] = False
        result["violations"] += not_first
    # PLAN_4 stream Q (guardrails/wording.py): no VIN unless asked, a vehicle named once per sentence, no
    # feature the stock record doesn't show, and no made-up person's name.
    dealer_layer = pack.get("dealer") or {}
    wording = {
        "no_vin_unless_asked": vin_in_text(draft, inventory, customer_texts),
        "vehicle_named_once": repeated_vehicle_name(draft, inventory),
        "features_grounded": unverified_features(draft, inventory),
        "no_invented_names": invented_names(
            draft, customer_texts=customer_texts,
            allowed=[t for t in (dealer_layer.get("name"), dealer_layer.get("agent_name"), state.customer_name) if t]),
    }
    if (getattr(ctx, "lead_state", None) or {}).get("stage") == "sold_pending":
        # PLAN_4 stream X2 (SOLD PENDING PDF §7, §12): an AI-written reply on a Sold Pending lead never blames the
        # customer for a delay nor states a document, date, approval or financing status (sold_pending.py) - checked
        # in code, not only asked of the model.
        from upsell_agent.agent.sold_pending import guardrail_problems
        sold = guardrail_problems(f"{draft.get('sms_text', '')}\n{draft.get('email_subject', '')}\n"
                                  f"{draft.get('email_body', '')}")
        wording["sold_pending_no_delay_or_invented_status"] = [
            "Sold Pending: implies a delay or states an unverified document / date / approval / financing status ("
            + ", ".join(sold) + ")"] if sold else []
    for check, problems in wording.items():
        result["checks"][check] = not problems
        if problems:
            result["passed"] = False
            result["violations"] += problems
    # MASTER_PLAN_4 stream G (client, 5 Oct 2026): mechanical grammar, with the client's fixed wording exempt.
    wrong_language = not_in_reply_language(state.decision or {}, draft)
    result["checks"]["reply_language"] = not wrong_language
    if wrong_language:
        result["passed"] = False
        result["violations"] += wrong_language
    bad_grammar = check_draft_grammar(state.draft, exempt=mandated_wording(state.decision or {}),
                                      english=not (state.decision or {}).get("reply_language"))
    result["checks"]["grammar"] = not bad_grammar
    if bad_grammar:
        result["passed"] = False
        result["violations"] += bad_grammar
    will_retry = not result["passed"] and state.retry_count < MAX_REWRITES
    result["next"] = "send" if result["passed"] else ("compose" if will_retry else "fallback")

    span.output = result
    span.reasoning = [f"{'✓' if ok else '✗'} {name.replace('_', ' ')}" for name, ok in result["checks"].items()]
    if result["violations"]:
        span.reasoning.append("Problems: " + "; ".join(result["violations"]))
    if not result["passed"]:
        span.reasoning.append("One rewrite allowed." if will_retry else "Second failure: sending the template.")
    span.edge_label = "approved" if result["passed"] else ("rewrite" if will_retry else "fallback")

    if will_retry:
        await ctx.tracer.retry("guard", "compose", reason="; ".join(result["violations"]),
                               attempt=state.retry_count + 1)
        return {"guard_result": result, "retry_count": state.retry_count + 1}
    if not result["passed"]:
        in_a_row = int(((state.context_pack or {}).get("conversation") or {}).get("fallbacks_in_a_row") or 0) + 1
        repeated = in_a_row >= FALLBACKS_BEFORE_HANDOFF
        span.reasoning.append("A template fallback twice in a row: handing the lead to staff." if repeated else
                              "The first fallback in a row: the template goes out and the AI carries on (stream Q).")
        return {"guard_result": result, "fallback_reason": "guard rejected the draft twice", "flag_human": repeated}
    return {"guard_result": result}
