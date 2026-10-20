"""The template reply step (pipeline node id `fallback`).

Reached when:
- a new lead's first reply while FIRST_REPLY_MODE=template (straight from
  load_context, no AI);
- Extract or Compose failed or ran out of time / AI calls;
- the guard rejected the AI's draft twice (the lead is also flagged for a
  human);
- the whole turn ran out of time (agent/turn.py builds the same draft).

Templates contain no prices, numbers or promises (agent/templates.py).
"""

from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.templates import (
    CONTINUE_VARIANTS,
    first_name,
    render_continue_reply,
    render_first_reply,
)
from upsell_agent.observability.trace import NodeSpan


def template_draft(lead_type: LeadType | None, customer_name: str | None, why: str, *,
                   mid_conversation: bool = False, decision: dict | None = None) -> dict:
    """The first-reply template, or (PLAN_4 stream Q) once the conversation has started, the continue template
    built from Decide's plan (agent/templates.render_continue_reply) - never "new or used?" out of the blue."""
    spanish = (decision or {}).get("reply_language") == "Spanish"
    touch1 = (decision or {}).get("touch1") or {}
    if not spanish and touch1.get("intro"):
        # Client, 12 Oct 2026 (Betsy: "why is AI not introducing self based on FTC compliance? why is it passing to the
        # team?"): even the safety-net first reply opens with the FTC introduction ("this is Angela, <Dealer>'s AI Sales
        # Manager, following up on your interest in ...") and asks the closing question - it never says the team
        # will follow up instead of the AI working the lead.
        # Client, 18 Oct 2026 (Othniel got "How can I help you today?"): her question, else the appointment.
        ending = touch1.get("ending") or "What day this week works best for you to come in?"
        line = f"{touch1['intro']} {ending}".strip()
        draft = {"sms_text": line, "email_subject": "Your inquiry",
                 "email_body": f"{touch1['intro']}\n\n{ending}\n\nThank you",
                 "template": "first_reply_ftc", "asks": {"sms": [], "email": []}, "promises": []}
    else:
        draft = (render_continue_reply(customer_name, decision, first=not mid_conversation)
                 if mid_conversation or spanish else render_first_reply(lead_type or LeadType.GENERAL, customer_name))
    if not spanish and touch1:
        from upsell_agent.agent.nodes.compose import place_touch1_extras
        place_touch1_extras(draft, touch1)
    draft["why"] = why
    return draft


def _said(text: str | None) -> str:
    return " ".join(str(text or "").lower().split())


def avoid_repeat(draft: dict, sent: list[str], customer_name: str | None) -> dict:
    """The same text as one we already sent this customer becomes the next variant they haven't had."""
    already = {_said(t) for t in sent}
    if _said(draft.get("sms_text")) not in already:
        return draft
    name = first_name(customer_name)
    for variant in CONTINUE_VARIANTS:
        line = variant.format(name=name)
        if _said(line) not in already:
            body = line.split(". ", 1)[1] if ". " in line else line
            return {**draft, "sms_text": line, "email_body": f"Hi {name},\n\n{body}\n\nThank you",
                    "asks": {"sms": [], "email": []}}
    return draft


def _sent_texts(state: AgentState) -> list[str]:
    memory = (state.context_pack or {}).get("working_memory") or []
    return [m.get("text") or "" for m in memory if m.get("direction") == "outbound"]


_NOT_A_REPLY = frozenset({"cadence_touch", "next_action", "visit_followup"})  # the morning message has its own


def _check_in(state: AgentState) -> dict:
    from upsell_agent.agent.multi_vehicle import vehicle_label
    from upsell_agent.agent.templates import first_name, known_first_name
    name = first_name(state.customer_name) if known_first_name(state.customer_name) else None
    vehicle = vehicle_label((state.context_pack or {}).get("lead") or {}) or ((state.profile or {}).get("values") or {
        }).get("interest.model")
    hi = f"Hi {name}" if name else "Hi there"
    about = f" about the {vehicle}" if vehicle else ""
    line = f"{hi}, just checking in{about}. What day this week works best for you to come in?"
    return {"sms_text": line, "email_subject": "Checking in", "email_body": f"{line}\n\nThank you",
            "template": "check_in", "asks": {"sms": [], "email": []}, "promises": [], "why": "follow-up check-in"}


def mid_conversation(state: AgentState) -> bool:
    """We've already written to this customer (the conversation has at least one reply of ours)."""
    return int(((state.context_pack or {}).get("conversation") or {}).get("turn") or 0) > 0


async def template_reply(state: AgentState, span: NodeSpan, ctx: TurnContext | None = None) -> dict:
    lead_type = state.lead_type or LeadType.GENERAL
    first_reply = state.first_reply_via_template and not state.fallback_reason
    if first_reply:
        why = "First reply to a new lead uses the template (FIRST_REPLY_MODE=template)."
        span.reasoning = [
            f"New {lead_type.value} lead: sending the '{lead_type.value}' template straight away, no AI call.",
            "Set FIRST_REPLY_MODE=ai to have the AI write first replies, with this template as the fallback.",
        ]
        span.edge_label = "template"
    else:
        why = f"Template used because {state.fallback_reason}."
        span.reasoning = [
            f"Using the '{lead_type.value}' template: {state.fallback_reason}.",
            "It contains no prices, numbers or promises, so it is always safe to send.",
        ]
        if state.flag_human:
            span.reasoning.append("The lead is flagged for a human to review.")
        span.edge_label = "fallback template"
    later = not first_reply and mid_conversation(state)
    if later:
        span.reasoning.append("Mid-conversation: the continue template, built from Decide's plan.")
    draft = template_draft(lead_type, state.customer_name, why, mid_conversation=later, decision=state.decision)
    if later:
        draft = avoid_repeat(draft, _sent_texts(state), state.customer_name)
    if state.trigger in _NOT_A_REPLY and not (state.decision or {}).get("touch1") and not (
            (state.decision or {}).get("touch") or {}).get("fixed_text"):
        # Client, 18 Oct 2026 (Othniel, Mandi: a follow-up opened "Thanks, Othniel..." as if the customer had written):
        # a message we start never thanks them; it checks in and asks for the visit.
        draft = _check_in(state)
    from upsell_agent.agent.nodes.compose import place_cannot_supply, place_fixed_text
    place_cannot_supply(draft, (state.decision or {}).get("cannot_supply"), state.customer_name)
    touch = (state.decision or {}).get("touch") or {}
    if touch.get("fixed_text"):
        # Client, 20 Oct 2026 (Betsy: "three hour nudge is wrong verbiage completely" - the draft failed and the template
        # sent "Thanks, that's something we can go over together..."): a fixed touch goes out word for word on the
        # template path too - the 3-hour nudge is "{FirstName}?", nothing else.
        place_fixed_text(draft, touch["fixed_text"], state.customer_name, nudge=touch.get("theme") == "name_nudge")
    span.output = draft
    return {"draft": draft, "used_template": True, "used_fallback": not first_reply}
