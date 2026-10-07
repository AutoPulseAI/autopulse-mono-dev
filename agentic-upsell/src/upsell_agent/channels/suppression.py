"""Bad numbers, wrong people and hard bounces (MASTER_PLAN_3 C6; Omnichannel
PDF §15, architecture §15 decisions 170-172).

One rule for all three: the phone or email is marked invalid
(`consent.mark_invalid`) and never used again; the customer's other contact
points carry on. Only when nothing contactable is left (every channel is
opted out, invalid or has no address) does the lead's stage become
"Opted Out / Suppressed" and its scheduled work stop.

- A customer's "wrong number" / "you have the wrong person" marks the phone
  or email the message came in on (events/handlers.py).
- A hard bounce marks the email that bounced; a number the carrier says
  cannot receive texts (landline, unknown, invalid) marks the phone
  (channels/delivery.py). A soft bounce (mailbox full, deferred) does not.
"""

import re
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import lifecycle
from upsell_agent.channels import consent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
)

# Twilio error codes that mean "this number can never receive our text".
TWILIO_BAD_NUMBER_CODES = {"21211", "21214", "21217", "21401", "21421", "21614", "30003", "30005", "30006"}
# SendGrid: a "bounce" event of type "bounce" is a hard bounce ("blocked" is soft); a drop for these reasons is
# the same address problem.
_DROP_HARD = re.compile(r"bounced address|invalid|unsubscribed address|spam reporting address", re.IGNORECASE)

# What a customer says when the number or email isn't theirs. Plain phrases, no model: it only ever
# stops contact, never starts it.
_WRONG_PERSON = re.compile(
    r"\bwrong\s+(?:number|person|guy|phone|email|e-?mail)\b|"
    r"\bnot\s+the\s+(?:right|correct)\s+(?:number|person)\b|"
    r"\b(?:this|that)\s+(?:is\s+not|isn'?t|is\s*n't)\s+\w+'?s?\s+(?:phone|number|email)\b|"
    r"\bno\s+one\s+(?:here\s+)?(?:by\s+that\s+name|named)\b|"
    r"\bi'?m\s+not\s+who\s+you(?:'re|\s+are)\s+(?:looking|trying)\b|"
    r"\bi\s+(?:don'?t|do\s+not)\s+know\s+(?:anyone|anybody|who\s+that\s+is)\b",
    re.IGNORECASE)


def detect_wrong_person(text: str | None) -> str | None:
    """The matched words when the customer says this is the wrong number / person, else None."""
    lowered = (text or "").replace("’", "'")
    m = _WRONG_PERSON.search(lowered)
    return m.group(0) if m else None


def is_hard_bounce(provider_event: str, *, event_type: str | None = None, reason: str | None = None) -> bool:
    """A SendGrid event that means the address itself is bad."""
    if provider_event == "bounce":
        return (event_type or "bounce").lower() == "bounce"
    if provider_event == "dropped":
        return bool(_DROP_HARD.search(reason or ""))
    return False


def is_bad_number_error(error_code: str | None) -> bool:
    return str(error_code or "") in TWILIO_BAD_NUMBER_CODES


async def contactable_channels(db: DealerScopedDatabase, customer_id: str | None, lead: dict | None,
                               customer: dict | None) -> list[str]:
    """Channels (sms, email) that still have a valid address and no opt-out."""
    channels = []
    for channel in ("sms", "email"):
        address = await consent.usable_recipient(db, lead, customer, channel)  # type: ignore[arg-type]
        if address and not await consent.is_opted_out(db, customer_id, channel, address):
            channels.append(channel)
    return channels


async def suppress_contact(db: DealerScopedDatabase, *, channel: str, address: str | None, reason: str, source: str,
                           customer_id: str | None, lead_id: str | None, evidence: dict[str, Any] | None = None,
                           notice: str | None = None, stage: bool = True) -> dict[str, Any]:
    """Marks `address` invalid; moves the lead to Opted Out / Suppressed when nothing else can be used.
    Returns {marked, channels_left, suppressed_lead, stage_change}."""
    marked = await consent.mark_invalid(db, channel=channel, address=address, reason=reason, source=source,
                                        customer_id=customer_id, lead_id=lead_id, evidence=evidence)
    out: dict[str, Any] = {"marked": marked, "channel": channel, "address": address, "channels_left": None,
                           "suppressed_lead": False, "stage_change": None}
    if not lead_id:
        return out
    lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})
    customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one(
        {"_id": as_object_id(customer_id)}) if customer_id else None
    left = await contactable_channels(db, customer_id, lead, customer)
    out["channels_left"] = left
    states = db.collection(AI_LEAD_STATE_COLLECTION)
    # Staff see it, quoted, on the lead.
    text = notice or (f"{channel} address {address} was marked invalid ({reason}). "
                      + (f"Still contactable by {', '.join(left)}." if left else "No contactable channel is left."))
    await states.update_one({"lead_id": lead_id}, {"$set": {"staff_notice": {
        "at": clock.now(), "kind": "bad_contact", "text": text}}})
    # MASTER_PLAN_4 (stream R): the CRM conversation shows it too, once per address.
    from upsell_agent.agent import crm_notes
    await crm_notes.write(db, lead_id=lead_id, kind="bad_contact", text=text, customer_id=customer_id,
                          key=f"bad_contact:{lead_id}:{channel}:{address}")
    if left:
        return out
    out["suppressed_lead"] = True
    if not stage:  # shadow mode: the contact is marked; the lead's stage and work are left alone
        return out
    out["stage_change"] = await lifecycle.apply(db, lead_id, [lifecycle.Event(
        "opted_out", source=source, reason=f"No valid contact left: {reason}")], lead=lead, customer_id=customer_id)
    await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        {"lead_id": lead_id, "status": {"$in": ["pending", "standby"]}},
        {"$set": {"status": "cancelled", "cancelled_at": clock.now(), "reason": "no valid contact left"}})
    return out
