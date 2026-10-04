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
- `contact_invalid`: `invalid` (MASTER_PLAN_3 C6): a phone or email that is not
  the customer's (a wrong person) or can't receive (a hard bounce, a number
  that can't be texted). Kept under the ADDRESS only: the customer's other
  phone or email is unaffected. Nothing the system starts goes to it again.

Opt-out entries also carry the `address` (phone in E.164, email lower case)
when known, and are read by customer **or** address, so a re-imported
customer keeps the suppression (decision 140).

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
ConsentType = Literal["opt_out", "marketing_consent", "review", "contact_invalid"]

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
    address: str | None = None,
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
            **({"address": address} if address else {}),
        })
    except DuplicateKeyError:
        return False
    return True


# Newest first. Two entries written in the same instant (an open review and its resolution in one
# request) tie on `recorded_at`; `_id` breaks the tie by insertion order, so the later one wins.
_NEWEST_FIRST = [("recorded_at", -1), ("_id", -1)]


async def latest(db: DealerScopedDatabase, customer_id: str, channel: str, consent_type: ConsentType) -> dict | None:
    rows = await db.collection(AI_CONSENT_COLLECTION).find(
        {"customer_id": customer_id, "channel": channel, "consent_type": consent_type}
    ).sort(_NEWEST_FIRST).to_list(1)
    return rows[0] if rows else None


async def history(db: DealerScopedDatabase, customer_id: str) -> list[dict]:
    return await db.collection(AI_CONSENT_COLLECTION).find({"customer_id": customer_id}).sort(
        [("recorded_at", 1), ("_id", 1)]).to_list(None)


def address_key(channel: str, value: str | None) -> str | None:
    """The phone or email an opt-out is also kept under (decision 140): a
    deleted or re-imported customer gets a new id, and the TCPA PDF §12 says
    that must not erase the suppression. Phones as E.164, emails lower case."""
    if not value or not value.strip():
        return None
    if channel == "email":
        return value.strip().lower()
    return to_e164(value) if len(re.sub(r"\D", "", value)) >= 10 else None


async def set_channel_consent(
    db: DealerScopedDatabase, customer_id: str, channel: str, allowed: bool, source: str,
    *, lead_id: str | None = None, evidence: dict[str, Any] | None = None, address: str | None = None,
) -> None:
    """A STOP (allowed=False) or START (True) on one channel, as a new entry,
    kept under the customer and, when known, the phone / email too."""
    await record_consent(db, customer_id=customer_id, channel=channel, consent_type="opt_out",
                         status="opted_in" if allowed else "opted_out", source=source, lead_id=lead_id,
                         evidence=evidence, address=address_key(channel, address))
    if not allowed:
        # PLAN_4 stream L: the opt-out is marked on the latest AI touch (learning/touches.py).
        from upsell_agent.learning import touches
        await touches.on_opt_out(db, lead_id=lead_id, customer_id=customer_id, channel=channel)


async def latest_opt_out(db: DealerScopedDatabase, customer_id: str | None, channel: str,
                         address: str | None = None) -> dict | None:
    """The newest opt-out / opt-in entry for this customer or this phone /
    email (whichever is newer), on one channel."""
    who: list[dict[str, Any]] = [{"customer_id": customer_id}] if customer_id else []
    if key := address_key(channel, address):
        who.append({"address": key})
    if not who:
        return None
    rows = await db.collection(AI_CONSENT_COLLECTION).find(
        {"$or": who, "channel": channel, "consent_type": "opt_out"}
    ).sort(_NEWEST_FIRST).to_list(1)
    return rows[0] if rows else None


async def is_opted_out(db: DealerScopedDatabase, customer_id: str | None, channel: str,
                       address: str | None = None) -> bool:
    entry = await latest_opt_out(db, customer_id, channel, address)
    return bool(entry and entry["consent_status"] == "opted_out")


async def ever_opted_out(db: DealerScopedDatabase, customer_id: str | None, channel: str,
                         address: str | None = None) -> bool:
    """Whether this customer or address has ever opted out of `channel`: the
    platform's `sms_opt_in` flag never grants consent after that (decision 141)."""
    who: list[dict[str, Any]] = [{"customer_id": customer_id}] if customer_id else []
    if key := address_key(channel, address):
        who.append({"address": key})
    if not who:
        return False
    return bool(await db.collection(AI_CONSENT_COLLECTION).find_one(
        {"$or": who, "channel": channel, "consent_type": "opt_out", "consent_status": "opted_out"},
        projection={"_id": 1}))


async def mark_invalid(db: DealerScopedDatabase, *, channel: str, address: str | None, reason: str, source: str,
                       customer_id: str | None = None, lead_id: str | None = None,
                       evidence: dict[str, Any] | None = None) -> bool:
    """A phone or email that must not be used again (C6). Returns False when
    there is no usable address to key it under, or it is already marked."""
    key = address_key(channel, address)
    if not key or await is_invalid(db, channel, key):
        return False
    await record_consent(db, customer_id=customer_id or "", channel=channel, consent_type="contact_invalid",
                         status="invalid", source=source, lead_id=lead_id, address=key,
                         evidence={"reason": reason, **(evidence or {})})
    return True


async def is_invalid(db: DealerScopedDatabase, channel: str, address: str | None) -> bool:
    """Whether this phone / email was marked invalid (by wrong person or hard bounce)."""
    key = address_key(channel, address)
    if not key:
        return False
    return bool(await db.collection(AI_CONSENT_COLLECTION).find_one(
        {"address": key, "channel": channel, "consent_type": "contact_invalid", "consent_status": "invalid"},
        projection={"_id": 1}))


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


# --- Lead-provider consent evidence (PLAN_4 stream X1 item 8, TCPA PDF §6) ---------------------------------
#
# A lead provider's consent is kept as the whole object it sent, never reduced to a boolean. Read from the lead's
# `tcpa_consent` / `consent` / `lead_consent` (top level or under `data`), the keys normalised below; AutoTrader's
# `TCPAOptIn: true|false` comment line is the minimal form (no disclosure, time or URL).
_PROVIDER_KEYS = ("tcpa_consent", "consent", "lead_consent")
_ALIASES: dict[str, tuple[str, ...]] = {
    "opted_in": ("opted_in", "opt_in", "optin", "tcpa_opt_in", "consented", "consent_given", "granted"),
    "disclosure_text": ("disclosure_text", "disclosure", "consent_text", "consent_language", "language"),
    "disclosure_version": ("disclosure_version", "text_version", "version", "consent_text_version"),
    "consent_timestamp": ("consent_timestamp", "timestamp", "consented_at", "given_at", "captured_at"),
    "source_url": ("source_url", "url", "form_url", "page_url"),
    "permitted_channels": ("permitted_channels", "channels"),
    "phone": ("phone", "phone_number", "consented_phone"),
    "seller": ("seller", "consenting_seller", "dealer", "seller_name"),
    "provider": ("provider", "lead_provider", "vendor"),
    "evidence_id": ("evidence_id", "consent_id", "certificate", "trustedform_cert_url", "jornaya_lead_id"),
}
# What a provider's opt-in needs before it can count as text consent; anything less is CONSENT_REVIEW_REQUIRED.
REQUIRED_PROVIDER_FIELDS = ("disclosure_text", "disclosure_version", "consent_timestamp", "phone")


def _truthy(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("true", "yes", "y", "1"):
        return True
    if isinstance(value, str) and value.strip().lower() in ("false", "no", "n", "0"):
        return False
    return None


def lead_provider_consent(lead: dict | None) -> dict[str, Any] | None:
    """The lead provider's consent evidence as one object ({opted_in, disclosure_text, disclosure_version,
    consent_timestamp, source_url, permitted_channels, phone, seller, provider, evidence_id, format, raw}), or
    None when the lead carries none."""
    lead = lead or {}
    source = " ".join(str(lead.get(k) or "") for k in ("source", "lead_source")).strip() or None
    for holder in (lead, lead.get("data") or {}):
        for key in _PROVIDER_KEYS:
            obj = holder.get(key)
            if isinstance(obj, dict) and obj:
                out: dict[str, Any] = {"format": "object", "raw": dict(obj)}
                for field, names in _ALIASES.items():
                    out[field] = next((obj[n] for n in names if obj.get(n) not in (None, "")), None)
                out["opted_in"] = _truthy(out["opted_in"])
                out["provider"] = out["provider"] or source
                return out
    if form := lead_form_consent(lead):
        return {"format": "comment_line", "opted_in": form[0], "quote": form[1], "provider": source,
                **{f: None for f in ("disclosure_text", "disclosure_version", "consent_timestamp", "source_url",
                                     "permitted_channels", "phone", "seller", "evidence_id")}}
    return None


def missing_provider_evidence(evidence: dict[str, Any], to: str | None) -> list[str]:
    """What a provider's opt-in lacks before it counts for texts to `to`."""
    missing = [f for f in REQUIRED_PROVIDER_FIELDS if not evidence.get(f)]
    if evidence.get("phone") and to and not _same_phone(str(evidence["phone"]), to):
        missing.append("phone matching the number we'd text")
    channels = evidence.get("permitted_channels")
    if channels and "sms" not in [str(c).lower() for c in (channels if isinstance(channels, list) else [channels])]:
        missing.append("sms among the permitted channels")
    return missing


def phone_opt_in(customer: dict | None, to: str | None) -> tuple[bool | None, dict | None]:
    """The platform's `sms_opt_in` flag on the phone we'd text: (flag, entry)."""
    for phone in (customer or {}).get("phones") or []:
        if _same_phone(phone.get("value"), to):
            flag = phone.get("sms_opt_in")
            return (flag if isinstance(flag, bool) else None), phone
    return None, None


# --- Recipients -------------------------------------------------------------------

def recipient_candidates(lead: dict | None, customer: dict | None, channel: Channel) -> list[str]:
    """Every plausible address for `channel`, the lead's own first, then the customer's primary ones."""
    lead = lead or {}
    customer = customer or {}
    if channel == "sms":
        candidates = [lead.get("phone"), *_primary_first(customer.get("phones"))]
    else:
        candidates = [lead.get("email"), *_primary_first(customer.get("emails"))]
    found: list[str] = []
    for value in candidates:
        if isinstance(value, str) and value.strip() and _plausible(value.strip(), channel):
            address = to_e164(value) if channel == "sms" else value.strip()
            if address not in found:
                found.append(address)
    return found


def resolve_recipient(lead: dict | None, customer: dict | None, channel: Channel) -> str | None:
    """The address to message on `channel`, or None when there isn't one."""
    found = recipient_candidates(lead, customer, channel)
    return found[0] if found else None


async def usable_recipient(db: DealerScopedDatabase, lead: dict | None, customer: dict | None,
                           channel: Channel) -> str | None:
    """Like resolve_recipient, but skips a phone / email marked invalid (C6): the next one on the
    record is used, and when none is left there is no one to message on this channel."""
    for address in recipient_candidates(lead, customer, channel):
        if not await is_invalid(db, channel, address):
            return address
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


async def migrate_silenced_opt_outs() -> int:
    """Before decision 137, an opt-out set the whole lead to `opted_out`, so
    the AI stopped replying to the customer at all. Those leads go back to
    `active`: their opt-out entries above still stop everything the system
    starts on those channels, and the customer's own messages get a reply
    again (decision 142). Safe to run on every start."""
    from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION

    result = await get_db()[AI_LEAD_STATE_COLLECTION].update_many(
        {"status": "opted_out"},
        {"$set": {"status": "active", "status_reason": "Opt-out no longer silences replies (decision 137)",
                  "opt_out_silence_lifted_at": clock.now()}})
    return result.modified_count
