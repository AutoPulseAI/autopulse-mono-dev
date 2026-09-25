"""Who may be messaged on which channel (architecture §9 "Consent").

Two sources, checked right before every send:

1. This service's own record (`ai_consent`), written when a customer texts
   STOP / START, and in later stages when Twilio or SendGrid report an
   opt-out.
2. The platform's Customer record: a phone explicitly marked
   `sms_opt_in: false` is never texted. An unset flag is allowed, matching
   how the platform itself texts ADF leads today.

Also resolves the address to send to, preferring the lead's own contact
details (the channel the lead actually came in on) over the customer's
primary ones.
"""

import re
from dataclasses import dataclass
from typing import Literal

from upsell_agent import clock
from upsell_agent.integrations.mongodb import AI_CONSENT_COLLECTION, DealerScopedDatabase

Channel = Literal["sms", "email"]

# Carrier-standard opt-out / opt-in keywords. Only a message that is ONLY the
# keyword counts: "I don't want to stop by today" is not an opt-out.
STOP_WORDS = {"stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "opt out", "opt-out"}
START_WORDS = {"start", "unstop", "yes"}


def classify_keyword(text: str) -> Literal["stop", "start"] | None:
    normalized = re.sub(r"[^\w\s-]", "", (text or "").strip().lower()).strip()
    if normalized in STOP_WORDS:
        return "stop"
    if normalized in START_WORDS:
        return "start"
    return None


async def set_channel_consent(
    db: DealerScopedDatabase, customer_id: str, channel: Channel, allowed: bool, source: str
) -> None:
    await db.collection(AI_CONSENT_COLLECTION).update_one(
        {"customer_id": customer_id},
        {"$set": {channel: {"allowed": allowed, "source": source, "at": clock.now()}},
         "$setOnInsert": {"customer_id": customer_id}},
        upsert=True,
    )


async def is_opted_out(db: DealerScopedDatabase, customer_id: str, channel: Channel) -> bool:
    doc = await db.collection(AI_CONSENT_COLLECTION).find_one({"customer_id": customer_id}) or {}
    return (doc.get(channel) or {}).get("allowed") is False


@dataclass(frozen=True)
class ConsentCheck:
    allowed: bool
    reason: str


async def check_channel(
    db: DealerScopedDatabase, customer_id: str, customer: dict | None, channel: Channel, to: str
) -> ConsentCheck:
    if await is_opted_out(db, customer_id, channel):
        return ConsentCheck(False, f"customer opted out of {channel}")
    if channel == "sms" and customer:
        for phone in customer.get("phones") or []:
            if _same_phone(phone.get("value"), to) and phone.get("sms_opt_in") is False:
                return ConsentCheck(False, "phone is marked sms_opt_in=false on the customer record")
    return ConsentCheck(True, f"{channel} allowed")


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
