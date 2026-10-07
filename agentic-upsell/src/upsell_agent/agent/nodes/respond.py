"""Node 4: respond.

Terminal node. Takes whatever survived verify_grounding.py, writes it to
state.final_recommendations, and persists the decision (memory/long_term.py,
so a future run knows what was already recommended) before the graph returns.

TODO:
    - copy the grounded subset of state.draft_recommendations into
      state.final_recommendations
    - persist via memory.long_term.record_recommendation(...) — this is what
      lets a later run see "we already suggested the extended warranty on
      2026-06-01" and adjust instead of repeating itself
    - emit the Langfuse trace_id onto the response (observability/tracing.py)
"""

from upsell_agent.agent.state import AgentState


async def respond(state: AgentState) -> dict:
    raise NotImplementedError("respond: persist via memory/long_term.py and finalize state")
