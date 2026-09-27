"""Compose (architecture §7): the AI writes the message for the step Decide
chose, as an SMS version and an email version at once (the 24h channel
switch re-sends the other version without another AI call).

It reads the turn's context pack (MASTER_PLAN_2 Phase 1), the same one
Extract read, with the profile layer brought up to date with the values
Validate just saved. It also returns what the message promises the team will
do, which the conversation state keeps.

Stronger model (MODEL_COMPOSE), 5 seconds per attempt. On a rewrite it is
told what the Guard objected to. Any failure routes the turn to the
template.
"""

from datetime import date
from typing import Any

from upsell_agent.agent.context import AiBudgetExceeded, TurnContext
from upsell_agent.agent.context_pack import HELD_FROM_MODELS, profile_layer
from upsell_agent.agent.llm import compose_agent, run_agent
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.templates import first_name
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.display import about_customer, display_value
from upsell_agent.slots.schema import SCHEMA

OUTPUT_TOKENS = 600


def compose_context(state: AgentState) -> dict[str, Any]:
    """The turn's context pack, with the profile layers brought up to date
    with what Validate saved this turn."""
    pack = {k: v for k, v in (state.context_pack or {}).items() if k not in HELD_FROM_MODELS}
    if state.profile:
        today = date.fromisoformat(pack["now"]["date"]) if pack.get("now") else None
        pack["profile"] = profile_layer(state.profile, today)
        pack["about_customer"] = about_customer(pack["profile"], today)
    return pack


def just_captured(state: AgentState) -> list[dict[str, str]]:
    """Values Validate saved from this message, in plain words (dates as
    "Saturday, September 27 (tomorrow)")."""
    now = (state.context_pack or {}).get("now") or {}
    today = date.fromisoformat(now["date"]) if now.get("date") else None
    validation = state.validation or {}
    return [{"label": SCHEMA[v["path"]].label, "display": display_value(SCHEMA[v["path"]], v["value"], today),
             "kind": SCHEMA[v["path"]].kind}
            for v in [*validation.get("accepted", []), *validation.get("needs_confirming", [])] if v["path"] in SCHEMA]


def compose_payload(state: AgentState) -> dict[str, Any]:
    decision = state.decision or {}
    return {
        "action": decision.get("action"),
        "asks": [{"label": a["label"], "question": a.get("question") or a["hint"], "explanation": a.get("explanation", "")}
                 for a in decision.get("asks", [])],
        "confirm": decision.get("confirm"),
        "clarify": decision.get("clarify"),
        "answer_questions": decision.get("answer_questions", []),
        "annoyed_at_bot": bool(decision.get("annoyed_at_bot")),
        "customer_first_name": first_name(state.customer_name),
        "channel": state.channel,
        "campaign": state.campaign,
        "customer_text": state.customer_text or state.inbound_text,
        "attempt": state.retry_count + 1,
        "guard_feedback": (state.guard_result or {}).get("violations", []) if state.retry_count else [],
        "just_captured": just_captured(state),
        "context": compose_context(state),
    }


async def compose(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    model = ctx.settings.model_compose
    payload = compose_payload(state)
    span.metrics = {"model": model}
    try:
        ctx.spend_ai_call()
        result, call = await run_agent(compose_agent(model), model, payload,
                                       timeout_s=ctx.settings.compose_timeout_s, output_tokens_limit=OUTPUT_TOKENS)
    except TimeoutError:
        return _failed(span, f"no answer within {ctx.settings.compose_timeout_s}s")
    except AiBudgetExceeded as exc:
        return _failed(span, str(exc))
    except Exception as exc:  # noqa: BLE001 - any model/provider error sends the template
        return _failed(span, f"{type(exc).__name__}: {exc}")

    draft = {**result.model_dump(), "attempt": payload["attempt"]}
    ctx.model_calls.append({"step": "compose", **call.as_metrics()})
    span.output = draft
    span.metrics = call.as_metrics()
    span.reasoning = [draft["why"]]
    if draft.get("promises"):
        span.reasoning.append("Promises the team: " + "; ".join(draft["promises"]))
    if payload["guard_feedback"]:
        span.reasoning.append("Rewrite after the guard objected to: " + "; ".join(payload["guard_feedback"]))
    if state.campaign:
        span.reasoning.append(f"Replying in the context of the campaign '{state.campaign['name']}'.")
    span.edge_label = f"draft {payload['attempt']}"
    return {"draft": draft}


def _failed(span: NodeSpan, reason: str) -> dict[str, Any]:
    span.output = {"error": reason}
    span.reasoning = [f"Compose failed: {reason}. Sending the template instead."]
    span.edge_label = "failed"
    return {"draft": None, "fallback_reason": f"compose failed: {reason}"}
