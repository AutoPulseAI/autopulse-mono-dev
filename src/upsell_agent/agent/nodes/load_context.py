"""Load context (architecture §7): everything the turn needs, from MongoDB,
built into one context pack (agent/context_pack.py) that Extract and Compose
both read.

- the lead type (set in code from the lead's source, slots/requirements.py)
- on the lead's first turn, pre-fill slots from the platform's Customer 360
- the customer's profile: current slot values and their states
- the dealer's name, timezone and local time (integrations/dealer_profile.py)
- the new messages this turn answers, and the conversation before them
  within the working-memory budget
- the conversation state: asks, open questions, promises (agent/conversation.py)
- the rolling summary of what came before working memory (agent/summary.py)
- the campaign the customer is replying to, if any (Stage 9)

Stock is not loaded here: Search stock (agent/nodes/search_stock.py) runs
after Validate so it sees this turn's message (MASTER_PLAN_3 Phase 2).
"""

from typing import Any

from upsell_agent import clock
from upsell_agent.agent.campaigns import find_campaign_context
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.context_pack import (
    LOAD_LIMIT,
    PackMessage,
    build_pack,
    clean_email_text,
    to_pack_message,
)
from upsell_agent.agent.conversation import load_conversation
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.summary import load_summary, summary_behind
from upsell_agent.agent.templates import first_name
from upsell_agent.integrations.dealer_profile import dealer_profile
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    as_object_id,
)
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.prefill import prefill_from_360
from upsell_agent.slots.profile import build_profile
from upsell_agent.slots.requirements import lead_type_for
from upsell_agent.slots.store import current_facts, fact_history

# Only what the customer actually received, plus everything they sent.
_THREAD = {"$or": [{"direction": "inbound"}, {"direction": "outbound", "status": "sent"}]}


async def load_profile(ctx: TurnContext, state: AgentState):
    lead_type = lead_type_for(ctx.lead)
    current = await current_facts(ctx.db, state.customer_id, state.lead_id)
    history = await fact_history(ctx.db, state.customer_id, state.lead_id)
    return build_profile(lead_type, current, history)


async def _new_messages(ctx: TurnContext, state: AgentState) -> tuple[list[PackMessage], dict[str, Any]]:
    """The customer messages this turn answers, and the filter that keeps
    them out of the history."""
    messages = ctx.db.collection(AI_MESSAGES_COLLECTION)
    if state.new_message_ids:
        ids = [as_object_id(i) for i in state.new_message_ids]
        rows = await messages.find({"_id": {"$in": ids}}).to_list(None)
        rows.sort(key=lambda r: r["created_at"])
        return [to_pack_message(r) for r in rows], {"_id": {"$nin": ids}}
    text = state.inbound_text.strip()
    if state.trigger == "lead_created":
        found = [PackMessage(direction="inbound", channel=state.channel or "sms", text=text, source="lead_form")]
        return (found if text else []), {}
    # A turn started without the batch's ids (a direct call): the batch is
    # whatever no turn has answered yet.
    if state.channel == "email":
        text = clean_email_text(text)
    found = [PackMessage(direction="inbound", channel=state.channel or "sms", text=text)] if text else []
    return found, {"$nor": [{"direction": "inbound", "answered_turn_id": None}]}


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

    new_messages, exclude = await _new_messages(ctx, state)
    history: list[PackMessage] = []
    rows: list[dict[str, Any]] = []
    more_not_loaded = False
    if state.lead_id:
        rows = await ctx.db.collection(AI_MESSAGES_COLLECTION).find(
            {"lead_id": state.lead_id, **_THREAD, **exclude}).sort("created_at", -1).to_list(LOAD_LIMIT + 1)
        more_not_loaded = len(rows) > LOAD_LIMIT
        rows = rows[:LOAD_LIMIT]
        rows.reverse()
        history = [to_pack_message(r) for r in rows]
    summary = load_summary(ctx.lead_state)

    campaign = await find_campaign_context(ctx.db, customer_id=state.customer_id)
    dealer = await dealer_profile(state.dealer_id)
    conversation = load_conversation(ctx.lead_state)
    pack = build_pack(
        now_local=clock.now().astimezone(dealer.tz),
        dealer={"name": dealer.name, "timezone": dealer.timezone, "info": dealer.public_info()},
        customer={"first_name": first_name(state.customer_name), "channel": state.channel},
        lead_type=profile.effective_lead_type.value,
        profile=profile.to_api(),
        new_messages=new_messages,
        history=history,
        more_not_loaded=more_not_loaded,
        conversation=conversation,
        campaign=campaign,
        working_tokens=ctx.settings.context_working_tokens,
        summary=summary.text,
        summary_covers=summary.messages,
    )
    pack.budget.summary_behind = summary_behind(rows, pack.budget.kept, more_not_loaded, summary)

    budget = pack.budget
    reasoning.append(f"{len(pack.new_messages)} new message(s) to answer"
                     + (" (the lead form's comments)." if new_messages and new_messages[0].source == "lead_form" else "."))
    reasoning.append(f"Working memory: {budget.kept} of {budget.loaded} earlier message(s), about "
                     f"{budget.working_used} of {budget.working_tokens} tokens"
                     + (f"; {budget.dropped} older left out" if budget.dropped else "")
                     + ("; more history exists beyond the load limit" if budget.more_not_loaded else "")
                     + (f"; {budget.trimmed_messages} long message(s) cut" if budget.trimmed_messages else "") + ".")
    if summary.text:
        reasoning.append(f"Summary of the {summary.messages} message(s) before working memory ({len(summary.text)} characters).")
    if pack.budget.summary_behind:
        reasoning.append("Older messages aren't in the summary yet: it will be updated after this turn's send.")
    if conversation.open_questions:
        reasoning.append(f"{len(conversation.open_questions)} customer question(s) still open from earlier.")
    if conversation.last_asked:
        reasoning.append(f"Our last reply asked for: {', '.join(conversation.last_asked)}.")
    reasoning.append(f"Dealer time: {pack.now['weekday']} {pack.now['date']} {pack.now['time']} ({dealer.timezone}).")
    reasoning.append(f"Campaign found: replying to '{campaign['name']}'." if campaign else "No campaign in the last 14 days.")

    span.output = {
        "lead_type": lead_type.value,
        "effective_lead_type": profile.effective_lead_type.value,
        "prefilled": prefilled,
        "filled_slots": sorted(p for p, s in profile.slots.items() if s.state == "filled"),
        "stale_slots": sorted(p for p, s in profile.slots.items() if s.state == "stale"),
        "needs_confirming": [s.path for s in profile.pending()],
        "required": {"filled": filled, "total": total},
        "messages_loaded": budget.loaded,
        "campaign": campaign,
        "context": {"budget": budget.model_dump(), "now": pack.now, "conversation": conversation.model_dump()},
        # The whole pack, exactly as the AI steps see it. Kept only where
        # prompts are stored (DEV); production traces drop "prompt".
        "prompt": {"context_pack": pack.for_prompt()},
    }
    span.reasoning = reasoning
    span.edge_label = f"{lead_type.value} · {filled}/{total}" + (" · campaign" if campaign else "")
    return {"lead_type": lead_type, "profile": profile.to_api(), "campaign": campaign,
            "context_pack": pack.model_dump(mode="json"), "customer_text": pack.customer_text()}
