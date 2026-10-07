"""MASTER_PLAN_4 stream R: service requests and AI escalations written into the CRM conversation as staff notes
(agent/crm_notes.py -> platform client `add_lead_note` -> POST /api/internal/ai/leads/notes), once per notice."""

import json

import httpx

from tests.unit.conftest import make_settings
from upsell_agent.agent import crm_notes
from upsell_agent.channels import suppression
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import dealer_scoped_db
from upsell_agent.integrations.platform_client import (
    DEV_PLATFORM_MESSAGES_COLLECTION,
    LivePlatformClient,
    StubPlatformClient,
)

DEALER = simulate.DEV_DEALERS[0]["_id"]


async def _lead():
    return await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Nora Test", comments="hi")


async def _notes(mongo, lead_id):
    return await mongo[DEV_PLATFORM_MESSAGES_COLLECTION].find({"lead_id": lead_id, "is_note": True}).to_list(None)


def test_the_note_says_who_wrote_it_and_what_it_is_about():
    text = crm_notes.note_text("service_request", "Thursday morning.\n  Wants to wait.")
    assert text == "AutoPulse AI - Service request: Thursday morning. Wants to wait."
    assert crm_notes.note_text("sold_pending_escalation", "x").startswith(
        "AutoPulse AI - Sold Pending - question for a person: ")
    assert crm_notes.note_text("something_new", "x") == "AutoPulse AI - Something new: x"


async def test_one_note_per_notice(mongo):
    created = await _lead()
    db = dealer_scoped_db(DEALER)
    first = await crm_notes.write(db, lead_id=created["lead_id"], kind="service_request", text="Tuesday 9am",
                                  key="t1:service_request", platform=StubPlatformClient())
    again = await crm_notes.write(db, lead_id=created["lead_id"], kind="service_request", text="Tuesday 9am",
                                  key="t1:service_request", platform=StubPlatformClient())
    assert first["status"] == "written" and again["status"] == "duplicate" and again["note_id"] == first["note_id"]
    [note] = await _notes(mongo, created["lead_id"])
    assert note["text"] == "AutoPulse AI - Service request: Tuesday 9am" and note["kind"] == "service_request"


async def test_a_crm_that_cannot_be_reached_never_stops_the_ai_and_is_tried_again(mongo):
    created = await _lead()
    db = dealer_scoped_db(DEALER)

    class Down:
        async def add_lead_note(self, *a, **kw):
            raise RuntimeError("CRM down")

    failed = await crm_notes.write(db, lead_id=created["lead_id"], kind="bad_contact", text="bounced", key="k",
                                   platform=Down())
    assert failed["status"] == "failed"
    retried = await crm_notes.write(db, lead_id=created["lead_id"], kind="bad_contact", text="bounced", key="k",
                                    platform=StubPlatformClient())
    assert retried["status"] == "written" and len(await _notes(mongo, created["lead_id"])) == 1


async def test_the_live_client_posts_the_note_with_its_idempotency_key(monkeypatch):
    seen = []

    def handler(request):
        seen.append((request.url.path, json.loads(request.content)))
        return httpx.Response(200, json={"id": "n1", "created": True})

    original = httpx.AsyncClient

    class Patched(original):
        def __init__(self, *a, **kw):
            kw.pop("transport", None)
            super().__init__(*a, transport=httpx.MockTransport(handler), **kw)

    monkeypatch.setattr(httpx, "AsyncClient", Patched)
    client = LivePlatformClient(make_settings("DEV"))
    assert await client.add_lead_note(DEALER, "l1", "AutoPulse AI - x", kind="not_interested",
                                      idempotency_key="t9:not_interested") == "n1"
    assert seen == [("/api/internal/ai/leads/notes", {"dealer_id": DEALER, "lead_id": "l1", "text": "AutoPulse AI - x",
                                                      "kind": "not_interested",
                                                      "idempotency_key": "t9:not_interested"})]


async def test_a_bad_address_is_noted_in_the_crm_once(mongo):
    created = await _lead()
    db = dealer_scoped_db(DEALER)
    for _ in range(2):
        await suppression.suppress_contact(db, channel="email", address="nora@bounce.test", reason="hard bounce",
                                           source="test", customer_id=created["customer_id"],
                                           lead_id=created["lead_id"])
    notes = await _notes(mongo, created["lead_id"])
    assert len(notes) == 1 and notes[0]["kind"] == "bad_contact"
    assert notes[0]["text"].startswith("AutoPulse AI - Contact problem: email address nora@bounce.test was marked "
                                       "invalid (hard bounce).")
