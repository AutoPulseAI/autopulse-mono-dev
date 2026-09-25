"""Load context (architecture §7): everything the turn needs, from MongoDB.

- the lead type (set in code from the lead's source, slots/requirements.py)
- on the lead's first turn, pre-fill slots from the platform's Customer 360
- the customer's profile: current slot values and their states
- the last 20 messages of the conversation
- the campaign the customer is replying to, if any (Stage 9)
"""

from typing import Any

from upsell_agent.agent.campaigns import find_campaign_context
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.state import AgentState
from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION, AI_MESSAGES_COLLECTION
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.prefill import prefill_from_360
from upsell_agent.slots.profile import build_profile
from upsell_agent.slots.requirements import lead_type_for
from upsell_agent.slots.store import current_facts, fact_history

RECENT_MESSAGES = 20


async def load_profile(ctx: TurnContext, state: AgentState):
    lead_type = lead_type_for(ctx.lead)
    current = await current_facts(ctx.db, state.customer_id, state.lead_id)
    history = await fact_history(ctx.db, state.customer_id, state.lead_id)
    return build_profile(lead_type, current, history)


async def load_context(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    reasoning: list[str] = []
    lead_type = lead_type_for(ctx.lead)
    source = (ctx.lead or {}).get("source")
    reasoning.append(f"Lead type '{lead_type.value}' from the lead ({'explicit type' if (ctx.lead or {}).get('data', {}).get('lead_type') else f'source {source!r}'}).")

    prefilled: list[dict[str, Any]] = []
    if state.lead_id and not (ctx.lead_state or {}).get("prefilled_at"):
        try:
            data = await ctx.platform.get_customer_360(state.dealer_id, state.customer_id)
        except Exception as exc:  # noqa: BLE001 - the platform being down must not stop a reply
            data = None
            reasoning.append(f"Customer 360 unavailable ({exc!r}); continuing without pre-fill.")
        prefilled = await prefill_from_360(ctx.db, customer_id=state.customer_id, lead_id=state.lead_id,
                                           data=data, turn_id=state.turn_id)
        await ctx.db.collection(AI_LEAD_STATE_COLLECTION).update_one(
            {"lead_id": state.lead_id}, {"$set": {"prefilled_at": ctx.tracer.log["created_at"]}})
        reasoning.append(f"First turn: pre-filled {len(prefilled)} slot(s) from Customer 360"
                         + (f" ({', '.join(p['path'] for p in prefilled)})." if prefilled else "."))

    profile = await load_profile(ctx, state)
    states: dict[str, int] = {}
    for slot in profile.slots.values():
        states[slot.state] = states.get(slot.state, 0) + 1
    filled, total = profile.progress()
    reasoning.append(f"Profile: {', '.join(f'{n} {s}' for s, n in sorted(states.items())) or 'empty'}; "
                     f"{filled} of {total} required details collected.")

    rows = await ctx.db.collection(AI_MESSAGES_COLLECTION).find({"lead_id": state.lead_id}).to_list(None) \
        if state.lead_id else []
    rows = [r for r in rows if r["direction"] == "inbound" or r.get("status") == "sent"]
    rows.sort(key=lambda r: r.get("sent_at") or r["created_at"])
    recent = [{"direction": r["direction"], "channel": r["channel"], "text": r["text"]} for r in rows[-RECENT_MESSAGES:]]
    reasoning.append(f"Loaded {len(recent)} recent message(s).")

    campaign = await find_campaign_context(ctx.db, customer_id=state.customer_id)
    reasoning.append(f"Campaign found: replying to '{campaign['name']}'." if campaign else "No campaign in the last 14 days.")

    span.output = {
        "lead_type": lead_type.value,
        "effective_lead_type": profile.effective_lead_type.value,
        "prefilled": prefilled,
        "filled_slots": sorted(p for p, s in profile.slots.items() if s.state == "filled"),
        "stale_slots": sorted(p for p, s in profile.slots.items() if s.state == "stale"),
        "needs_confirming": [s.path for s in profile.pending()],
        "required": {"filled": filled, "total": total},
        "messages_loaded": len(recent),
        "campaign": campaign,
    }
    span.reasoning = reasoning
    span.edge_label = f"{lead_type.value} · {filled}/{total}" + (" · campaign" if campaign else "")
    return {"lead_type": lead_type, "profile": profile.to_api(), "recent_messages": recent, "campaign": campaign}
