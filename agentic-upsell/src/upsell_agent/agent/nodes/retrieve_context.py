"""Node 1: retrieve_context.

Pulls everything the agent is allowed to reason about, and nothing it isn't.
This is the ONLY node that talks to tools/customer_tool.py, tools/inventory_tool.py,
and tools/pricing_tool.py before a recommendation is drafted — recommend.py must
only ever use what's already in state.tool_calls, never call a tool itself with
unvalidated arguments. That separation is what keeps grounding checkable later.

TODO:
    - call tools.customer_tool.get_customer_context(dealer_id, customer_id)
    - call tools.inventory_tool / tools.pricing_tool for candidate items relevant
      to `trigger` (e.g. service_visit_closed -> service packages + trade-up if
      mileage/age crosses a threshold)
    - append a ToolCallRecord for every call, verbatim, before returning
"""

from upsell_agent.agent.state import AgentState


async def retrieve_context(state: AgentState) -> dict:
    raise NotImplementedError("retrieve_context: wire up tools/customer_tool.py + inventory/pricing tools")
