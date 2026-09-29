"""Decide (architecture §8.3, MASTER_PLAN_2 Phase 5): one next step, from nine
rules, in plain code. The rules live in slots/policy.py; this step feeds them
the profile, what the customer said, the conversation state (what we asked
and how often) and the lead's status.

It also works out the after-hours choice (MASTER_PLAN_3 B1,
agent/after_hours.py): whether this reply offers "now or when we open?", is
the thank-you after "later", or is the morning message. The plan travels in
the decision (`after_hours`); the turn acts on it after the send."""

from typing import Any

from upsell_agent import clock
from upsell_agent.agent.after_hours import plan_after_hours
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.conversation import ConversationState, questions_for_turn
from upsell_agent.agent.nodes.load_context import load_profile
from upsell_agent.agent.state import AgentState
from upsell_agent.compliance.opt_out import POSSIBLE_OPT_OUT_REVIEW_CONFIDENCE
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.policy import UPSET_HANDOFF_CONFIDENCE, Flags, next_action


def possible_opt_out(extraction: dict[str, Any]) -> bool:
    """Extract thinks the message may be an opt-out, sure enough for REVIEW (C1 item 3)."""
    return bool(extraction.get("possible_opt_out")) and float(
        extraction.get("opt_out_confidence") or 0.0) >= POSSIBLE_OPT_OUT_REVIEW_CONFIDENCE


def hold_questions_reason(extraction: dict[str, Any], compliance: dict[str, Any] | None) -> str | None:
    if possible_opt_out(extraction):
        return (f"the message may be an opt-out (confidence {float(extraction.get('opt_out_confidence') or 0):.2f}); "
                "a plain reply while staff review it, no asks and no offers")
    if (compliance or {}).get("quiet_hours"):
        return "an outbound conversation outside 8:00-21:00 customer time: the team picks up at 8:00"
    return None


async def decide(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    extraction = state.extraction or {}
    profile = await load_profile(ctx, state)
    conversation = ConversationState.model_validate((state.context_pack or {}).get("conversation") or {})
    # Questions an earlier reply left unanswered (a template went out) come first.
    questions = questions_for_turn(conversation, list(extraction.get("questions") or []))
    status = (ctx.lead_state or {}).get("status")
    hold = hold_questions_reason(extraction, ctx.compliance)
    pack = state.context_pack or {}
    after_hours = plan_after_hours(
        trigger=state.trigger, origin=((ctx.compliance or {}).get("origin") or {}).get("origin"),
        now=pack.get("now") or {}, conversation=conversation, extraction=extraction, at=clock.now(),
        text=state.customer_text or state.inbound_text)
    if hold and after_hours.mode == "offer":
        # A possible opt-out or quiet hours: nothing is asked, not even the choice.
        after_hours.mode, after_hours.record = None, None
        after_hours.why = f"No after-hours choice: {hold}."
    decision = next_action(profile, Flags(
        hold_questions=hold,
        contact_choice=after_hours.mode if after_hours.mode in ("offer", "later") else None,
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
    if (ctx.compliance or {}).get("quiet_hours"):
        decision["quiet_hours"] = {"resume_at": ctx.compliance.get("resume_at")}
    if decision["action"] in ("stop", "handoff") and after_hours.mode in ("offer", "later"):
        # Staff (or nobody) take it from here: no choice to offer, no morning message.
        after_hours.mode, after_hours.record, after_hours.schedule_resume = None, None, False
        after_hours.cancel_resume = True
        after_hours.why = f"No after-hours choice: the reply is a {decision['action']}."
    decision["after_hours"] = after_hours.as_dict()
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
    if hold:
        span.reasoning.append(f"No questions this time: {hold}.")
    if after_hours.why:
        span.reasoning.append(f"After hours: {after_hours.why}")
    if extraction.get("annoyed_at_bot"):
        span.reasoning.append("The customer is frustrated with the conversation: no questions this time.")
    if extraction.get("upset") and decision["action"] != "handoff":
        span.reasoning.append(f"Upset, but not clearly enough to hand off (confidence "
                              f"{float(extraction.get('upset_confidence') or 0):.2f}, needs "
                              f"{UPSET_HANDOFF_CONFIDENCE:.2f}).")
    span.edge_label = decision["action"] + (f": {', '.join(a['label'] for a in decision['asks'])}"
                                            if decision["asks"] else "")
    if after_hours.mode:
        span.edge_label += f" · after hours: {after_hours.mode}"
    return {"decision": decision}
