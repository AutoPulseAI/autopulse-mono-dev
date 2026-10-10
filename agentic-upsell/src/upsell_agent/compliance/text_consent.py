"""Asking for text consent by email (client, 9 Oct 2026).

A DealerVault owner who never texted the dealer has no text consent (TCPA spec §5: DMS data never is), so their
owner messages go by email only. That email ends with an invitation (INVITE): text YES to the dealer's number.
Their YES, as their own text, is recorded as `marketing_consent` / `granted` with the invitation's wording and
version as evidence; the Compliance Engine then allows marketing texts (compliance/engine.py). STOP still wins
over it at any time. Counsel should approve INVITE's wording (spec §13).

The AI never texts anyone to ask for consent: the invitation is email only.
"""

import re
from datetime import UTC, datetime, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.channels import consent

INVITE_VERSION = "email-invite-v1"
INVITE = ("Prefer texts? Text YES to {number} to get our messages by text. Msg & data rates may apply. "
          "Reply STOP anytime to stop.")
CONFIRMATION = "Thanks! You'll now get our messages by text too. Reply STOP anytime to stop."
# A YES this long after the invitation is no longer its answer.
INVITE_VALID = timedelta(days=60)
_YES = re.compile(r"^\s*(yes|y|yes please|yep|yeah|ok|okay|start)[\s.!]*$", re.IGNORECASE)


def invite_line(number: str | None) -> str | None:
    return INVITE.format(number=number) if number else None


def is_invite_answer(text: str | None, state: dict[str, Any] | None) -> bool:
    at = (state or {}).get("text_consent_invited_at")
    if not isinstance(at, datetime) or not _YES.match(text or ""):
        return False
    at = at if at.tzinfo else at.replace(tzinfo=UTC)
    return clock.now() - at <= INVITE_VALID


SOURCE = "customer_text_yes_to_email_invite"


async def latest_yes(db, customer_id: str | None) -> dict | None:
    """The customer's recorded YES to the invitation, if any."""
    if not customer_id:
        return None
    from upsell_agent.integrations.mongodb import AI_CONSENT_COLLECTION
    rows = await db.collection(AI_CONSENT_COLLECTION).find(
        {"customer_id": customer_id, "channel": "sms", "consent_source": SOURCE, "consent_status": "granted"}
    ).sort([("recorded_at", -1)]).to_list(1)
    return rows[0] if rows else None


async def has_text_consent(db, customer_id: str | None) -> bool:
    return await latest_yes(db, customer_id) is not None


async def record_yes(db, *, customer_id: str, lead_id: str | None, message: dict, address: str | None) -> bool:
    return await consent.record_consent(
        db, customer_id=customer_id, channel="sms", consent_type="marketing_consent", status="granted",
        source=SOURCE, lead_id=lead_id, text_version=INVITE_VERSION,
        evidence_id=f"text_yes:{message.get('_id')}", address=consent.address_key("sms", address),
        evidence={"message": message.get("text"), "message_id": str(message.get("_id")), "invite": INVITE})
