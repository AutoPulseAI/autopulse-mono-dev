"""One AI workflow per customer (MASTER_PLAN_3 C6, Omnichannel PDF §15,
architecture §15 decisions 173-174).

A customer who submits twice (two vehicle pages, two portals) makes two platform
leads. The platform keeps both (it is not merged or changed here: scope, 27 Sept);
on our side only the OLDEST open lead runs the AI workflow. A newer lead for
the same customer is *linked* to it:

- it gets no first reply, no cadence and no timers (`ai_lead_state.duplicate_of`
  names the primary; status `paused`, so nothing is sent on it);
- the primary's state lists it under `linked_leads`, with a staff notice;
- the customer's own messages always land on the primary, even when the
  platform threaded them to the newer lead (`workflow_lead_id`).

"Same customer" is the same platform customer id, or the same phone / email on
the lead (the platform makes a new customer per form sometimes). A primary that
is closed, sold or opted out no longer counts: a lead that arrives after that
starts its own workflow, like any new lead (lifecycle.py).
"""

import re
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import lifecycle
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
)

# Stages after which a lead's workflow is over: a newer lead doesn't link to it.
_FINISHED = {lifecycle.Stage.CLOSED_LOST.value, lifecycle.Stage.OPTED_OUT.value,
             lifecycle.Stage.SOLD_PENDING.value, lifecycle.Stage.SOLD_DELIVERED.value,
             lifecycle.Stage.CLOSED_NO_LONGER_OWNS.value}


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))[-10:]


def _phone_variants(value: Any) -> list[str]:
    digits = _digits(value)
    if len(digits) < 10:
        return []
    return list({str(value).strip(), digits, f"+1{digits}", f"1{digits}"})


async def _same_customer_leads(db: DealerScopedDatabase, lead: dict) -> list[dict]:
    """Other platform leads (older ones) of the same customer, phone or email."""
    ors: list[dict[str, Any]] = []
    if customer_id := lead.get("customer_id"):
        ors.append({"customer_id": {"$in": [str(customer_id), as_object_id(str(customer_id))]}})
    if variants := _phone_variants(lead.get("phone")):
        ors.append({"phone": {"$in": variants}})
    if email := str(lead.get("email") or "").strip().lower():
        ors.append({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
    if not ors:
        return []
    return await db.collection(PLATFORM_LEADS_COLLECTION).find(
        {"$or": ors, "_id": {"$lt": lead["_id"]}}).to_list(None)


async def find_primary(db: DealerScopedDatabase, lead: dict | None) -> dict | None:
    """The oldest open lead with an AI workflow for the same customer, as its state; None when this
    lead is the one to run."""
    if not lead or lead.get("_id") is None:
        return None
    candidates = await _same_customer_leads(db, lead)
    if not candidates:
        return None
    states = await db.collection(AI_LEAD_STATE_COLLECTION).find(
        {"lead_id": {"$in": [str(c["_id"]) for c in candidates]}}).to_list(None)
    open_states = [s for s in states if not s.get("duplicate_of") and s.get("stage") not in _FINISHED]
    if not open_states:
        return None
    return min(open_states, key=lambda s: as_object_id(s["lead_id"]))


async def link_duplicate(db: DealerScopedDatabase, lead_id: str, customer_id: str | None,
                         primary: dict) -> dict[str, Any]:
    """Records that `lead_id` is a duplicate of the primary's lead; nothing else about it runs."""
    now = clock.now()
    primary_id = primary["lead_id"]
    states = db.collection(AI_LEAD_STATE_COLLECTION)
    await states.update_one(
        {"lead_id": lead_id},
        {"$set": {"duplicate_of": primary_id, "duplicate_linked_at": now, "status": "paused",
                  "status_reason": f"Duplicate of lead {primary_id}: the AI works that lead", "status_at": now},
         "$setOnInsert": {"lead_id": lead_id, "customer_id": customer_id, "created_at": now}},
        upsert=True)
    await states.update_one(
        {"lead_id": primary_id, "linked_leads.lead_id": {"$ne": lead_id}},
        {"$push": {"linked_leads": {"lead_id": lead_id, "at": now}},
         "$set": {"staff_notice": {"at": now, "kind": "duplicate_lead",
                                   "text": f"A new lead ({lead_id}) came in from the same customer. It is linked "
                                           "to this one; the AI keeps working this lead only."}}})
    return {"duplicate_of": primary_id, "lead_id": lead_id}


async def workflow_lead_id(db: DealerScopedDatabase, lead_id: str | None) -> str | None:
    """The lead whose workflow handles things for `lead_id`: itself, or its primary while that is open."""
    if not lead_id:
        return lead_id
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}, projection={
        "duplicate_of": 1})
    primary_id = (state or {}).get("duplicate_of")
    if not primary_id:
        return lead_id
    primary = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": primary_id}, projection={
        "stage": 1})
    if primary and primary.get("stage") not in _FINISHED:
        return primary_id
    return lead_id
