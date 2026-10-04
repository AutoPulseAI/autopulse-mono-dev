"""Staff notes in the CRM conversation (MASTER_PLAN_4, stream R).

What the AI tells staff (a service request with the customer's preferred day and time, a SOLD PENDING question
for a person or information the customer sent, a recall / maintenance notice, why the customer is no longer
interested, an address that bounced) is also written into the lead's conversation in the CRM as an internal note
(`POST /api/internal/ai/leads/notes`, integrations/platform_client.py `add_lead_note`), so staff see it where they
work and not only in the AI screens.

One note per notice: `key` names the notice (the turn and kind, the event, the address...). The note is recorded
in `ai_crm_notes` once it is written, and the CRM itself returns the same note for a repeated key, so a retry or
a re-run never doubles it. A CRM that can't be reached never stops the AI's own work: the failure is logged and
kept (`status: failed`), and the next call with the same key tries again.
"""

import logging
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import DealerScopedDatabase

logger = logging.getLogger(__name__)

AI_CRM_NOTES_COLLECTION = "ai_crm_notes"

# How each kind reads at the top of the note in the CRM.
LABELS = {
    "service_request": "Service request",
    "sold_pending_escalation": "Sold Pending - question for a person",
    "sold_pending_info": "Sold Pending - information from the customer",
    "recall_detected": "Recall notice",
    "recall_review": "Recall notice - please check the VIN",
    "maintenance_due": "Maintenance due",
    "service_outreach": "Service outreach",
    "not_interested": "Not interested",
    "bad_contact": "Contact problem",
    "text_consent_missing": "Email only - no text consent",
    "call_escalation": "Requested call not made in 5 minutes",  # PLAN_4 stream X2
    "after_handoff": "Customer wrote after the handoff",
}
MAX_TEXT = 1500


def note_text(kind: str, text: str) -> str:
    """"AutoPulse AI - Service request: <what the AI told staff>" - a staff member reading the conversation sees
    who wrote it and what it is about first."""
    label = LABELS.get(kind) or kind.replace("_", " ").capitalize()
    body = " ".join(str(text or "").split())[:MAX_TEXT]
    return f"AutoPulse AI - {label}: {body}"


def _client(platform: Any | None) -> Any:
    if platform is not None:
        return platform
    from upsell_agent.config import get_settings
    from upsell_agent.integrations.platform_client import get_platform_client
    return get_platform_client(get_settings())


async def write(db: DealerScopedDatabase, *, lead_id: str | None, kind: str, text: str, key: str,
                platform: Any | None = None, customer_id: str | None = None) -> dict[str, Any]:
    """Writes the note once per `key`. Returns {status: written|duplicate|failed|skipped, note_id?, text}."""
    if not lead_id or not text:
        return {"status": "skipped", "reason": "no lead or no text"}
    notes = db.collection(AI_CRM_NOTES_COLLECTION)
    done = await notes.find_one({"key": key, "status": "written"})
    if done:
        return {"status": "duplicate", "note_id": done.get("note_id"), "text": done.get("text")}
    body = note_text(kind, text)
    client = _client(platform)
    add = getattr(client, "add_lead_note", None)
    if add is None:
        return {"status": "skipped", "reason": "this platform client writes no notes"}
    try:
        note_id = await add(db.dealer_id, lead_id, body, kind=kind, idempotency_key=key, customer_id=customer_id)
    except Exception as exc:  # noqa: BLE001 - the CRM being down never stops the AI's own work
        logger.warning("CRM note %s for lead %s failed: %r", key, lead_id, exc)
        await notes.update_one({"key": key}, {"$set": {"lead_id": lead_id, "kind": kind, "text": body,
                                                       "status": "failed", "error": repr(exc)[:300],
                                                       "updated_at": clock.now()},
                                              "$inc": {"attempts": 1}}, upsert=True)
        return {"status": "failed", "error": repr(exc)[:300], "text": body}
    await notes.update_one({"key": key}, {"$set": {"lead_id": lead_id, "kind": kind, "text": body,
                                                   "status": "written", "note_id": note_id,
                                                   "updated_at": clock.now()},
                                          "$inc": {"attempts": 1}}, upsert=True)
    return {"status": "written", "note_id": note_id, "text": body}
