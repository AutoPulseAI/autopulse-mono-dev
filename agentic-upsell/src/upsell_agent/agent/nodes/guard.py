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
from upsell_agent.guardrails import draft_guard
from upsell_agent.guardrails.draft_guard import check_draft
from upsell_agent.guardrails.grammar import check_draft_grammar
from upsell_agent.guardrails.link_guard import disallowed_links
from upsell_agent.guardrails.plain_language import find_jargon
from upsell_agent.guardrails.stock_claims import unsupported_stock_claims
from upsell_agent.guardrails.wording import (
    invented_names,
    repeated_vehicle_name,
    unverified_features,
    vin_in_text,
)
from upsell_agent.observability.trace import NodeSpan

# The AI chooses one question per message (slots/policy.py); a fixed one (touch1's closing, the after-hours choice)
# can come with it, so a draft may carry two.
MAX_QUESTIONS_IN_DRAFT = 2
# AI Studio: hand the lead to staff after failed drafts in a row (client, 18 Oct 2026: off - "we don't want escalations").
HANDOFF_AFTER_FAILED_DRAFTS = False
from upsell_agent.tools.vehicle_catalog import dealer_catalog

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
    texts = [info.get(k) for k in ("address", "phone", "website", "credit_application_link", "trade_in_link",
                                   "hours_summary")]
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
    said = f"{draft.get('sms_text') or ''} {draft.get('email_body') or ''}".lower()
    # Client, 19 Oct 2026 (12 fallbacks: "is it still available?" answered with "it's here" but not listed): an
    # availability question is answered when the reply says it plainly.
    availability_said = bool(re.search(r"\b(?:available|still here|is here|it'?s here|in stock|on (?:our|the) lot|"
                                       r"we have it|we still have|has sold|was sold|no longer available)\b", said))
    # Joyce Capuano, 26 Oct 2026: a question with no text ("didn't answer: None") failed every draft twice, the
    # customer got "anything else before your visit?" and asked to be taken off the list. No text: nothing to answer.
    return [q["text"] for q in decision.get("answer_questions") or [] if str(q.get("text") or "").strip()
            and _key(q["text"]) not in answered
            and not (availability_said and re.search(r"\bavailab|\bstill (?:there|have|for sale)|\bin stock\b",
                                                      str(q.get("text") or ""), re.IGNORECASE))]


def too_many_questions(draft: dict[str, Any]) -> list[str]:
    """Versions of the draft that ask more than MAX_QUESTIONS_IN_DRAFT questions."""
    return [f"the {name} asks {count} questions (at most {MAX_QUESTIONS_IN_DRAFT})"
            for name, key in (("SMS", "sms_text"), ("email", "email_body"))
            if (count := str(draft.get(key) or "").count("?")) > MAX_QUESTIONS_IN_DRAFT]


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
    # The question as published in AI Studio, when edited there (agent/nodes/decide.py studio_after_hours).
    wording = str((decision.get("after_hours") or {}).get("wording") or "would you like to chat now").lower()
    return [f"the {name} doesn't offer the after-hours choice" for name, key in
            (("SMS", "sms_text"), ("email", "email_body"))
            if wording not in str(draft.get(key) or "").lower()]


# A resume message just needs to signal "we're available now" before it carries on - not literally "the team
# is in now" (agent/llm.py's instruction to Compose), since a real model's own close paraphrase is fine; only
# dropping the acknowledgment entirely (seen live, 6 Oct 2026: straight into a budget question) is the problem.
_RESUME_PHRASES = ("team is in", "we're open", "we are open", "we're back", "we are back", "open now", "back open")


# Client, 12 Oct 2026 (Betsy): "stop saying the team can do this and that ... the goal is to make an appointment."
# The team is mentioned only when the lead goes to the dealership (handoff / offer_human) or a service request is
# passed on (service visits are requested, never booked, in this SOW).
_TEAM = re.compile(r"\b(?:the|our|a|your)\s+(?:sales\s+|finance\s+)?team\b|\bteam\s+member|\bsomeone\s+(?:from|at|on)\s+"
                   r"(?:our|the)\b|\bsomeone\s+will\s+(?:reach|get|call|follow|be)\b", re.IGNORECASE)


# Client, 18 Oct 2026 (Freder: "I'll write up your full out-the-door ... and send it here shortly"; Steven: "I'll send
# the video link Monday"): the AI never promises to send what it can't - a video, a written or itemized price, a buyer's
# order, paperwork.
_CANT_SEND = re.compile(
    r"\b(?:i'?ll|i will|we'?ll|we will|let me|i can|going to)\b[^.?!]{0,40}\b(?:send|write\s*up|put|email|text|get)\b"
    r"[^.?!]{0,60}\b(?:video|walk-?around|out[\s-]the[\s-]door|itemi[sz]|doc fee|buyer'?s order|purchase order|"
    r"paperwork|in writing|breakdown|quote)\b", re.IGNORECASE)


_ASKS_WHERE = re.compile(r"\bwhere\b[^?]{0,40}\b(?:located|location|are you|is it|is the|car|vehicle|dealership|you guys)\b|"
                         r"\baddress\b|\bdirections?\b|\bhow (?:do|can) i get (?:there|to you)\b", re.IGNORECASE)


def missing_address(decision: dict[str, Any], draft: dict[str, Any], customer_text: str | None) -> list[str]:
    """Client, 17 Oct 2026 (Zack: "Where is the vehicle located?"): the answer is the street address, never "in town"."""
    address = str(decision.get("dealer_address") or "").strip()
    if not address or not _ASKS_WHERE.search(customer_text or ""):
        return []
    street = address.split(",")[0].strip().lower()
    return [f"the {name} doesn't give the address they asked for: write {address!r}"
            for name, key in (("SMS", "sms_text"), ("email", "email_body"))
            if street and street not in str(draft.get(key) or "").lower()]


def promises_what_it_cannot_send(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    if (decision.get("cannot_supply") or {}).get("text"):
        return []  # the client's own script, placed by code
    return [f"the {name} promises to send something the AI can't ({m.group(0)[:60]!r}) - invite them in instead"
            for name, key in (("SMS", "sms_text"), ("email", "email_body"))
            if (m := _CANT_SEND.search(str(draft.get(key) or "")))]


# Client, 20 Oct 2026 (Joel Clymer: "She told the customer, 'Here is the link,' but there was no link"): a message that
# points to a link must carry one.
_SAYS_LINK = re.compile(r"\b(?:here(?:'s| is| are)\b[^.?!]{0,40}\blinks?|links? (?:below|above|attached|here)|"
                        r"(?:click|tap) (?:here|the link|below))\b", re.IGNORECASE)
_URL = re.compile(r"https?://\S+|\bwww\.\S+", re.IGNORECASE)


def link_promised_but_missing(draft: dict[str, Any]) -> list[str]:
    return [f"the {name} says there is a link but has none - attach the real link or don't mention one"
            for name, key in (("SMS", "sms_text"), ("email", "email_body"))
            if _SAYS_LINK.search(str(draft.get(key) or "")) and not _URL.search(str(draft.get(key) or ""))]


# Client, 20-21 Oct 2026 (Betsy: "the AI gets the conversation going and abandons"; live: "I'm here ... when you're
# ready", eval: "set up a drive when you're ready"): words that leave the next step to the customer. Never written.
_DEAD_END = re.compile(r"\b(?:when(?:ever)?\s+you(?:'|\u2019)?re\s+ready|let\s+(?:me|us)\s+know\s+when|feel\s+free\s+to\s+"
                       r"(?:reach\s+out|stop\s+by|contact)|just\s+say\s+when|reach\s+out\s+(?:any\s*time|whenever))\b",
                       re.IGNORECASE)


# Betsy, 25 Oct 2026 (Motie: "I'll let you know as soon as we have an S65", "I'll keep an eye out and ping you first" -
# nobody watches for it): a promise to tell the customer when a vehicle arrives is made only when staff were told
# (the vehicle check that puts the lead in Dealership Action Required).
_WATCH_PROMISE = re.compile(r"\b(?:(?:let|tell|text|notify|ping|alert)\s+you\s+(?:know\s+)?(?:first\s+)?(?:as\s+soon\s+as|"
                            r"when(?:ever)?|once|if)\s+(?:we|one|it|a|an|something|the)|keep\s+an\s+eye\s+out|"
                            r"(?:i'?ll|we'?ll|i\s+will)\s+(?:watch|look)\s+(?:for|out)|ping\s+you\s+first)", re.IGNORECASE)


def unbacked_watch_promise(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    if decision.get("vehicle_check"):
        return []
    return [f"the {name} promises to tell the customer when a vehicle comes in ({m.group(0)!r}), but nobody at the "
            "dealership was asked to - offer what's in stock and the visit instead"
            for name, key in (("SMS", "sms_text"), ("email", "email_body"))
            if (m := _WATCH_PROMISE.search(str(draft.get(key) or "")))]


# Erb, 26 Oct 2026 (a day-14 follow-up: "I'm passing it to our sales manager who can help and will get back to you" -
# nobody was told; the vehicle check runs only on the customer's own message): a hand-over is promised only when this
# turn hands over.
_HANDOVER_PROMISE = re.compile(r"\b(?:pass(?:ing|ed)?|hand(?:ing|ed)?|send(?:ing)?|forward(?:ing|ed)?)\s+(?:it|this|that|"
                               r"you|your\s+\w+)\s+(?:over\s+|along\s+|on\s+)?to\s+(?:a|our|the|my)\s+(?:sales\s+)?"
                               r"(?:manager|team|specialist)|\b(?:a|our|the)\s+(?:sales\s+)?manager\s+(?:who\s+)?"
                               r"(?:will|is\s+going\s+to)\s+(?:get\s+back|reach\s+out|follow\s+up|contact)", re.IGNORECASE)


def unbacked_handover_promise(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    if decision.get("vehicle_check") or decision.get("action") in ("handoff", "offer_human") \
            or (decision.get("cannot_supply") or {}).get("escalates"):
        return []
    return [f"the {name} says a manager was asked to help ({m.group(0)!r}), but nobody was - offer what's in stock "
            "and the visit instead"
            for name, key in (("SMS", "sms_text"), ("email", "email_body"))
            if (m := _HANDOVER_PROMISE.search(str(draft.get(key) or "")))]


# Betsy, 26 Oct 2026 (Motie: a follow-up a day after his last message opened "Thanks, Motie - I've got you down for
# ..."): a message the customer didn't just prompt never thanks them or answers them as if they had.
_REPLYING_OPENER = re.compile(r"^\s*(?:(?:hi|hello|hey)\s+[^,.!\n]{0,30}[,.!]\s*)?(?:thanks|thank\s+you|got\s+it|perfect|"
                              r"great(?!\s+news)|noted|sounds\s+good|appreciate|understood|awesome)\b", re.IGNORECASE)
CUSTOMER_TRIGGERS = ("inbound_message", "lead_created", "resume_at_opening")


def follow_up_acts_like_a_reply(trigger: str | None, draft: dict[str, Any]) -> list[str]:
    if not trigger or trigger in CUSTOMER_TRIGGERS:
        return []
    return [f"the {name} is a follow-up the customer didn't prompt, but opens as if answering them ({m.group(0).strip()!r})"
            " - open with the reason for writing instead"
            for name, key in (("SMS", "sms_text"), ("email", "email_body"))
            if (m := _REPLYING_OPENER.search(str(draft.get(key) or "")))]


# Live, 25 Oct 2026 (Kevin: "I'll text you at 845-645-8068 going forward" - the lead's number never changed): a promise
# to use a number that isn't the one on the lead.
_NUMBER_PROMISE = re.compile(r"\b(?:text|call|reach|message|contact)(?:ing)?\s+you\s+(?:at|on)\s+(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})",
                             re.IGNORECASE)


def promises_another_number(lead_phone: str | None, draft: dict[str, Any]) -> list[str]:
    on_file = re.sub(r"\D", "", str(lead_phone or ""))[-10:]
    out = []
    for name, key in (("SMS", "sms_text"), ("email", "email_body")):
        m = _NUMBER_PROMISE.search(str(draft.get(key) or ""))
        if m and re.sub(r"\D", "", m.group(1))[-10:] != on_file:
            out.append(f"the {name} promises to contact the customer on {m.group(1)}, which isn't the number on the "
                       "lead - say the new number was passed to the team instead")
    return out


def dead_end_wording(decision: dict[str, Any], draft: dict[str, Any], *, stage: str | None = None) -> list[str]:
    if (decision.get("cannot_supply") or {}).get("text"):
        return []  # the client's own script, placed by code
    if stage in ("sold_pending", "sold_delivered", "sales_visit"):
        return []  # they've already bought or come in: no push to book a visit
    return [f"the {name} leaves the next step to the customer ({m.group(0)!r}) - ask for the visit with specific "
            "times instead" for name, key in (("SMS", "sms_text"), ("email", "email_body"))
            if (m := _DEAD_END.search(str(draft.get(key) or "")))]


# Live, 23 Oct 2026 (Steve: "Am I texting with a real person?" -> "Yes—I'm a real person"): the AI never claims to be
# human. Every first message already says it's the dealership's AI Sales Manager.
_CLAIMS_HUMAN = re.compile(
    r"\b(?:i(?:'|\u2019)?m|i\s+am|this\s+is)\s+(?:a\s+|an\s+)?(?:real|actual|live)\s+(?:person|human|people)\b"
    r"|\byes,?\s*(?:—|-|,)?\s*(?:i(?:'|\u2019)?m|i\s+am)\s+(?:a\s+)?(?:real|human|person)\b"
    r"|\b(?:i(?:'|\u2019)?m|i\s+am)\s+(?:not\s+(?:a\s+)?(?:bot|robot|ai|computer|machine|program)|human)\b"
    r"|\bi\s+typed\b", re.IGNORECASE)


def claims_to_be_human(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    return [f"the {name} claims the AI is a person ({m.group(0)!r}) - say it's the dealership's AI assistant, and "
            "offer a person if they want one" for name, key in (("SMS", "sms_text"), ("email", "email_body"))
            if (m := _CLAIMS_HUMAN.search(str(draft.get(key) or "")))]


def mentions_the_team(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    if decision.get("action") in ("handoff", "offer_human") or decision.get("reply_language"):
        return []
    if ((decision.get("visit") or {}).get("service_request") or {}).get("passed_this_turn"):
        return []
    found = [(name, m.group(0)) for name, key in (("SMS", "sms_text"), ("email", "email_body"))
             if (m := _TEAM.search(str(draft.get(key) or "")))]
    # "the team" (client, 12 Oct 2026) and the phrases set in AI Studio (Message limits / the dealership's own rules).
    return [f"the {name} uses a phrase the dealership doesn't allow ({said!r}) - leave it out; for 'the team', speak "
            f"for yourself and move toward the visit instead" for name, said in found]


def missing_alternatives(context_pack: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """Client, 12 Oct 2026 (Bibi): a vehicle we don't have exactly is never a dead end - the stock search's nearest
    vehicles are offered. Only when the customer asked about stock and the search loaded alternatives."""
    stock = (context_pack or {}).get("stock_search") or {}
    if not stock.get("asked") or stock.get("exact") or not (context_pack or {}).get("inventory"):
        return []
    return [f"the {name} doesn't offer any of the similar vehicles in stock" for name, key in
            (("SMS", "sms_vins"), ("email", "email_vins")) if not draft.get(key)]


def missing_resume_acknowledgment(decision: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """A "resume" (MASTER_PLAN_3 B1) is the morning message after a customer chose to wait for the team; it
    must say so before doing anything else, not pick the conversation back up as if no time had passed."""
    if ((decision.get("after_hours") or {}).get("mode")) != "resume":
        return []
    if decision.get("reply_language"):
        # Stream Q: translated, so the English phrases above can't be checked here.
        return []
    return [f"the {name} doesn't say we're open now before continuing" for name, key in
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
    return [f"the {name} doesn't say we'll pick this up when we open" for name, key in
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


_BUDGET_CLAIM = re.compile(r"\b(?:the|your)\s+(?:budget|price\s+range|monthly\s+(?:target|budget))\s+(?:you|that\s+you)\s+"
                           r"(?:shared|gave|mentioned|told\s+me|set|have\s+in\s+mind)", re.IGNORECASE)
_MOVE_PROMISE = re.compile(r"\b(?:i'?ll|i\s+will|i'?m|i\s+am|we'?ll|we\s+will|we'?re)\s+(?:go(?:ing)?\s+to\s+)?"
                           r"(?:updat(?:e|ing)|mov(?:e|ing)|chang(?:e|ing)|reschedul(?:e|ing))\s+(?:your|the)\s+"
                           r"(?:appointment|visit|booking|time)", re.IGNORECASE)


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
    for name, key in (("SMS", "sms_text"), ("email", "email_body")):
        # Larry Harris, 26 Oct 2026: "I'll update your appointment and send the new confirmation shortly" three times -
        # it was never moved, and the no-show check went out for the old time. Only a move made this turn says so.
        if not visit.get("moved_this_turn") and (m := _MOVE_PROMISE.search(str(draft.get(key) or ""))):
            violations.append(f"the {name} says the appointment is being changed ({m.group(0)!r}), but it wasn't moved "
                              "- offer the open times for the day they want instead")
        # Client, 12 Oct 2026 (Betsy): a pending booking IS scheduled - "You're all set for ..." is right for both.
    # Live, 23 Oct 2026 (Joshuah): "You're all set for Sunday, October 25 at 11:00 AM" while his booking stayed on
    # Saturday - a confirmation names the day actually booked.
    booked = str(visit.get("display") or visit.get("booked_day") or "")
    booked_weekday = next((d for d in _WEEKDAYS if d in booked.lower()), None)
    for name, key in (("SMS", "sms_text"), ("email", "email_body")):
        for sentence in re.split(r"(?<=[.!?])\s+", str(draft.get(key) or "")):
            if not (_ALL_SET.search(sentence) or _CONFIRMED_WORDING.search(sentence)) or re.search(
                    r"\b(?:fully|already) booked|booked up\b", sentence, re.IGNORECASE):
                continue
            named = {d for d in _WEEKDAYS if re.search(rf"\b{d}\b", sentence, re.IGNORECASE)}
            if named and (not active or booked_weekday not in named):
                violations.append(f"the {name} confirms a visit on {', '.join(sorted(named))}, but the booking is "
                                  f"{booked or 'not made'}: never confirm a day or time that isn't booked")
                break
    return violations


_WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_ALL_SET = re.compile(r"\b(?:you'?re|you are|we'?re|we are) (?:all )?set\b|\ball set\b", re.IGNORECASE)


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
    # Client, 19 Oct 2026 ("a make not on the named vehicle: infiniti" on Jason's INFINITI QX60 lead): the car the lead
    # is about, the lead form's words and what the customer told us (their trade-in) are theirs, not claims about stock.
    lead = getattr(ctx, "lead", None) or {}
    from upsell_agent.agent.multi_vehicle import vehicle_label
    customer_texts += [t for t in (vehicle_label(lead), str((lead.get("data") or {}).get("comments") or ""),
                                   str(lead.get("trim") or ""))
                       if t]
    customer_texts += [str(sl["value"]) for sl in (state.profile or {}).get("slots", [])
                       if isinstance(sl.get("value"), str)]
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
    # Client, 19 Oct 2026 (a third of the fallbacks since Oct 16 were "numbers the customer never gave us" - the
    # dealership's own address, phone and zip, a car from this turn's stock, an earlier message): all real, never
    # invented. The dealership's details, every loaded vehicle's year / miles / price, the whole conversation so far.
    dealer_info = (pack.get("dealer") or {}).get("info") or {}
    known += [v for v in dealer_info.values() if isinstance(v, (str, int, float)) and not isinstance(v, bool)]
    known.append((state.decision or {}).get("dealer_address"))
    known += [r.get(k) for r in inventory for k in ("year", "miles", "price", "msrp") if r.get(k) is not None]
    # Live, 23 Oct 2026 (7 of 14 fallbacks): "C 300", "Altima 2.5 SR" are the car's own model / trim names, not numbers
    # the AI made up.
    known += [r.get(k) for r in inventory for k in ("make", "model", "trim") if r.get(k)]
    # Live, 23 Oct 2026 (a follow-up's "2024 Audi A3 40 Premium" rejected for "40"): any text on a loaded vehicle's
    # record - its title or series - is the record's own, not a number the AI made up.
    known += [v for r in inventory for v in r.values() if isinstance(v, str)]
    known += [m.get("text") for m in pack.get("working_memory") or [] if m.get("text")]
    touch1 = (state.decision or {}).get("touch1") or {}
    known += [touch1.get(k) for k in ("price_line", "lead_answers", "intro") if touch1.get(k)]
    # Found 21 Oct 2026 (appointment eval): "you're all set for Tuesday, September 22 at 4:00 PM" was rejected for
    # "22" - the visit, the times offered, the date asked to follow up and today's date are real, never invented.
    decision_ = state.decision or {}
    known += [(decision_.get("visit") or {}).get("display"), (decision_.get("next_action") or {}).get("display")]
    known += [t.get(k) for t in ((decision_.get("visit_offer") or {}).get("times") or []) for k in ("display", "date")]
    from datetime import timedelta as _td

    from upsell_agent import clock as _clock
    today = _clock.now()
    known += [f"{(today + _td(days=d)):%B} {(today + _td(days=d)).day}" for d in range(15)]
    known = [k for k in known if k]
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
                         # Live, 23 Oct 2026: a follow-up offering two similar cars ran 355-369 twice -> safe template.
                         sms_max=draft_guard.TOUCH1_SMS_MAX if (state.decision or {}).get("touch1") or (
                             state.decision or {}).get("reply_language") or (state.decision or {}).get("touch")
                         else draft_guard.SMS_MAX,
                         # MASTER_PLAN_4 D5/D6 (stream A4): a service outreach turn puts its event's facts here.
                         service_facts=(state.decision or {}).get("service_facts"))
    # The client's own wording placed by code: a script, or a touch written as fixed text in AI Studio.
    scripted = (((state.decision or {}).get("cannot_supply") or {}).get("text")
                or ((state.decision or {}).get("touch") or {}).get("fixed_text"))
    if scripted and str(draft.get("sms_text") or "") == scripted:
        # The client's own can't-supply wording, placed by code (agent/cannot_supply.py): her payment answer runs
        # past one text and says "incentives you qualify for" - her words, not a consent claim.
        for check in ("sms_length_ok", "no_consent_claims"):
            result["checks"][check] = True
        skipped = ("SMS must be", "states the customer's consent")
        result["violations"] = [v for v in result["violations"] if not v.startswith(skipped)]
        result["passed"] = all(result["checks"].values())
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
    no_alternatives = ([] if ((state.decision or {}).get("cannot_supply") or (state.decision or {}).get("action") in (
        "handoff", "offer_human", "stop")) else missing_alternatives(state.context_pack or {}, state.draft or {}))
    result["checks"]["offers_similar_vehicles"] = not no_alternatives
    if no_alternatives:
        result["passed"] = False
        result["violations"] += no_alternatives
    # Live, 24 Oct 2026 (a Sold Pending customer: "Wait ima get back to you"): a customer who has already bought isn't
    # pushed to book a visit - "when you're ready" is the right answer there.
    other_number = promises_another_number((getattr(ctx, "lead", None) or {}).get("phone"), state.draft or {})
    result["checks"]["no_promise_on_another_number"] = not other_number
    if other_number:
        result["passed"] = False
        result["violations"] += other_number
    replying = follow_up_acts_like_a_reply(state.trigger, state.draft or {})
    result["checks"]["follow_up_not_a_reply"] = not replying
    if replying:
        result["passed"] = False
        result["violations"] += replying
    watch = unbacked_watch_promise(state.decision or {}, state.draft or {})
    result["checks"]["no_unbacked_watch_promise"] = not watch
    if watch:
        result["passed"] = False
        result["violations"] += watch
    handover = unbacked_handover_promise(state.decision or {}, state.draft or {})
    result["checks"]["no_unbacked_handover_promise"] = not handover
    if handover:
        result["passed"] = False
        result["violations"] += handover
    dead_end = dead_end_wording(state.decision or {}, state.draft or {},
                                stage=(getattr(ctx, "lead_state", None) or {}).get("stage"))
    result["checks"]["no_dead_end_wording"] = not dead_end
    if dead_end:
        result["passed"] = False
        result["violations"] += dead_end
    human = claims_to_be_human(state.decision or {}, state.draft or {})
    result["checks"]["never_claims_to_be_human"] = not human
    if human:
        result["passed"] = False
        result["violations"] += human
    team = mentions_the_team(state.decision or {}, state.draft or {})
    result["checks"]["no_team_mention"] = not team
    if team:
        result["passed"] = False
        result["violations"] += team
    missing_resume = missing_resume_acknowledgment(state.decision or {}, state.draft or {})
    result["checks"]["resume_says_we_are_open"] = not missing_resume
    if missing_resume:
        result["passed"] = False
        result["violations"] += missing_resume
    missing_later = missing_later_acknowledgment(state.decision or {}, state.draft or {})
    result["checks"]["later_says_we_will_pick_up"] = not missing_later
    if missing_later:
        result["passed"] = False
        result["violations"] += missing_later
    # The after-hours morning message is meant to open with a fresh greeting
    # ("Good morning, the team is in now") whatever the turn (MASTER_PLAN_3 B1
    # decision 95): exempt from the no-repeated-greeting check.
    is_resume = ((state.decision or {}).get("after_hours") or {}).get("mode") == "resume"
    # The first text opens with the client's FTC greeting even after a night email went first (13 Oct 2026).
    first_text = bool((state.decision or {}).get("touch1"))
    conversation_turn = 0 if is_resume or first_text else (
        ((state.context_pack or {}).get("conversation") or {}).get("turn", 0))
    greeted_again = repeats_greeting(conversation_turn, state.draft or {})
    if greeted_again and scripted and str((state.draft or {}).get("sms_text") or "") == scripted:
        greeted_again = []  # the wording the client (or the super admin in AI Studio) wrote, greeting and all
    result["checks"]["no_repeated_greeting"] = not greeted_again
    if greeted_again:
        result["passed"] = False
        result["violations"] += greeted_again
    no_address = missing_address(state.decision or {}, state.draft or {}, state.customer_text or state.inbound_text)
    result["checks"]["gives_the_address"] = not no_address
    if no_address:
        result["passed"] = False
        result["violations"] += no_address
    cant_send = promises_what_it_cannot_send(state.decision or {}, state.draft or {})
    cant_send += link_promised_but_missing(state.draft or {})
    result["checks"]["no_promise_it_cannot_keep"] = not cant_send
    if cant_send:
        result["passed"] = False
        result["violations"] += cant_send
    # Tara VK, 26 Oct 2026: "how it fits the budget you shared" - she never gave one. A budget is claimed only when the
    # profile holds one.
    has_budget = any(sl.get("path") == "interest.budget" and sl.get("value") is not None
                     for sl in (state.profile or {}).get("slots", []))
    if not has_budget:
        claimed = [f"the {n} says the customer gave a budget ({m.group(0)!r}), but they didn't"
                   for n, k in (("SMS", "sms_text"), ("email", "email_body"))
                   if (m := _BUDGET_CLAIM.search(str((state.draft or {}).get(k) or "")))]
        result["checks"]["no_invented_budget"] = not claimed
        if claimed:
            result["passed"] = False
            result["violations"] += claimed
    bad_booking_wording = invalid_booking_wording(state.decision or {}, state.draft or {})
    result["checks"]["booking_wording_matches_status"] = not bad_booking_wording
    if bad_booking_wording:
        result["passed"] = False
        result["violations"] += bad_booking_wording
    # MASTER_PLAN_4 F3 / conversation_7: only the links this turn's plan allows (agent/link_resolver.py) - a
    # vehicle's own page, the homepage when they asked for it or weren't clear, Dealer Setup's credit application /
    # trade-in page when they asked for it (client, 8 Oct 2026) - and never an autopulse.ai one.
    bad_links = disallowed_links(state.draft, allowed=((state.draft or {}).get("link_plan") or {}).get("urls") or [],
                                 homepage=((pack.get("dealer") or {}).get("info") or {}).get("website"))
    result["checks"]["no_link_unless_asked"] = not bad_links
    if bad_links:
        result["passed"] = False
        result["violations"] += bad_links
    # conversation_7: "we don't have X" only about what this turn's search looked for (guardrails/stock_claims.py).
    catalog = await dealer_catalog(state.dealer_id)
    bad_stock = unsupported_stock_claims(state.draft, stock_search=pack.get("stock_search"), inventory=inventory,
                                         vehicle_words=set(catalog.models) | set(catalog.makes))
    result["checks"]["stock_claims_match_search"] = not bad_stock
    if bad_stock:
        result["passed"] = False
        result["violations"] += bad_stock
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
            # The stock record's own words ("It's Dark Graphite" - replay of live messages, 24 Oct 2026) aren't names.
            allowed=[t for t in (dealer_layer.get("name"), dealer_layer.get("agent_name"), state.customer_name) if t]
            + [" ".join(str(v) for v in (car or {}).values() if isinstance(v, str)) for car in inventory or []]),
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
    # Live, 25 Oct 2026 (Carlos wrote in Spanish; the first email carries AI Studio's fixed English text, which the
    # model can't rewrite - both drafts failed this check and he got the safe template): a reply not yet in the
    # customer's language is translated by the last step before sending (agent/turn.py _in_customer_language), so this
    # is noted, never a reason to throw a good reply away.
    wrong_language = not_in_reply_language(state.decision or {}, draft)
    result["checks"]["reply_language"] = True
    if wrong_language:
        result.setdefault("notes", []).extend(f"{v} - translated before sending" for v in wrong_language)
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
        # Client, 18 Oct 2026 (Betsy: "we don't want escalations"; Ramiro, Alan, Jason were left with the AI off after
        # "AI couldn't write a safe reply"): a failed draft never hands the lead off - the template goes out and the AI
        # stays on, working toward the appointment.
        hand_off = repeated and HANDOFF_AFTER_FAILED_DRAFTS
        if repeated and not hand_off:
            span.reasoning.append("Not handed off (AI Studio setting): the AI stays on.")
        return {"guard_result": result, "fallback_reason": "guard rejected the draft twice", "flag_human": hand_off}
    return {"guard_result": result}
