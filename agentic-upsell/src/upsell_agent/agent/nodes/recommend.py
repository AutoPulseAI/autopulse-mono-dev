"""Node 2: recommend.

Calls the model (via Pydantic AI) to produce candidate GroundedUpsellItem(s),
using ONLY state.customer_context and state.tool_calls as source material —
never calls a tool directly (see retrieve_context.py for why).

Pydantic AI's job here specifically: the model's output is forced into
`list[GroundedUpsellItem]`. If the model returns something that doesn't parse
against that schema (missing source_id, wrong type, etc.), Pydantic AI retries
or errors — malformed output never silently becomes state.draft_recommendations.

This node does NOT decide whether a recommendation is *true* — that's
verify_grounding.py's job. This node's only guarantee is "well-typed", not
"grounded".

TODO:
    - build a Pydantic AI Agent(model="openai:gpt-4o", output_type=list[GroundedUpsellItem])
      using the prompt template from agent/prompts.py
    - pass state.customer_context + a serialized view of state.tool_calls as context
    - policy checks (guardrails/policy.py) that are cheap/deterministic (quiet
      hours, re-offer cooldown, opt-out) should run BEFORE calling the model at
      all, not after — don't spend a model call on a customer we're not allowed
      to contact right now
"""

from upsell_agent.agent.state import AgentState


async def recommend(state: AgentState) -> dict:
    raise NotImplementedError("recommend: wire up the Pydantic AI agent call")
