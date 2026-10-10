"""The CRM conversation in the AI's memory (PLAN_4 stream X3 item 5, audit 4 B3/B4/B5).

The AI used to read only its own `ai_messages`. Staff replies, staff notes, n8n / CRM follow-ups and reminders and
campaign texts never entered its thread, so after "hand back to AI" it could contradict or repeat what staff said;
a lead already open when the dealer went `live` was answered with no memory at all.

Before every turn (agent/nodes/load_context.py), `sync_lead_history` copies the lead's CRM conversation (`emails`)
that the AI did not write into `ai_messages`, marked by author:
- `staff`      a person replied from the CRM (`message_by` set);
- `staff_note` an internal note (`is_note` / communication_type "note"): direction "note", never shown to the
               customer and never quoted to them;
- `campaign`   a campaign text;
- `crm`        anything else the CRM sent by itself (n8n auto-reply, FollowUpJob, appointment reminder);
- `customer`   the customer's own messages - only on the lead's FIRST sync (its history from before the AI saw
               it), and only those well before the AI's first turn. Later customer messages always come as
               events (or the reconciliation sweep, scheduler/reconcile.py), so a sync never marks one answered.

Bounded: the first sync imports the newest HISTORY_IMPORT_LIMIT records and notes how many older ones exist (the
rolling summary covers what falls out of working memory); later syncs import only what is newer than the last one.
Idempotent: one `ai_messages` row per CRM record (`platform_message_id`).

A returning customer's new lead gets a short summary of their previous lead's conversation
(`previous_lead_summary`), shown with the rolling summary.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.agent.customer_key import find_customer_leads
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
)

PLATFORM_EMAILS_COLLECTION = "emails"
HISTORY_IMPORT_LIMIT = 40
SYNC_LIMIT = 50
# Customer messages imported on the first sync must be at least this much older than the AI's first turn; newer
# ones are answered as events, never silently marked as handled.
CUSTOMER_IMPORT_MARGIN = timedelta(hours=1)
PREVIOUS_LEAD_MESSAGES = 6
PREVIOUS_SUMMARY_MAX = 600
MAX_TEXT = 2000


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _at(row: dict) -> datetime | None:
    return _aware(row.get("timestamp")) or _aware(row.get("date"))


def author_of(row: dict) -> str:
    """Who wrote a CRM conversation record (see the module docstring)."""
    if row.get("is_note") or row.get("communication_type") == "note":
        return "staff_note"
    if str(row.get("status") or "").lower() in ("incoming", "received"):
        return "customer"
    if row.get("campaign_id") or row.get("is_campaign") or row.get("campaign"):
        return "campaign"
    if row.get("message_by"):
        return "staff"
    return "crm"


def _channel(row: dict) -> str:
    return "sms" if row.get("communication_type") == "sms" else "email"


def _text(row: dict) -> str:
    return str(row.get("mail_content") or row.get("body") or "").strip()[:MAX_TEXT]


async def sync_lead_history(db: DealerScopedDatabase, *, lead_id: str, customer_id: str | None,
                            lead_state: dict | None) -> dict[str, Any]:
    """Copies the lead's CRM conversation that the AI didn't write into `ai_messages`. Returns counts."""
    state = lead_state or {}
    first = not state.get("history_synced_at")
    since = _aware(state.get("history_synced_until"))
    flt: dict[str, Any] = {"lead_id": {"$in": [as_object_id(lead_id), lead_id]}, "ai_generated": {"$ne": True}}
    if since and not first:
        flt["timestamp"] = {"$gt": since}
    emails = db.collection(PLATFORM_EMAILS_COLLECTION)
    limit = HISTORY_IMPORT_LIMIT if first else SYNC_LIMIT
    rows = await emails.find(flt).sort("timestamp", -1).to_list(limit + 1)
    older = len(rows) > limit
    rows = sorted(rows[:limit], key=lambda r: _at(r) or datetime.min.replace(tzinfo=UTC))
    started = _aware(state.get("created_at")) or clock.now()
    messages = db.collection(AI_MESSAGES_COLLECTION)
    imported = 0
    newest = since
    for row in rows:
        at = _at(row) or clock.now()
        newest = max(newest, at) if newest else at
        author = author_of(row)
        text = _text(row)
        if not text:
            continue
        if author == "staff_note" and row.get("internal_use") is True:
            # Client, 10 Oct 2026: a note marked internal is for the team only - the AI never reads it, so it can never
            # shape a reply. Unmarked notes are read as before.
            continue
        doc: dict[str, Any] = {"lead_id": lead_id, "customer_id": customer_id, "channel": _channel(row),
                               "text": text, "platform_message_id": str(row["_id"]), "created_at": at,
                               "author": author, "imported": True}
        if author == "customer":
            if not first or at > started - CUSTOMER_IMPORT_MARGIN:
                continue  # answered as an event, never marked handled here
            doc.update(direction="inbound", answered_turn_id="imported")
        elif author == "staff_note":
            doc.update(direction="note", status="sent", sent_at=at)
        else:
            doc.update(direction="outbound", status="sent", sent_at=at)
        saved = await messages.update_one({"platform_message_id": doc["platform_message_id"]},
                                          {"$setOnInsert": doc}, upsert=True)
        imported += int(saved.upserted_id is not None)
    fields: dict[str, Any] = {"history_synced_at": clock.now()}
    if newest:
        fields["history_synced_until"] = newest
    if first and older:
        fields["history_older_not_loaded"] = True
    if first and customer_id and (
            previous := await previous_lead_summary(db, customer_id=customer_id, lead_id=lead_id)):
        fields["previous_lead_summary"] = previous
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": fields, "$setOnInsert": {"lead_id": lead_id, "created_at": clock.now()}},
        upsert=True)
    return {"first": first, "imported": imported, "older_not_loaded": first and older}


async def previous_lead_summary(db: DealerScopedDatabase, *, customer_id: str, lead_id: str) -> str | None:
    """A short summary of the customer's most recent OTHER lead's conversation, for a returning customer."""
    leads = [lead for lead in await find_customer_leads(db, customer_id) if str(lead["_id"]) != lead_id]
    leads = [lead for lead in leads if as_object_id(str(lead["_id"])) != as_object_id(lead_id)]
    if not leads:
        return None
    previous = max(leads, key=lambda lead: lead["_id"])
    prev_id = str(previous["_id"])
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": prev_id}) or {}
    when = _aware(previous.get("createdAt")) or _aware(previous.get("created_at"))
    head = f"Previous lead ({when:%b %d, %Y})" if when else "Previous lead"
    if stage := state.get("stage"):
        head += f", ended at {str(stage).replace('_', ' ')}"
    if (summary := (state.get("summary") or {}).get("text")):
        return f"{head}: {summary}"[:PREVIOUS_SUMMARY_MAX]
    rows = await db.collection(AI_MESSAGES_COLLECTION).find(
        {"lead_id": prev_id, "direction": {"$in": ["inbound", "outbound"]}}).sort("created_at", -1).to_list(
        PREVIOUS_LEAD_MESSAGES)
    if not rows:
        return None
    lines = [f"{'customer' if r['direction'] == 'inbound' else (r.get('author') or 'us')}: "
             f"{' '.join(str(r.get('text') or '').split())[:120]}" for r in reversed(rows)]
    return f"{head}. Last messages - " + " | ".join(lines)[:PREVIOUS_SUMMARY_MAX]
