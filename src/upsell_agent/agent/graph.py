"""Wires the nodes into a LangGraph StateGraph with Redis-backed checkpointing.

The checkpointer is what makes this durable: a run is identified by a
`thread_id` (memory.short_term.thread_id_for — f"{dealer_id}:{lead_id}"), so
invoking the graph again for the same lead resumes with full prior state
instead of starting blank. This is the mechanism behind "declined the
warranty in March, revisit in June with different reasoning" — the state
literally persists across separate HTTP requests, since this service has no
other place to keep it between one customer message and the next.

TODO:
    - implement and register the CAPTURE/INTERPRET/LEVERAGE_ADVANCE nodes
      (see agent/nodes/), then:
        graph.add_node("capture", capture)
        graph.add_node("interpret", interpret)
        graph.add_node("leverage_advance", leverage_advance)
        graph.add_node("never_invent_check", never_invent_check)
        graph.add_node("respond", respond)
        graph.set_entry_point("capture")
        graph.add_edge("capture", "interpret")
        graph.add_edge("interpret", "leverage_advance")
        graph.add_edge("leverage_advance", "never_invent_check")
        graph.add_conditional_edges(
            "never_invent_check",
            lambda s: "retry" if s.get("_never_invent_violations") else "respond",
            {"retry": "leverage_advance", "respond": "respond"},
        )
        # ^ bounded by objection_attempt_count / a separate retry counter -
        # do not let this loop indefinitely on a stubborn hallucination; cap
        # it and fall back to a safe, generic "let me have the team follow
        # up" message rather than looping forever or sending an unverified
        # claim.
        graph.add_edge("respond", END)
"""

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, StateGraph

from upsell_agent.agent.state import AgentState


def build_graph(checkpointer: BaseCheckpointSaver):
    """`checkpointer` is the Redis-backed saver from
    memory.short_term.checkpointer_context(), entered once in main.py's
    lifespan and passed in here — NOT constructed inside this function, so
    the connection is shared across requests instead of reopened per call.
    """
    graph = StateGraph(AgentState)

    # TODO: graph.add_node(...) / graph.add_edge(...) per the module docstring,
    # once agent/nodes/*.py have real implementations.

    return graph.compile(checkpointer=checkpointer)
