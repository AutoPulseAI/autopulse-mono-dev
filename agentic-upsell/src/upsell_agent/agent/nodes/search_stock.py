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
  patches `profile`. As of Phase 3, `inventory` itself reaches Extract and
  Compose (the grounding check in guardrails/draft_guard.py now exists);
  `inventory_query` and `inventory_checked_at` stay held back (HELD_FROM_MODELS).
- The platform being down means a turn without stock, never a failed turn.
"""

import re
from typing import Any

from upsell_agent.agent import vehicle_reference
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.context_pack import estimate_tokens
from upsell_agent.agent.question_topics import is_stock_question
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.vehicle_media import lead_vehicle_vin, wants_link
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.tools.inventory_tool import (
    MAX_LOADED,
    InventoryCriteria,
    criteria_from_profile,
    get_inventory_source,
    get_vehicle,
)

TRIGGER_CADENCE_TOUCH = "cadence_touch"  # scheduler/followups.py (not imported: it imports the agent)
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


async def _referred_vehicle(state: AgentState, span: NodeSpan, ctx: TurnContext, pack: dict[str, Any]) -> dict[str, Any]:
    """PLAN_4 stream X3: the shown vehicle the customer refers back to ("the silver one", "the second one you
    sent", "that one"), resolved in code (agent/vehicle_reference.py) and re-read from the dealer's stock. It goes
    first in `inventory` and is named in `referred_vehicle`, so Compose, the visit offer and the photo use it."""
    conversation = pack.get("conversation") or {}
    shown = conversation.get("shown_vehicles") or []
    visit = conversation.get("visit") or {}
    awaiting_pick = bool(visit.get("offered_times")) and visit.get("offered_turn") == conversation.get("turn")
    ref = vehicle_reference.resolve(state.customer_text or state.inbound_text or "", shown,
                                    awaiting_visit_pick=awaiting_pick)
    if ref is None:
        return pack
    source = ctx.inventory or get_inventory_source(ctx.settings)
    by_vin = {v["vin"]: v for v in shown}
    wanted = [ref.vin] if ref.vin else ref.ambiguous
    fresh: list[dict[str, Any]] = []
    gone: list[str] = []
    for vin in wanted:
        try:
            record = await get_vehicle(state.dealer_id, vin, source)
        except Exception as exc:  # noqa: BLE001 - stock is optional for a reply
            span.reasoning = [*(span.reasoning or []), f"Referred vehicle {vin} couldn't be re-read ({exc!r})."]
            return pack
        if record:
            fresh.append({**record.model_dump(), "already_shown": True})
        else:
            gone.append(vin)
    if ref.vin:
        referred = {"vin": ref.vin, "how": ref.how, "in_stock": bool(fresh),
                    "description": vehicle_reference.brief(fresh[0] if fresh else by_vin[ref.vin])}
        note = (f"The customer means {referred['description']} ({ref.vin}; {ref.how}): "
                + ("still in stock." if fresh else "no longer in stock."))
    elif len(fresh) == 1:
        # Several fit, but only one is still here: that is the one to talk about (the others are said to be gone).
        referred = {"vin": fresh[0]["vin"], "how": ref.how, "in_stock": True,
                    "description": vehicle_reference.brief(fresh[0]), "others_sold": len(gone)}
        note = f"Several shown vehicles fit ({ref.how}); only {fresh[0]['vin']} is still in stock."
    else:
        referred = {"ambiguous": [{"vin": r["vin"], "description": vehicle_reference.brief(r)} for r in fresh],
                    "how": ref.how}
        note = (f"Ambiguous reference ({ref.how}): asking which of {', '.join(r['vin'] for r in fresh)}."
                if fresh else f"The vehicles referred to ({ref.how}) are no longer in stock.")
        if not fresh:
            referred = {"vin": wanted[0], "how": ref.how, "in_stock": False,
                        "description": vehicle_reference.brief(by_vin[wanted[0]])}
    span.reasoning = [*(span.reasoning or []), note]
    span.output = {**(span.output or {}), "referred_vehicle": referred}
    others = [r for r in pack.get("inventory") or [] if r.get("vin") not in {f["vin"] for f in fresh}]
    patched = _patch(pack, [*fresh, *others][:max(MAX_LOADED, len(fresh))], pack.get("inventory_query"),
                     pack.get("inventory_checked_at"))
    return {**patched, "referred_vehicle": referred}


async def _link_vehicle(state: AgentState, span: NodeSpan, ctx: TurnContext, pack: dict[str, Any]) -> dict[str, Any]:
    """conversation_7: the customer asked for a link ("can you send me a link to look") - the vehicle they mean
    (the one Extract named, else the one the lead is about) is read fresh and put in `inventory` when this turn's
    search didn't load it, so agent/link_resolver.py can find its page. Never a stand-in vehicle."""
    if not wants_link(state.extraction):
        return pack
    loaded = {r.get("vin") for r in pack.get("inventory") or []}
    named = (state.extraction or {}).get("link_target_vin")
    vin = next((v for v in (named, lead_vehicle_vin(ctx.lead, ctx.lead_state)) if v), None)
    if not vin or vin in loaded:
        return pack
    try:
        record = await get_vehicle(state.dealer_id, vin, ctx.inventory or get_inventory_source(ctx.settings))
    except Exception as exc:  # noqa: BLE001 - a link is never worth a failed turn
        span.reasoning = [*(span.reasoning or []), f"Link vehicle {vin} couldn't be read ({exc!r})."]
        return pack
    if not record:
        span.reasoning = [*(span.reasoning or []), f"Link vehicle {vin} is no longer in stock."]
        return pack
    shown = {v["vin"] for v in ((pack.get("conversation") or {}).get("shown_vehicles") or [])}
    span.reasoning = [*(span.reasoning or []), f"They asked for a link: {vin} added to this turn's stock."]
    return _patch(pack, [{**record.model_dump(), "already_shown": vin in shown}, *(pack.get("inventory") or [])],
                  pack.get("inventory_query"), pack.get("inventory_checked_at"))


async def search_stock(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    out = await _search_stock(state, span, ctx)
    out = {"context_pack": await _referred_vehicle(state, span, ctx, out["context_pack"])}
    out = {"context_pack": await _link_vehicle(state, span, ctx, out["context_pack"])}
    # PLAN_4 stream L: a cadence touch announcing a verified price drop gets that vehicle, read fresh, with
    # its verified prices - the only record that ever carries a price (learning/price_watch.py).
    drop = ((ctx.lead_state or {}).get("pending_touch") or {}).get("price_drop")
    if drop and state.trigger == TRIGGER_CADENCE_TOUCH:
        pack = out["context_pack"]
        source = ctx.inventory or get_inventory_source(ctx.settings)
        try:
            record = await get_vehicle(state.dealer_id, drop["vin"], source)
        except Exception as exc:  # noqa: BLE001 - no fresh record means no price in the reply
            record, note = None, f"Price-drop vehicle {drop['vin']} couldn't be re-read ({exc!r}): no price."
        else:
            note = (f"Price-drop vehicle {drop['vin']} added with its verified price ${drop['price']:,} "
                    f"(was ${drop['previous_price']:,})." if record else
                    f"Price-drop vehicle {drop['vin']} is no longer in stock: no price.")
        if record:
            entry = {**record.model_dump(), "price_drop": {k: drop[k] for k in ("price", "previous_price", "amount")}}
            others = [r for r in pack.get("inventory") or [] if r.get("vin") != drop["vin"]]
            out = {"context_pack": _patch(pack, [entry, *others][:MAX_LOADED], pack.get("inventory_query"),
                                          pack.get("inventory_checked_at"))}
        span.reasoning = [*(span.reasoning or []), note]
    return out


async def _search_stock(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
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

    shown = {v["vin"] for v in ((pack.get("conversation") or {}).get("shown_vehicles") or [])}
    loaded = [{**r.model_dump(), "already_shown": r.vin in shown} for r in result.loaded(MAX_LOADED)]
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
