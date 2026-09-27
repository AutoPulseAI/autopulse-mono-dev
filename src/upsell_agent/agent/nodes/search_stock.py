"""Search stock (MASTER_PLAN_3 Phase 2 item 1): the dealer's stock for this
turn, after Validate, so it sees what this message just said.

Runs `load_context → extract → validate → search_stock → decide`. It replaced
Phase 1's search inside Load context, which only ever saw the profile from
before this turn's message (so stock showed up a turn late). One search per
turn.

- Criteria come from this turn's validated profile (tools/inventory_tool.py
  `criteria_from_profile`): vehicle, new/used, body type, colour, budget.
- "Something bigger" in the message moves the search up a size tier
  (tools/stock_search.py).
- It searches only when it helps (item 3): the customer asked about stock
  (agent/question_topics.py), or the profile names a make/model, or has a
  body type and new/used. Otherwise nothing is fetched.
- The result is patched onto the context pack's `inventory`,
  `inventory_query`, `inventory_checked_at` layers, the same way Compose
  patches `profile`. Still held back from the models (HELD_FROM_MODELS)
  until the grounding check (Phase 4).
- The platform being down means a turn without stock, never a failed turn.
"""

import re
from typing import Any

from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.context_pack import estimate_tokens
from upsell_agent.agent.question_topics import is_stock_question
from upsell_agent.agent.state import AgentState
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.tools.inventory_tool import (
    MAX_LOADED,
    InventoryCriteria,
    criteria_from_profile,
    get_inventory_source,
)
from upsell_agent.tools.stock_search import find_stock

BIGGER = re.compile(r"\b(bigger|larger|more room|more space|roomier)\b", re.IGNORECASE)
NOT_SEARCHED = ("Not searched: no stock question, and the profile doesn't name a vehicle "
                "(or a body type with new/used) yet.")


def search_trigger(criteria: InventoryCriteria, stock_question: bool, bigger: bool) -> str | None:
    """Why this turn searches, or None (item 3: search only when it helps)."""
    if stock_question:
        return "the customer asked about stock"
    if criteria.make or criteria.model:
        return "the profile names a vehicle"
    if criteria.body_type and criteria.condition:
        return "the profile has a body type and new/used"
    if bigger and criteria.body_type:
        return "the customer asked for something bigger"
    return None


def _asked_about_stock(state: AgentState) -> bool:
    texts = [q.get("text", "") for q in (state.extraction or {}).get("questions", [])]
    return any(is_stock_question(t) for t in [*texts, state.customer_text or state.inbound_text])


async def search_stock(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    criteria = criteria_from_profile(state.profile or {})
    text = state.customer_text or state.inbound_text
    bigger = bool(BIGGER.search(text or ""))
    trigger = search_trigger(criteria, _asked_about_stock(state), bigger)
    pack = dict(state.context_pack or {})
    wanted = criteria.model_dump(exclude_none=True)

    if trigger is None:
        span.output = {"searched": False, "records": [], "criteria": wanted}
        span.reasoning = [NOT_SEARCHED]
        span.edge_label = "no search"
        return {"context_pack": _patch(pack, [], None, None)}

    source = ctx.inventory or get_inventory_source(ctx.settings)
    reasoning = [f"Searching because {trigger}.", f"From the profile: {wanted or 'nothing (the newest stock)'}"
                 + (" · the budget filters the search only, it's never said" if criteria.price_max else "")
                 + (" · asked for something bigger, so the vehicle named is swapped for the next size up"
                    if bigger else (" · trim checked on our side" if criteria.trim else "")) + "."]
    try:
        result = await find_stock(state.dealer_id, criteria, source, bigger=bigger)
    except Exception as exc:  # noqa: BLE001 - stock is optional for a reply
        span.output = {"searched": True, "trigger": trigger, "error": repr(exc), "query": wanted, "records": []}
        span.reasoning = [*reasoning, f"Search failed ({exc!r}); continuing without stock."]
        span.edge_label = "search failed"
        return {"context_pack": _patch(pack, [], None, None)}

    loaded = [r.model_dump() for r in result.loaded(MAX_LOADED)]
    if result.colour:
        stored = result.colour["stored"]
        reasoning.append(f"Colour {result.colour['asked']!r} → sent as the dealer's own spelling {stored!r}."
                         if stored else f"Colour {result.colour['asked']!r}: none of the matching stock has it.")
    for step in result.loosened:
        reasoning.append(f"Loosened {step['step']}: {step['detail']}.")
    reasoning.append(f"Actually searched: {result.final_query} matched {result.matched}; {len(loaded)} given to the AI"
                     + (f" (at most {MAX_LOADED} per reply)" if result.matched > len(loaded) else "")
                     + (f" ({', '.join(r['vin'] for r in loaded)})" if loaded else "")
                     + (f"; {len(result.excluded)} left out" if result.excluded else "")
                     + (" [cached]" if result.cached else "") + ".")
    span.output = {"searched": True, "trigger": trigger, "query": result.query, "final_query": result.final_query,
                   "params": result.params, "matched": result.matched, "records": loaded,
                   "excluded": result.excluded, "loosened": result.loosened, "attempts": result.attempts,
                   "colour": result.colour, "checked_at": result.checked_at, "cached": result.cached}
    span.reasoning = reasoning
    span.edge_label = (f"{len(loaded)} loaded" + (f" · loosened {', '.join(s['step'] for s in result.loosened)}"
                                                  if result.loosened else ""))
    return {"context_pack": _patch(pack, loaded, result.final_query, result.checked_at)}


def _patch(pack: dict[str, Any], records: list[dict[str, Any]], query: dict[str, Any] | None,
           checked_at: str | None) -> dict[str, Any]:
    """The context pack with this turn's stock layers (held back from the models)."""
    budget = dict(pack.get("budget") or {})
    budget["tokens"] = {**(budget.get("tokens") or {}), "inventory": estimate_tokens(str(records)) if records else 0}
    return {**pack, "inventory": records, "inventory_query": query, "inventory_checked_at": checked_at,
            "budget": budget}
