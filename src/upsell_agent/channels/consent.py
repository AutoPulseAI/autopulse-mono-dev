"""Consent records and who to message (architecture §9, MASTER_PLAN_3 C1
item 2, architecture §15 decisions 36, 76 and 77).

**Add-only history.** `ai_consent` is a list of entries, never edited or
deleted by this service: every change (a STOP, a START, a possible opt-out
sent to review, a lead-form consent line) is a new entry. The current state
is the latest entry for a customer, channel and `consent_type`:

- `opt_out`: `opted_out` / `opted_in` (STOP / START, a natural-language
  opt-out, a provider reporting an unsubscribe).
- `marketing_consent`: `granted` / `denied` / `review_required`, with the
  evidence it came from (the platform's opt-in flag, the lead form's
  `TCPAOptIn` line).
- `review`: `open` / `resolved`, channel `all` (an unclear opt-out, C1 item 3).

Each entry keeps the client's evidence fields (`consent_status`,
`consent_type`, `consent_timestamp`, `consent_source`,
`consent_text_version`, `consent_evidence_id`, `consenting_seller_id`,
`source_url`). Kept at least 5 years (decision 77): nothing here deletes them.

The send check itself is compliance/engine.py. This module also resolves the
address to send to, preferring the lead's own contact details over the
customer's primary ones.
"""

import re
from datetime import datetime
from typing import Any, Literal

from pymongo.errors import DuplicateKeyError

from upsell_agent import clock
from upsell_agent.compliance.opt_out import (
    classify_keyword,  # noqa: F401 - kept for existing imports
)
from upsell_agent.integrations.mongodb import AI_CONSENT_COLLECTION, DealerScopedDatabase, get_db

Channel = Literal["sms", "email"]
ConsentType = Literal["opt_out", "marketing_consent", "review"]

# Lead-form consent written by AutoTrader into the lead's comments.
_TCPA_OPT_IN = re.compile(r"TCPAOptIn\s*[:=]\s*(true|false)", re.IGNORECASE)


async def record_consent(
    db: DealerScopedDatabase,
    *,
    customer_id: str,
    channel: str,
    consent_type: ConsentType,
    status: str,
    source: str,
    lead_id: str | None = None,
    evidence: dict[str, Any] | None = None,
    evidence_id: str | None = None,
    text_version: str | None = None,
    source_url: str | None = None,
    at: datetime | None = None,
) -> bool:
    """Adds one entry. With `evidence_id`, the same evidence is recorded
    only once (a lead form read on every turn). Returns whether it was added."""
    collection = db.collection(AI_CONSENT_COLLECTION)
    if evidence_id and await collection.find_one({"consent_evidence_id": evidence_id}, projection={"_id": 1}):
        return False
    now = clock.now()
    try:
        await collection.insert_one({
            "customer_id": customer_id, "channel": channel, "consent_type": consent_type,
            "consent_status": status, "consent_source": source, "consent_timestamp": at or now,
            "consent_text_version": text_version, "consent_evidence_id": evidence_id,
            "consenting_seller_id": db.dealer_id, "source_url": source_url, "lead_id": lead_id,
            "evidence": evidence or {}, "recorded_at": now,
        })
    except DuplicateKeyError:
        return False
    return True


async def latest(db: DealerScopedDatabase, customer_id: str, channel: str, consent_type: ConsentType) -> dict | None:
    rows = await db.collection(AI_CONSENT_COLLECTION).find(
        {"customer_id": customer_id, "channel": channel, "consent_type": consent_type}
    ).sort("recorded_at", -1).to_list(1)
    return rows[0] if rows else None


async def history(db: DealerScopedDatabase, customer_id: str) -> list[dict]:
    return await db.collection(AI_CONSENT_COLLECTION).find({"customer_id": customer_id}).sort(
        "recorded_at", 1).to_list(None)


async def set_channel_consent(
    db: DealerScopedDatabase, customer_id: str, channel: str, allowed: bool, source: str,
    *, lead_id: str | None = None, evidence: dict[str, Any] | None = None,
) -> None:
    """A STOP (allowed=False) or START (True) on one channel, as a new entry."""
    await record_consent(db, customer_id=customer_id, channel=channel, consent_type="opt_out",
                         status="opted_in" if allowed else "opted_out", source=source, lead_id=lead_id,
                         evidence=evidence)


async def is_opted_out(db: DealerScopedDatabase, customer_id: str, channel: str) -> bool:
    entry = await latest(db, customer_id, channel, "opt_out")
    return bool(entry and entry["consent_status"] == "opted_out")


async def open_review(db: DealerScopedDatabase, customer_id: str) -> dict | None:
    """The unresolved possible opt-out, if any (C1 item 3, decision 72)."""
    entry = await latest(db, customer_id, "all", "review")
    return entry if entry and entry["consent_status"] == "open" else None


def lead_form_consent(lead: dict | None) -> tuple[bool, str] | None:
    """(opted in?, the quoted line) from the lead form, or None when it says
    nothing. Only AutoTrader's `TCPAOptIn: true|false;` is known so far."""
    lead = lead or {}
    text = " ".join(str(v) for v in ((lead.get("data") or {}).get("comments"), lead.get("comments")) if v)
    if m := _TCPA_OPT_IN.search(text):
        return m.group(1).lower() == "true", m.group(0)
    return None


def phone_opt_in(customer: dict | None, to: str | None) -> tuple[bool | None, dict | None]:
    """The platform's `sms_opt_in` flag on the phone we'd text: (flag, entry)."""
    for phone in (customer or {}).get("phones") or []:
        if _same_phone(phone.get("value"), to):
            flag = phone.get("sms_opt_in")
            return (flag if isinstance(flag, bool) else None), phone
    return None, None


# --- Recipients -------------------------------------------------------------------

def resolve_recipient(lead: dict | None, customer: dict | None, channel: Channel) -> str | None:
    """The address to message on `channel`, or None when there isn't one."""
    lead = lead or {}
    customer = customer or {}
    if channel == "sms":
        candidates = [lead.get("phone"), *_primary_first(customer.get("phones"))]
    else:
        candidates = [lead.get("email"), *_primary_first(customer.get("emails"))]
    for value in candidates:
        if isinstance(value, str) and value.strip() and _plausible(value.strip(), channel):
            return to_e164(value) if channel == "sms" else value.strip()
    return None


def to_e164(phone: str) -> str:
    """Twilio needs E.164, and the platform threads a customer's reply to its
    lead by the exact phone pair, so every SMS goes to "+<digits>". Same rule
    as aidmvcs-be-dev/app/lib/sms.js normalizeSmsPhone: 10 digits are US
    numbers; longer ones already carry a country code. The platform stores
    Customer phones as bare 10 digits, so this matters whenever the lead has
    no phone of its own."""
    digits = re.sub(r"\D", "", phone)
    return f"+1{digits}" if len(digits) == 10 else f"+{digits}"


def _primary_first(entries: list | None) -> list[str]:
    entries = entries or []
    ordered = sorted(entries, key=lambda e: not e.get("is_primary"))
    return [e.get("value") for e in ordered]


def _plausible(value: str, channel: Channel) -> bool:
    if channel == "email":
        return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value)) and value.lower() not in {"na", "n/a"}
    return len(re.sub(r"\D", "", value)) >= 10


def _same_phone(a: str | None, b: str | None) -> bool:
    digits = lambda v: re.sub(r"\D", "", v or "")[-10:]
    return bool(a) and bool(b) and digits(a) == digits(b)


# --- Old records --------------------------------------------------------------------

async def migrate_legacy_consent() -> int:
    """Before C1, `ai_consent` held one document per customer, overwritten in
    place ({customer_id, sms: {allowed, source, at}, email: {...}}) under a
    unique index. Each becomes add-only entries, then the old document and
    the unique index go. Safe to run on every start."""
    collection = get_db()[AI_CONSENT_COLLECTION]
    try:
        indexes = await collection.index_information()
    except Exception:  # noqa: BLE001 - no collection yet
        indexes = {}
    for name, spec in indexes.items():
        if spec.get("unique") and [k for k, _ in spec.get("key", [])] == ["dealer_id", "customer_id"]:
            await collection.drop_index(name)
    moved = 0
    async for doc in collection.find({"consent_type": {"$exists": False}}):
        for channel in ("sms", "email"):
            value = doc.get(channel)
            if isinstance(value, dict) and "allowed" in value:
                await collection.insert_one({
                    "dealer_id": doc.get("dealer_id"), "customer_id": doc.get("customer_id"), "channel": channel,
                    "consent_type": "opt_out", "consent_status": "opted_in" if value["allowed"] else "opted_out",
                    "consent_source": value.get("source") or "legacy", "consent_timestamp": value.get("at"),
                    "consent_text_version": None, "consent_evidence_id": f"legacy:{doc['_id']}:{channel}",
                    "consenting_seller_id": doc.get("dealer_id"), "source_url": None, "lead_id": None,
                    "evidence": {"migrated_from": str(doc["_id"])}, "recorded_at": value.get("at") or clock.now(),
                })
                moved += 1
        await collection.delete_one({"_id": doc["_id"]})
    return moved
