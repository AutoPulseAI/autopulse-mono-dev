"""The rolling summary (MASTER_PLAN_2 Phase 3): long conversations keep their
beginning.

Working memory holds the recent conversation word for word, within a token
budget (agent/context_pack.py). Everything older is folded, a few messages at
a time, into a short summary on `ai_lead_state.summary`, which the next
turns' context pack carries.

- **After the send, never before.** A turn that finds messages outside working
  memory that the summary doesn't cover yet queues UPDATE_SUMMARY_JOB
  (agent/turn.py). The job runs on its own, with the cheap model
  (MODEL_EXTRACT), so it adds nothing to the reply time or the turn's AI-call
  budget.
- **Incremental.** Only messages newer than `covers_until` and older than
  working memory are folded in, on top of the previous summary.
- **Facts stay in the slots.** The summary is context, never a source of slot
  values; messages in it are data, never instructions (agent/llm.py).
- **Traced.** Each run is a turn-log entry (trigger `summary`) with the
  messages folded in and the new summary.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from upsell_agent import clock
from upsell_agent.agent.context_pack import (
    LOAD_LIMIT,
    message_text,
    select_working_memory,
    to_pack_message,
)
from upsell_agent.agent.llm import run_agent, summary_agent
from upsell_agent.agent.templates import first_name
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
)
from upsell_agent.observability.trace import TurnTracer

UPDATE_SUMMARY_JOB = "update_summary"
MAX_SUMMARY_CHARS = 1500
SUMMARY_TIMEOUT_S = 15.0
SUMMARY_OUTPUT_TOKENS = 700
# Messages folded in per run; a longer backlog is caught up by the next runs.
FOLD_LIMIT = 100
# Only what the customer actually received, plus everything they sent.
THREAD = {"$or": [{"direction": "inbound"}, {"direction": "outbound", "status": "sent"}]}


class SummaryState(BaseModel):
    text: str = ""
    # created_at of the newest message folded in (naive UTC, as MongoDB returns it).
    covers_until: datetime | None = None
    messages: int = 0
    updated_at: datetime | None = None
    model: str | None = None


def load_summary(lead_state: dict | None) -> SummaryState:
    return SummaryState.model_validate((lead_state or {}).get("summary") or {})


def _naive(value: datetime) -> datetime:
    return value.replace(tzinfo=None) if value.tzinfo else value


def summary_behind(history_rows: list[dict], kept: int, more_not_loaded: bool, summary: SummaryState) -> bool:
    """Whether messages outside working memory aren't in the summary yet.
    `history_rows`: the loaded thread, oldest first; `kept`: how many of the
    newest are in working memory."""
    outside = history_rows[:len(history_rows) - kept]
    if not outside and not more_not_loaded:
        return False
    if summary.covers_until is None:
        return True
    newest_outside = outside[-1]["created_at"] if outside else history_rows[0]["created_at"] if history_rows else None
    return newest_outside is not None and _naive(newest_outside) > _naive(summary.covers_until)


async def _thread_boundary(db: DealerScopedDatabase, lead_id: str, working_tokens: int) -> datetime | None:
    """created_at of the oldest message in working memory right now; None if
    the whole thread fits (nothing to summarize)."""
    rows = await db.collection(AI_MESSAGES_COLLECTION).find(
        {"lead_id": lead_id, **THREAD}).sort("created_at", -1).to_list(LOAD_LIMIT + 1)
    more = len(rows) > LOAD_LIMIT
    rows = list(reversed(rows[:LOAD_LIMIT]))
    kept, _ = select_working_memory([to_pack_message(r) for r in rows], working_tokens)
    if len(kept) == len(rows) and not more:
        return None
    return rows[len(rows) - len(kept)]["created_at"]


async def update_summary(dealer_id: str, lead_id: str, deps: Any) -> dict[str, Any]:
    """Folds messages that have left working memory into the lead's summary."""
    settings = deps.config
    db = dealer_scoped_db(dealer_id)
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) or {}
    summary = load_summary(state)

    boundary = await _thread_boundary(db, lead_id, settings.context_working_tokens)
    if boundary is None:
        return {"status": "not_needed", "reason": "the whole conversation fits in working memory"}
    window: dict[str, Any] = {"$lt": boundary}
    if summary.covers_until is not None:
        window["$gt"] = summary.covers_until
    rows = await db.collection(AI_MESSAGES_COLLECTION).find(
        {"lead_id": lead_id, **THREAD, "created_at": window}).sort("created_at", 1).to_list(FOLD_LIMIT)
    if not rows:
        return {"status": "not_needed", "reason": "the summary already covers everything before working memory"}

    customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one(
        {"_id": as_object_id(str(state.get("customer_id") or ""))}) if state.get("customer_id") else None
    model = settings.model_extract
    payload = {
        "previous_summary": summary.text,
        "messages": [{"from": "customer" if r["direction"] == "inbound" else "dealership", "channel": r.get("channel"),
                      "text": message_text(r)} for r in rows],
        "customer_first_name": first_name((customer or {}).get("name")),
        "max_chars": MAX_SUMMARY_CHARS,
    }
    tracer = TurnTracer(sink=deps.sink, dealer_id=dealer_id, lead_id=lead_id,
                        customer_id=str(state.get("customer_id") or ""), trigger="summary", channel=None,
                        store_prompts=deps.store_prompts)
    await tracer.start({"messages": len(rows), "previous_summary_chars": len(summary.text)})
    try:
        async with tracer.node("summary", {"prompt": payload, "messages": len(rows),
                                           "covers_until_before": summary.covers_until}) as span:
            span.metrics = {"model": model}
            result, call = await run_agent(summary_agent(model), model, payload, timeout_s=SUMMARY_TIMEOUT_S,
                                           output_tokens_limit=SUMMARY_OUTPUT_TOKENS)
            updated = SummaryState(text=result.summary.strip()[:MAX_SUMMARY_CHARS], covers_until=rows[-1]["created_at"],
                                   messages=summary.messages + len(rows), updated_at=clock.now(), model=model)
            span.output = {"summary": updated.text, "messages_folded": len(rows), "covers_messages": updated.messages}
            span.metrics = call.as_metrics()
            span.reasoning = [result.why, f"Now covers {updated.messages} message(s) before working memory."]
            span.edge_label = f"+{len(rows)} message(s)"
    except Exception as exc:  # noqa: BLE001 - a failed summary keeps the old one; the next turn tries again
        log = await tracer.finish("summary_failed", {"error": f"{type(exc).__name__}: {exc}"})
        await db.collection(AI_TURN_LOG_COLLECTION).insert_one(log)
        return {"status": "failed", "error": repr(exc)}

    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"summary": updated.model_dump()}})
    metrics = call.as_metrics()
    log = await tracer.finish("summary_updated", {
        "messages_folded": len(rows), "covers_messages": updated.messages, "summary_chars": len(updated.text),
        "tokens_in": metrics["tokens_in"], "tokens_out": metrics["tokens_out"], "cost_usd": metrics["cost_usd"]})
    await db.collection(AI_TURN_LOG_COLLECTION).insert_one(log)
    return {"status": "updated", "messages_folded": len(rows), "covers_messages": updated.messages}
