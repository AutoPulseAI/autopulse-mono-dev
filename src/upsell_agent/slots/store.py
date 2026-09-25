"""Reads and writes slot values in `qualification_facts` (architecture §8.4).

Rules, enforced here and nowhere else:
- Every value records its source: `bot_extracted` (pulled from a customer
  message; must link to that message) or `tool_verified` (a platform record).
- `bot_inferred` values - the AI's own guesses - are refused.
- A new value never overwrites an old one: the old one is closed with
  `valid_to` and `replaced_by`, so history is kept.
- Customer-scope slots belong to the customer across all their leads;
  lead-scope slots (what they want this time) belong to one lead.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.agent.qualification import FactSource
from upsell_agent.integrations.mongodb import QUALIFICATION_FACTS_COLLECTION, DealerScopedDatabase
from upsell_agent.slots.schema import SCHEMA


class RefusedFact(ValueError):
    """The writer refused a value (unknown slot, AI guess, missing source link)."""


@dataclass
class SavedFact:
    id: str
    path: str
    value: Any
    changed: bool  # False when the same value was simply re-stated


def _scope_filter(path: str, customer_id: str, lead_id: str | None) -> dict:
    defn = SCHEMA[path]
    return {"customer_id": customer_id, "path": path, "lead_id": lead_id if defn.scope == "lead" else None}


async def current_facts(db: DealerScopedDatabase, customer_id: str, lead_id: str | None) -> list[dict]:
    """Every current value for this customer, plus this lead's lead-scope values."""
    cursor = db.collection(QUALIFICATION_FACTS_COLLECTION).find(
        {"customer_id": customer_id, "valid_to": None, "lead_id": {"$in": [None, lead_id]}})
    return await cursor.to_list(None)


async def fact_history(db: DealerScopedDatabase, customer_id: str, lead_id: str | None) -> list[dict]:
    cursor = db.collection(QUALIFICATION_FACTS_COLLECTION).find(
        {"customer_id": customer_id, "lead_id": {"$in": [None, lead_id]}, "valid_to": {"$ne": None}})
    return await cursor.to_list(None)


async def save_fact(
    db: DealerScopedDatabase,
    *,
    customer_id: str,
    lead_id: str | None,
    path: str,
    value: Any,
    source: FactSource,
    source_message_id: str | None = None,
    quote: str | None = None,
    confidence: float | None = None,
    pending: bool = False,
    turn_id: str | None = None,
    now: datetime | None = None,
) -> SavedFact:
    if path not in SCHEMA:
        raise RefusedFact(f"unknown slot {path!r}")
    if source == FactSource.BOT_INFERRED:
        raise RefusedFact("AI guesses are never saved (architecture §8.4)")
    if source == FactSource.BOT_EXTRACTED and not source_message_id:
        raise RefusedFact("a value pulled from a message must link to that message")

    now = now or clock.now()
    facts = db.collection(QUALIFICATION_FACTS_COLLECTION)
    scope = _scope_filter(path, customer_id, lead_id)
    current = await facts.find_one({**scope, "valid_to": None})

    if current and current.get("value") == value:
        # Same value again: the customer re-confirmed it. Fresh again, and a
        # confident restatement clears a pending confirmation.
        update: dict[str, Any] = {"observed_at": now}
        if current.get("pending") and not pending:
            update["pending"] = False
            update["confirmed_at"] = now
        await facts.update_one({"_id": current["_id"]}, {"$set": update})
        return SavedFact(str(current["_id"]), path, value, changed=False)

    new_id = ObjectId()
    await facts.insert_one({
        "_id": new_id, **scope, "value": value, "source": source.value, "source_message_id": source_message_id,
        "quote": quote, "confidence": confidence, "pending": pending, "turn_id": turn_id,
        "valid_from": now, "observed_at": now, "valid_to": None, "replaced_by": None, "created_at": now,
    })
    if current:
        await facts.update_one({"_id": current["_id"]},
                               {"$set": {"valid_to": now, "replaced_by": str(new_id)}})
    return SavedFact(str(new_id), path, value, changed=True)


async def confirm_fact(db: DealerScopedDatabase, fact_id: str) -> None:
    await db.collection(QUALIFICATION_FACTS_COLLECTION).update_one(
        {"_id": ObjectId(fact_id), "valid_to": None},
        {"$set": {"pending": False, "confirmed_at": clock.now(), "observed_at": clock.now()}})


async def reject_fact(db: DealerScopedDatabase, fact_id: str) -> None:
    """The customer said a value we asked them to confirm is wrong."""
    await db.collection(QUALIFICATION_FACTS_COLLECTION).update_one(
        {"_id": ObjectId(fact_id), "valid_to": None},
        {"$set": {"valid_to": clock.now(), "rejected": True}})
