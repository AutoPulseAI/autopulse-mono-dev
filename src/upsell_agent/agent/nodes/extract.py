"""Extract (architecture §7): the AI reads the customer's words and returns
typed slot values, each with the exact words it came from and a confidence.
It does not decide anything; Validate checks every value.

Cheap model (MODEL_EXTRACT), 3-second limit, one call. Any failure routes
the turn to the template (architecture §7: a limit sends the template,
never nothing).
"""

from typing import Any

from upsell_agent.agent.context import AiBudgetExceeded, TurnContext
from upsell_agent.agent.llm import extract_agent, run_agent
from upsell_agent.agent.state import AgentState
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.schema import SCHEMA, SLOTS

OUTPUT_TOKENS = 500


def _allowed_slots() -> list[dict[str, Any]]:
    return [{"path": s.path, "label": s.label, "kind": s.kind, "choices": list(s.choices)}
            for s in SLOTS if s.priority is not None]


async def extract(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    model = ctx.settings.model_extract
    last_asked = (ctx.lead_state or {}).get("last_asked_slots") or []
    payload = {
        "customer_text": state.inbound_text,
        "lead_type": (state.profile or {}).get("effective_lead_type") or "general",
        "allowed_slots": _allowed_slots(),
        "recently_asked": last_asked,
    }
    span.metrics = {"model": model}
    try:
        ctx.spend_ai_call()
        result, call = await run_agent(extract_agent(model), model, payload,
                                       timeout_s=ctx.settings.extract_timeout_s, output_tokens_limit=OUTPUT_TOKENS)
    except TimeoutError:
        return _failed(span, f"no answer within {ctx.settings.extract_timeout_s}s")
    except AiBudgetExceeded as exc:
        return _failed(span, str(exc))
    except Exception as exc:  # noqa: BLE001 - any model/provider error sends the template
        return _failed(span, f"{type(exc).__name__}: {exc}")

    extraction = result.model_dump()
    ctx.model_calls.append({"step": "extract", **call.as_metrics()})
    span.output = extraction
    span.metrics = call.as_metrics()
    span.reasoning = [
        f"'{v['quote']}' → {v['path']} ({SCHEMA[v['path']].label if v['path'] in SCHEMA else 'unknown slot'}) = "
        f"{v['value']!r}, confidence {v['confidence']:.2f}"
        for v in extraction["values"]
    ] or ["No slot values in the message."]
    if extraction["customer_questions"]:
        span.reasoning.append(f"Questions asked: {len(extraction['customer_questions'])}.")
    if extraction["wants_human"]:
        span.reasoning.append("The customer asked for a person.")
    if extraction["negative_sentiment"]:
        span.reasoning.append("The customer sounds upset.")
    n = len(extraction["values"])
    span.edge_label = f"{n} value{'s' if n != 1 else ''} found"
    return {"extraction": extraction}


def _failed(span: NodeSpan, reason: str) -> dict[str, Any]:
    span.output = {"error": reason, "values": []}
    span.reasoning = [f"Extract failed: {reason}. Sending the template instead."]
    span.edge_label = "failed"
    return {"extraction": {"error": reason, "values": [], "customer_questions": [], "wants_human": False,
                           "negative_sentiment": False}, "fallback_reason": f"extract failed: {reason}"}
