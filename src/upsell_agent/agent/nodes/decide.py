"""Decide (architecture §8.3): one next step, from five rules, in plain code.
The rules live in slots/policy.py; this step just feeds them the profile
and what the customer said."""

from typing import Any

from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.nodes.load_context import load_profile
from upsell_agent.agent.state import AgentState
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.policy import Flags, next_action


async def decide(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    extraction = state.extraction or {}
    profile = await load_profile(ctx, state)
    decision = next_action(profile, Flags(
        opted_out=(ctx.lead_state or {}).get("status") == "opted_out",
        wants_human=bool(extraction.get("wants_human")),
        upset=bool(extraction.get("negative_sentiment")),
        customer_questions=list(extraction.get("customer_questions") or []),
    ))
    span.output = decision
    span.reasoning = [f"Rule {i + 1} ({r['id']}): {r['result']}{' - ' + r['why'] if r['why'] else ''}"
                      for i, r in enumerate(decision["rules"])]
    span.reasoning.append(f"{decision['required_filled']} of {decision['required_total']} required details collected "
                          f"for a {decision['effective_lead_type']} lead.")
    span.edge_label = decision["action"] + (f": {', '.join(a['label'] for a in decision['asks'])}"
                                            if decision["asks"] else "")
    return {"decision": decision}
