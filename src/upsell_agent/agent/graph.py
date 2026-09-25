"""One conversation turn as a LangGraph graph (architecture §7):

    load_context ─┬─▶ extract ─┬─▶ validate → decide → compose → guard ─┬─▶ END
                  │            │                         ▲              │
                  │            │                         └── retry ×1 ──┤
                  │            └── failed ───────────────▶ fallback ◀───┘ (2nd failure / compose failed)
                  └── first reply (FIRST_REPLY_MODE=template) ─▶ fallback ─▶ END

- Extract and Compose call the AI (agent/llm.py). Everything else is code.
- `fallback` is the template reply step (agent/nodes/template_reply.py).
- Decide choosing "stop" skips Compose entirely: nothing is written.

Every step is wrapped so it reports to the turn's TurnTracer (input,
reasoning, output, timing), which is what the Debug UI animates.

The graph returns a draft and never sends; the worker owns sending and
scheduling (agent/turn.py).

Per-run values arrive through `config["configurable"]`:
    ctx    agent/context.TurnContext (database, platform client, settings,
           tracer, AI-call budget)
"""

from collections.abc import Awaitable, Callable
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, StateGraph

from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.nodes.compose import compose
from upsell_agent.agent.nodes.decide import decide
from upsell_agent.agent.nodes.extract import extract
from upsell_agent.agent.nodes.guard import guard
from upsell_agent.agent.nodes.load_context import load_context
from upsell_agent.agent.nodes.template_reply import template_reply
from upsell_agent.agent.nodes.validate import validate
from upsell_agent.agent.state import AgentState

NodeFn = Callable[[AgentState, Any, TurnContext], Awaitable[dict]]


def _node_input(name: str, state: AgentState) -> dict[str, Any]:
    """What the Debug UI shows as this step's input: only the fields it reads."""
    if name == "load_context":
        return {"lead_id": state.lead_id, "customer_id": state.customer_id, "trigger": state.trigger,
                "channel": state.channel}
    if name == "extract":
        return {"text": state.inbound_text, "lead_type": (state.profile or {}).get("effective_lead_type")}
    if name == "validate":
        return {"extraction": state.extraction, "text": state.inbound_text}
    if name == "decide":
        return {"lead_type": (state.profile or {}).get("effective_lead_type"),
                "required": (state.profile or {}).get("required"),
                "missing": (state.profile or {}).get("missing"),
                "wants_human": (state.extraction or {}).get("wants_human"),
                "upset": (state.extraction or {}).get("negative_sentiment")}
    if name == "compose":
        return {"decision": {k: (state.decision or {}).get(k) for k in ("action", "asks", "confirm", "answer_questions")},
                "attempt": state.retry_count + 1, "channel": state.channel, "campaign": state.campaign,
                "guard_feedback": (state.guard_result or {}).get("violations") if state.retry_count else None}
    if name == "guard":
        return {"draft": state.draft}
    if name == "fallback":
        return {"lead_type": state.lead_type, "customer_name": state.customer_name,
                "reason": state.fallback_reason or ("first reply" if state.first_reply_via_template else None)}
    return {}


def _traced(name: str, fn: NodeFn) -> Callable[[AgentState, RunnableConfig], Awaitable[dict]]:
    async def run(state: AgentState, config: RunnableConfig) -> dict:
        ctx: TurnContext = config["configurable"]["ctx"]
        async with ctx.tracer.node(name, _node_input(name, state)) as span:
            return await fn(state, span, ctx)

    run.__name__ = name
    return run


def _after_load(state: AgentState) -> str:
    return "fallback" if state.first_reply_via_template else "extract"


def _after_extract(state: AgentState) -> str:
    return "fallback" if state.fallback_reason else "validate"


def _after_decide(state: AgentState) -> str:
    return END if (state.decision or {}).get("action") == "stop" else "compose"


def _after_guard(state: AgentState) -> str:
    return (state.guard_result or {}).get("next", "fallback")


def build_graph(checkpointer=None):
    """`checkpointer` is optional: the shallow Redis saver
    (memory/short_term.py) can be passed so a crashed worker can resume
    mid-turn; MongoDB stays the source of truth either way."""
    graph = StateGraph(AgentState)
    for name, fn in [("load_context", load_context), ("extract", extract), ("validate", validate),
                     ("decide", decide), ("compose", compose), ("guard", guard), ("fallback", template_reply)]:
        graph.add_node(name, _traced(name, fn))

    graph.set_entry_point("load_context")
    graph.add_conditional_edges("load_context", _after_load, {"extract": "extract", "fallback": "fallback"})
    graph.add_conditional_edges("extract", _after_extract, {"validate": "validate", "fallback": "fallback"})
    graph.add_edge("validate", "decide")
    graph.add_conditional_edges("decide", _after_decide, {"compose": "compose", END: END})
    graph.add_edge("compose", "guard")
    graph.add_conditional_edges("guard", _after_guard, {"send": END, "compose": "compose", "fallback": "fallback"})
    graph.add_edge("fallback", END)
    return graph.compile(checkpointer=checkpointer)
