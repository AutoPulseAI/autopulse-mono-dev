"""Decide (architecture §8.3, MASTER_PLAN_2 Phase 5): one next step, from nine
rules, in plain code. The rules live in slots/policy.py; this step feeds them
the profile, what the customer said, the conversation state (what we asked
and how often) and the lead's status."""

from typing import Any

from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.conversation import ConversationState, questions_for_turn
from upsell_agent.agent.nodes.load_context import load_profile
from upsell_agent.agent.state import AgentState
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.policy import UPSET_HANDOFF_CONFIDENCE, Flags, next_action


async def decide(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    extraction = state.extraction or {}
    profile = await load_profile(ctx, state)
    conversation = ConversationState.model_validate((state.context_pack or {}).get("conversation") or {})
    # Questions an earlier reply left unanswered (a template went out) come first.
    questions = questions_for_turn(conversation, list(extraction.get("questions") or []))
    status = (ctx.lead_state or {}).get("status")
    decision = next_action(profile, Flags(
        opted_out=status == "opted_out",
        already_qualified=status == "qualified",
        stop_asking=status == "partly_qualified",
        asks={path: (a.count, a.last_turn) for path, a in conversation.asks.items()},
        last_asked=list(conversation.last_asked),
        replies=conversation.turn,
        wants_human=bool(extraction.get("wants_human")),
        upset=bool(extraction.get("upset")),
        upset_confidence=float(extraction.get("upset_confidence") or 0.0),
        annoyed_at_bot=bool(extraction.get("annoyed_at_bot")),
        questions=questions,
    ))
    span.output = decision
    span.reasoning = [f"Rule {i + 1} ({r['id']}): {r['result']}{' - ' + r['why'] if r['why'] else ''}"
                      for i, r in enumerate(decision["rules"])]
    span.reasoning.append(f"{decision['required_filled']} of {decision['required_total']} required details collected "
                          f"for a {decision['effective_lead_type']} lead.")
    if questions:
        carried = len(questions_for_turn(conversation, []))
        span.reasoning.append(f"{len(questions)} customer question(s) to answer"
                              + (f", {carried} still open from earlier." if carried > 0 else "."))
    for skipped in decision["not_asked"]:
        span.reasoning.append(f"Not asking {skipped['label']}: {skipped['why']}.")
    if extraction.get("annoyed_at_bot"):
        span.reasoning.append("The customer is frustrated with the conversation: no questions this time.")
    if extraction.get("upset") and decision["action"] != "handoff":
        span.reasoning.append(f"Upset, but not clearly enough to hand off (confidence "
                              f"{float(extraction.get('upset_confidence') or 0):.2f}, needs "
                              f"{UPSET_HANDOFF_CONFIDENCE:.2f}).")
    span.edge_label = decision["action"] + (f": {', '.join(a['label'] for a in decision['asks'])}"
                                            if decision["asks"] else "")
    return {"decision": decision}
