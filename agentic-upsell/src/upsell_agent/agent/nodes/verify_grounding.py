"""Node 3: verify_grounding — the anti-hallucination gate.

This is the single most important node in the graph. It takes state.draft_recommendations
and checks EVERY factual claim (price, product identity, availability) against
state.tool_calls — the verbatim results of real tool calls from retrieve_context.py.

Fails closed: if a claim can't be traced to a tool result, that item is dropped,
not "sent with a caveat." A dealership would rather send zero recommendations
than one wrong price.

See guardrails/output_validation.py for the actual check implementation — this
node just calls it and updates state accordingly.

TODO:
    - for each item in state.draft_recommendations:
        - resolve item.source_id against the matching tool_call result in
          state.tool_calls; if not found, drop the item
        - resolve item.price_cents against that same result; if it doesn't
          match, drop the item (never "correct" it silently — drop and log)
    - if ALL items were dropped, set state.suppressed_reason explaining why
    - consider a second, cheaper model call here as an additional check
      ("does this reasoning text assert anything not present in the grounding
      data?") once the deterministic checks are in place and proven
    - log every drop via observability/tracing.py — a pattern of frequent
      drops for one trigger/prompt version is a signal the prompt needs work,
      and evals/test_hallucination.py should have a regression case added
"""

from upsell_agent.agent.state import AgentState


async def verify_grounding(state: AgentState) -> dict:
    raise NotImplementedError("verify_grounding: wire up guardrails/output_validation.py")
