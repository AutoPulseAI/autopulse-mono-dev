"""The actual anti-hallucination check, called by agent/nodes/verify_grounding.py.

Two layers, cheapest/most-reliable first:

1. Deterministic grounding check (this file's main job): for each recommendation,
   its `source_id` and `price_cents` must exactly match a value present in one
   of the ToolCallRecord.result entries from this run. No fuzzy matching, no
   "close enough" — if it doesn't match, drop the item. This alone catches the
   most damaging class of hallucination (wrong price, invented product) and
   costs nothing (no extra model call).

2. (Future) A second, cheaper model call as a semantic check on `reasoning` —
   "does this text assert anything about the customer or vehicle not present
   in the provided facts?" Only worth adding once (1) is shipped and evals
   show it's insufficient — don't build this before you have evidence you
   need it (see evals/test_hallucination.py).

TODO: implement check_grounding(state) -> (passed_items, dropped_items, reasons)
"""

from upsell_agent.agent.state import AgentState, ToolCallRecord
from upsell_agent.api.schemas import GroundedUpsellItem


def _tool_result_contains(tool_calls: list[ToolCallRecord], source_id: str) -> bool:
    """Deterministic check: does `source_id` appear verbatim in any tool result
    from this run? This is the entire trust boundary — everything else is
    presentation.
    """
    raise NotImplementedError("_tool_result_contains: walk tool_calls[*].result for source_id")


def check_grounding(
    state: AgentState,
) -> tuple[list[GroundedUpsellItem], list[tuple[GroundedUpsellItem, str]]]:
    """Returns (items that passed, [(item, drop_reason), ...] for items that didn't)."""
    raise NotImplementedError("check_grounding: apply _tool_result_contains to every draft item")
