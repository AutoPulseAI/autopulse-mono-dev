"""Guard (architecture §7): nothing the AI wrote is sent until it passes
guardrails/draft_guard.py, including the grounding check on any vehicle it
named (MASTER_PLAN_3 Phase 4). One rewrite is allowed; a second failure sends
the safe template and flags the lead for a human."""

from typing import Any

from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.state import AgentState
from upsell_agent.guardrails.draft_guard import check_draft
from upsell_agent.guardrails.plain_language import find_jargon
from upsell_agent.observability.trace import NodeSpan

MAX_REWRITES = 1


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
    inventory = pack.get("inventory") or []
    draft = state.draft or {}
    # check_draft itself allows a mentioned vehicle's own year/miles and does
    # the vin/trim/make grounding check (MASTER_PLAN_3 Phase 3 decision C, Phase 4).
    result = check_draft(state.draft, customer_texts=customer_texts, known_values=known, inventory=inventory)
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
