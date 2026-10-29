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
from upsell_agent.tools import stock_match
from upsell_agent.tools.inventory_tool import (
    MAX_LOADED,
    InventoryCriteria,
    criteria_from_profile,
    get_inventory_source,
    get_vehicle,
)

TRIGGER_CADENCE_TOUCH = "cadence_touch"  # scheduler/followups.py (not imported: it imports the agent)
from upsell_agent.tools.stock_search import find_stock
from upsell_agent.tools.vehicle_catalog import ResolvedVehicle, dealer_catalog, resolve_vehicle

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
    searched = str((pack.get("stock_search") or {}).get("searched_for") or "")
    try:
        record = await get_vehicle(state.dealer_id, vin, ctx.inventory or get_inventory_source(ctx.settings))
    except Exception as exc:  # noqa: BLE001 - a link is never worth a failed turn
        span.reasoning = [*(span.reasoning or []), f"Link vehicle {vin} couldn't be read ({exc!r})."]
        return pack
    if not record:
        span.reasoning = [*(span.reasoning or []), f"Link vehicle {vin} is no longer in stock."]
        return pack
    if not named and record.model and searched not in ("", "any vehicle") \
            and record.model.lower() not in searched.lower():
        # Krishna, 26 Oct 2026 ("Can you send me the link to the 3?" got the 2 Series' link): the lead's own car is
        # the link only when it's what this turn looked for.
        span.reasoning = [*(span.reasoning or []), f"Link: the lead's {record.model} isn't the {searched} asked for."]
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


def _profile_vehicle_words(profile: dict[str, Any]) -> str | None:
    slot = next((s for s in profile.get("slots", []) if s.get("path") == "interest.model"
                 and s.get("state") in ("filled", "stale")), None)
    value = (slot or {}).get("value")
    return value if isinstance(value, str) and value.strip() else None


def _with_vehicle(c: InventoryCriteria, v: ResolvedVehicle) -> InventoryCriteria:
    """`c` searching vehicle `v` instead: the make/model/trim/year (and a body type said in place of a model)
    replaced; condition and budget kept; the old vehicle's colour dropped."""
    return c.model_copy(update={"make": v.make, "model": v.model, "trim": v.trim, "year_min": v.year,
                                "year_max": v.year, "exterior_color": None,
                                "body_type": None if (v.make or v.model) else (v.body_type or c.body_type)})


async def turn_criteria(state: AgentState, stock_question: bool) -> tuple[InventoryCriteria, str | None, list[str]]:
    """conversation_7: what this turn searches for, and why. A stock question about a vehicle ("do u have sonata in
    stock?") searches that vehicle; "what vehicles do you have?" searches the stock in general; otherwise the
    profile's vehicle. Every vehicle is resolved against the dealer's own makes and models first (word order,
    spacing, misspellings: tools/vehicle_catalog.py), so "rdx acura" is searched as make Acura, model RDX. Never
    changes the profile: this is only what to search."""
    profile_criteria = criteria_from_profile(state.profile or {})
    extraction = state.extraction or {}
    text = state.customer_text or state.inbound_text or ""
    catalog = await dealer_catalog(state.dealer_id)
    notes: list[str] = []
    if stock_question or extraction.get("browse_stock"):
        asked = extraction.get("asked_vehicle")
        named = resolve_vehicle(asked, catalog) if asked else ResolvedVehicle()
        if not named.found:
            named = resolve_vehicle(text, catalog, phrase=False)  # a vehicle named in the message itself
        same = named.model and (named.make or "").lower() == (profile_criteria.make or "").lower() and \
            named.model.lower() == (profile_criteria.model or "").lower()
        if same:  # the vehicle the profile already has: its colour, trim and year still count
            return profile_criteria, None, notes
        # The dealer's own model list didn't confirm the model ("make only", "as said"): not stocked, or not yet in the
        # cached list. When the reader already has the customer's vehicle, that reading is searched (below) - "a white
        # RAV4" is never searched as "any Toyota" or as a model called "White RAV4" (found 21 Oct 2026; Betsy,
        # 12 Oct: say you'll make sure that vehicle is available).
        unconfirmed = named.how == "make only" or named.how.startswith("as said")
        if named.found and not (unconfirmed and profile_criteria.model):
            notes.append(f"This message asks about {(asked or text)!r}: searched as {named.describe()} ({named.how}).")
            return _with_vehicle(profile_criteria, named), "the customer asked about a vehicle", notes
        if extraction.get("browse_stock") or not (profile_criteria.make or profile_criteria.model):
            notes.append("They asked what we have: the stock in general (budget and new/used kept), not one vehicle.")
            return (InventoryCriteria(condition=profile_criteria.condition, price_max=profile_criteria.price_max,
                                      body_type=profile_criteria.body_type), "the customer asked what we have", notes)
    if words := _profile_vehicle_words(state.profile or {}):
        wanted = resolve_vehicle(words, catalog)
        # Only when it reads the words better than the profile's own split did: a model this dealer carries
        # ("rdx acura" -> Acura RDX), or a make the profile missed. A vehicle the dealer doesn't carry keeps the
        # profile's split ("RAV4 Adventure" -> model RAV4, trim Adventure).
        better = wanted.how == "catalog" or wanted.how.startswith("fuzzy") or (
            wanted.make and not profile_criteria.make)
        if better and (wanted.make, wanted.model) != (profile_criteria.make, profile_criteria.model):
            notes.append(f"The profile's vehicle {words!r} searched as {wanted.describe()} ({wanted.how}).")
            return _with_vehicle(profile_criteria, wanted).model_copy(update={
                "exterior_color": profile_criteria.exterior_color}), None, notes
    return profile_criteria, None, notes


# 28 Oct 2026 meeting (a customer asked "is this the xDrive?" - it was rear-wheel drive - and the AI asked his budget
# instead of whether he needs all-wheel drive): the customer's own words for all-wheel drive, any make.
WANTS_AWD = re.compile(r"\b(?:x\s*drive|quattro|4\s*matic|4\s*motion|awd|all[- ]?wheel(?:[- ]drive)?|4wd|4x4|"
                       r"four[- ]?wheel(?:[- ]drive)?|sh-?awd)\b", re.IGNORECASE)
# AI Studio > Compliance > Safeguards: the all-wheel-drive search, how loosely the budget is read for it (Betsy: "14-15K"
# for a $15,609 car means "under about $20K"), and how many all-wheel-drive cars it adds.
AWD_ENABLED = True
AWD_STRETCH_PERCENT = 25
AWD_SHOWN = 3


async def _search_stock(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    text = state.customer_text or state.inbound_text
    stock_question = _asked_about_stock(state)
    criteria, asked_trigger, resolve_notes = await turn_criteria(state, stock_question)
    bigger = bool(BIGGER.search(text or ""))
    wants_awd = AWD_ENABLED and bool(WANTS_AWD.search(text or ""))
    trigger = asked_trigger or search_trigger(criteria, stock_question, bigger) or (
        "the customer asked about all-wheel drive" if wants_awd else None)
    pack = dict(state.context_pack or {})
    wanted = criteria.model_dump(exclude_none=True)

    if trigger is None:
        span.output = {"searched": False, "records": [], "criteria": wanted}
        span.reasoning = [*resolve_notes, NOT_SEARCHED]
        span.edge_label = "no search"
        return {"context_pack": _patch(pack, [], None, None)}

    source = ctx.inventory or get_inventory_source(ctx.settings)
    reasoning = [*resolve_notes, f"Searching because {trigger}.",
                 f"Looking for: {wanted or 'nothing in particular (the newest stock)'}"
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

    widened = [s["step"] for s in result.loosened if s["step"] in ("model", "make", "size")]
    if any(s["step"] == "model_name" and "is BMW's" in str(s.get("detail")) for s in result.loosened) and any(
            s["step"] == "trim" for s in result.loosened):
        # Muhamad Nasir, 26 Oct 2026: "M240" became "2 Series" trim M240; with no M240 the trim was dropped and the 228s
        # were shown as the exact match (twice, after "No m240"). A BMW's number is the car: other numbers are other cars.
        widened.append("trim")
    own = await _lead_own_vehicle(state, ctx, criteria, source) if not bigger else None
    if own is not None and (widened or own.vin not in {r.vin for r in result.loaded(MAX_LOADED)}):
        # Joe Dalton, 26 Oct 2026: Cars.com named the car "540 xDrive", the feed lists it as "5 Series" trim
        # "540i xDrive" - the search widened to any BMW and the lead went to Managerial Review "to confirm it's
        # available" while it was in stock. Zain Faisal, 25 Oct 2026: his grey C 300 wasn't among the 3 newest
        # C 300s loaded, and a silver one was described as "the one you asked about". The lead's own VIN is
        # always the exact match, loaded first.
        result.records = [own, *(r for r in result.records if r.vin != own.vin)]
        result.loosened, widened = [], []
        reasoning.append(f"The lead's own vehicle ({own.vin}) is in stock under the feed's name "
                         f"{' '.join(p for p in (own.make, own.model, own.trim) if p)!r}: shown as the exact match.")
    shown = {v["vin"] for v in ((pack.get("conversation") or {}).get("shown_vehicles") or [])}
    loaded = [{**r.model_dump(), "already_shown": r.vin in shown} for r in result.loaded(MAX_LOADED)]
    original = await _original_inquiry(state, ctx, source, {v["vin"] for v in loaded}) if not bigger else None
    matched_exact = False
    if stock_match.ENABLED and not bigger:
        # The user, 26 Oct 2026: the hybrid search - stock_match.FROM_SEARCH cars from this search, stock_match.
        # FROM_MATCH more from the whole stock scored against the request; Compose picks from them.
        kept = [{**v, "found_by": "search"} for v in loaded[:stock_match.FROM_SEARCH]]
        try:
            extra = await stock_match.candidates(state.dealer_id, criteria, text, k=stock_match.FROM_MATCH,
                                                 exclude={v["vin"] for v in kept})
        except Exception as exc:  # noqa: BLE001 - the step-by-step search's cars still go
            extra = []
            reasoning.append(f"Stock match failed ({exc!r}); the search's cars only.")
        loaded = kept + [{**r.model_dump(), "already_shown": r.vin in shown, "found_by": "match",
                          "match": stock_match.label(points)} for points, r in extra]
        matched_exact = any(points >= stock_match.STRONG for points, _ in extra)
        if extra:
            reasoning.append("Stock match added: " + ", ".join(
                f"{r.vin} ({stock_match.label(p)}, {p:.1f})" for p, r in extra) + ".")
        if matched_exact and widened:
            # The search widened, but the matcher found the car they named under another name: exact after all.
            widened = []
    if not loaded and not result.matched and not result.excluded and (stock_question or asked_trigger) and not bigger:
        # The user, 28 Oct 2026 ("similar car - why the fuck has it not been built"; Manny asked for a Porsche Macan,
        # which this dealer doesn't carry, and got "I'm checking with a manager"): nothing matched, so the closest
        # stock we do have - the same new/used, budget and body type when known - goes to the AI, which must offer it
        # (guard: missing_alternatives).
        closest = InventoryCriteria(condition=criteria.condition, price_max=criteria.price_max,
                                    body_type=criteria.body_type)
        for attempt in (closest, InventoryCriteria(condition=criteria.condition)):  # then without budget / body
            try:
                near = await find_stock(state.dealer_id, attempt, source)
                loaded = [{**r.model_dump(), "already_shown": r.vin in shown, "found_by": "closest"}
                          for r in near.loaded(MAX_LOADED)]
            except Exception as exc:  # noqa: BLE001 - stock is optional for a reply
                reasoning.append(f"The closest-stock search failed ({exc!r}).")
            if loaded:
                closest = attempt
                break
        if loaded:
            widened = widened or ["closest"]
            result.loosened = [*result.loosened, {"step": "closest", "detail": "nothing matched what they asked for: "
                                                  f"the closest stock ({closest.model_dump(exclude_none=True) or 'any'})"}]
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
    if original is not None and widened:  # only when the car they asked for isn't here (Krishna: never otherwise)
        # Betsy, 27 Oct 2026 (Muhamad Nasir asked for an M240 we don't have): "remind the customer they inquired about
        # our M340 and send a link or photos and ask if they still want this vehicle - if not, it needs to be
        # escalated". The car they first asked about joins the list, marked as their original inquiry.
        loaded.append({**original.model_dump(), "already_shown": original.vin in shown, "original_inquiry": True})
        reasoning.append(f"Their original inquiry ({original.vin}, {original.model} {original.trim or ''}) is in "
                         "stock: added to remind them of it.")
    feature = None
    if wants_awd and not bigger:
        feature, extra_awd = await _awd_options(state, criteria, source, loaded, shown)
        loaded = [*loaded, *extra_awd]
        span.output["records"] = loaded
        reasoning.append(f"They asked about all-wheel drive: {feature['their_car'] or 'their car'!s}; "
                         f"{len(extra_awd)} all-wheel-drive car(s) up to {feature['budget_read_as']} added.")
    patched = _patch(pack, loaded, result.final_query, result.checked_at)
    # conversation_7: what was searched, and whether the vehicles loaded are that or the nearest we have - so the
    # reply never says "we don't have X" about a vehicle this turn didn't look for (guardrails/stock_claims.py).
    # A car they named that this dealer doesn't carry (a Porsche Macan) was searched as "what do you have": what we
    # show is the nearest we have, never the car they asked for - so the reply must offer it (guard).
    named_unknown = bool((state.extraction or {}).get("asked_vehicle")) and asked_trigger == \
        "the customer asked what we have" and not (state.extraction or {}).get("browse_stock")
    patched["stock_search"] = {"searched_for": describe_criteria(criteria), "found": len(loaded),
                               "asked": stock_question,
                               "exact": bool(loaded) and not widened and not named_unknown,
                               "showing_instead": describe_criteria(InventoryCriteria(**result.final_query))
                               if widened and loaded else None,
                               **({"feature": feature} if feature else {})}
    return {"context_pack": patched}


async def _awd_options(state: AgentState, criteria: InventoryCriteria, source: Any, loaded: list[dict[str, Any]],
                       shown: set[str]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """What to tell Compose when the customer asks about all-wheel drive, and up to AWD_SHOWN all-wheel-drive cars in
    their budget read loosely (the higher of the budget and the car's price, + 25%) that aren't loaded yet."""
    car = next((v for v in loaded if v.get("found_by") in (None, "search") and not v.get("original_inquiry")), None) \
        or (loaded[0] if loaded else None)
    base = max(criteria.price_max or 0, int((car or {}).get("price") or 0))
    ceiling = int(round(base * (1 + AWD_STRETCH_PERCENT / 100), -2)) if base else None
    have = {v["vin"] for v in loaded}
    extra: list[dict[str, Any]] = []
    try:
        found = await find_stock(state.dealer_id, InventoryCriteria(condition=criteria.condition, drive="AWD",
                                                                    price_max=ceiling), source)
        extra = [{**r.model_dump(), "already_shown": r.vin in shown, "found_by": "all_wheel_drive"}
                 for r in found.loaded(MAX_LOADED) if r.vin not in have][:AWD_SHOWN]
    except Exception:  # noqa: BLE001 - stock is optional for a reply
        extra = []
    their = (car or {}).get("drivetrain")
    name = " ".join(str(x) for x in ((car or {}).get("year"), (car or {}).get("make"), (car or {}).get("model")) if x)
    feature = {
        "asked": "all-wheel drive",
        "their_car": f"the {name} is {their}" if car and their else None,
        "their_car_has_it": their in ("AWD", "4WD") if their else None,
        "budget_read_as": f"${ceiling:,}" if ceiling else "any price",
        "awd_options_loaded": [v["vin"] for v in extra],
        "how_to_answer": ("Answer this first, plainly: does their car have all-wheel drive (xDrive, quattro, 4MATIC... "
                          "are all-wheel drive)? If it doesn't, offer the all-wheel-drive cars loaded (found_by "
                          "all_wheel_drive). Keep the next question about all-wheel drive, not another topic."),
    }
    return feature, extra


async def _original_inquiry(state: AgentState, ctx: TurnContext, source: Any, loaded: set[str]) -> Any:
    """The car on the lead itself (its VIN), in stock and not already in this turn's list; else None."""
    vin = lead_vehicle_vin(ctx.lead, None)
    if not vin or vin in loaded:
        return None
    try:
        return await get_vehicle(state.dealer_id, vin, source)
    except Exception:  # noqa: BLE001 - a reminder is never worth a failed turn
        return None


async def _lead_own_vehicle(state: AgentState, ctx: TurnContext, criteria: InventoryCriteria,
                            source: Any) -> Any:
    """The vehicle the lead itself is about (its VIN), when it is in stock and is what this search named: the same
    make, and the model's first word in the feed's model or trim ("540" in "5 Series 540i xDrive")."""
    vin = lead_vehicle_vin(ctx.lead, None)
    if not vin or not (criteria.make or criteria.model):
        return None
    try:
        record = await get_vehicle(state.dealer_id, vin, source)
    except Exception:  # noqa: BLE001 - the search result stands
        return None
    if record is None:
        return None
    if criteria.make and (record.make or "").lower() != criteria.make.lower():
        return None
    first = (criteria.model or "").split()[0].lower() if criteria.model else ""
    if first and first not in f"{record.model or ''} {record.trim or ''}".lower():
        return None
    return record


def describe_criteria(c: InventoryCriteria) -> str:
    """"2023 Acura RDX", "Hyundai Sonata", "an SUV", "any vehicle": what a search looked for, in words."""
    year = (str(c.year_min) if c.year_min == c.year_max else f"{c.year_min}-{c.year_max}") if c.year_min else None
    named = " ".join(p for p in (year, c.make, c.model, c.trim) if p)
    return named or (c.body_type or (" / ".join(c.body_types) if c.body_types else "")) or "any vehicle"


def _patch(pack: dict[str, Any], records: list[dict[str, Any]], query: dict[str, Any] | None,
           checked_at: str | None) -> dict[str, Any]:
    """The context pack with this turn's stock layers (held back from the models)."""
    budget = dict(pack.get("budget") or {})
    budget["tokens"] = {**(budget.get("tokens") or {}), "inventory": estimate_tokens(str(records)) if records else 0}
    return {**pack, "inventory": records, "inventory_query": query, "inventory_checked_at": checked_at,
            # The turn's own search summary is kept when a later step (a referred vehicle, a link) re-patches.
            "budget": budget, "stock_search": pack.get("stock_search")}
