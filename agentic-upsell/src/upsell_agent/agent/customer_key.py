"""The customer id when the CRM has no Customer record (PLAN_4 stream X3 item 1).

Production's `Lead` has no `customer_id` (only the newer customerResolver.js links one). The CRM then sends a key
derived from the lead's normalised phone (else email), per dealer, and stores it on the Lead as `ai_customer_key`
(aidmvcs-be-dev app/lib/ai/aiDispatch.js `derivedCustomerKey`; both sides must give the same key). The AI keeps its
own customer identity, facts, consent and duplicate links under that key, exactly as under a CRM customer id.

- `derived_customer_key` is the same rule as the CRM's.
- `lead_customer_id(lead, dealer_id)` is the id for a platform lead: its CRM link, else its stored key, else the
  derived one.
- `leads_filter(customer_id)` finds a customer's platform leads by either.
"""

import hashlib
import re
from typing import Any

from bson import ObjectId

DERIVED_PREFIX = "ck_"
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def normalise_phone(value: Any) -> str | None:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[-10:] if len(digits) >= 10 else None


def normalise_email(value: Any) -> str | None:
    email = str(value or "").strip().lower()
    if not _EMAIL.match(email) or re.fullmatch(r"n/?a", email):
        return None
    return email


def derived_customer_key(dealer_id: Any, phone: Any = None, email: Any = None) -> str | None:
    phone_key = normalise_phone(phone)
    email_key = None if phone_key else normalise_email(email)
    basis = f"p:{phone_key}" if phone_key else f"e:{email_key}" if email_key else None
    if not dealer_id or not basis:
        return None
    digest = hashlib.sha256(f"{dealer_id}|{basis}".encode()).hexdigest()
    return f"{DERIVED_PREFIX}{digest[:24]}"


def is_derived(customer_id: Any) -> bool:
    return str(customer_id or "").startswith(DERIVED_PREFIX)


def lead_customer_id(lead: dict | None, dealer_id: Any = None) -> str | None:
    if not lead:
        return None
    if lead.get("customer_id"):
        return str(lead["customer_id"])
    if lead.get("ai_customer_key"):
        return str(lead["ai_customer_key"])
    return derived_customer_key(dealer_id or lead.get("dealer_id"), lead.get("phone"), lead.get("email"))


def id_values(customer_id: str) -> list[Any]:
    """The values a platform `customer_id` field may hold for this id (string and ObjectId)."""
    customer_id = str(customer_id)
    return [customer_id, ObjectId(customer_id)] if ObjectId.is_valid(customer_id) else [customer_id]


def leads_filter(customer_id: Any) -> dict[str, Any]:
    """A Mongo filter for the customer's platform leads: the CRM link or the AI key stored on the lead."""
    customer_id = str(customer_id)
    if is_derived(customer_id):
        return {"$or": [{"ai_customer_key": customer_id}, {"customer_id": customer_id}]}
    return {"customer_id": {"$in": id_values(customer_id)}}


async def find_customer_leads(db: Any, customer_id: Any) -> list[dict]:
    """The customer's platform leads (dealer-scoped `db`): by `leads_filter`, plus - for a derived key - every lead
    the AI has seen under it (`ai_lead_state.customer_id`), in case the CRM could not store the key on the lead."""
    from upsell_agent.integrations.mongodb import (
        AI_LEAD_STATE_COLLECTION,
        PLATFORM_LEADS_COLLECTION,
        as_object_id,
    )

    flt = leads_filter(customer_id)
    if is_derived(customer_id):
        seen = [as_object_id(s["lead_id"]) for s in await db.collection(AI_LEAD_STATE_COLLECTION).find(
            {"customer_id": str(customer_id)}, projection={"lead_id": 1}).to_list(None) if s.get("lead_id")]
        if seen:
            flt = {"$or": [*flt["$or"], {"_id": {"$in": seen}}]}
    return await db.collection(PLATFORM_LEADS_COLLECTION).find(flt).to_list(None)
