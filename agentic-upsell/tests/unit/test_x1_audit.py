"""PLAN_4 stream X1 item 8: the audit record (TCPA PDF §11) and the lead provider's consent object (§6)."""

import pytest
from bson import ObjectId

from tests.unit.conftest import set_clock
from tests.unit.test_compliance import DEALER, _check, _deps, _inbound, _lead, ny
from upsell_agent.channels import consent
from upsell_agent.channels.delivery import apply_delivery_status
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import LeadCreatedEvent
from upsell_agent.integrations.mongodb import (
    AI_COMPLIANCE_LOG_COLLECTION,
    AI_CONSENT_COLLECTION,
    AI_MESSAGES_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import StubPlatformClient


@pytest.fixture
async def dealers(mongo):
    await simulate.ensure_platform_dealers()


async def _provider_consent(mongo, created, **fields):
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": ObjectId(created["lead_id"])})
    obj = {"opt_in": True, "disclosure": "By submitting you agree to receive texts from Demo Motors ...",
           "disclosure_version": "cg-2026-03", "consented_at": "2026-09-21T15:04:00Z",
           "form_url": "https://cargurus.example/vdp/123", "phone": lead["phone"], "channels": ["sms", "email"],
           "provider": "CarGurus", **fields}
    obj = {k: v for k, v in obj.items() if v is not None}
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])},
                                                      {"$set": {"data.tcpa_consent": obj}})


async def test_a_complete_provider_consent_object_is_kept_whole_and_counts(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="cargurus")
    await _provider_consent(mongo, created)
    decision = await _check(created, campaign=True)
    assert decision.outcome == "ALLOW" and decision.consent["source"] == "lead_provider"
    [entry] = await mongo[AI_CONSENT_COLLECTION].find({"consent_type": "marketing_consent"}).to_list(None)
    assert entry["consent_status"] == "granted" and entry["consent_text_version"] == "cg-2026-03"
    assert entry["source_url"] == "https://cargurus.example/vdp/123"
    assert entry["evidence"]["disclosure_text"].startswith("By submitting") and entry["evidence"]["raw"]["opt_in"]
    log = await mongo[AI_COMPLIANCE_LOG_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert log["consent_text_version"] == "cg-2026-03" and log["consent_evidence_id"] == f"lead_provider:{created['lead_id']}"


@pytest.mark.parametrize(("missing", "why"), [
    ({"disclosure": None}, "disclosure_text"),
    ({"disclosure_version": None}, "disclosure_version"),
    ({"consented_at": None}, "consent_timestamp"),
    ({"phone": "+12125550199"}, "phone matching"),
    ({"channels": ["email"]}, "sms among"),
])
async def test_missing_provider_evidence_is_consent_review_required(mongo, dealers, missing, why):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="cargurus")
    await _provider_consent(mongo, created, **missing)
    decision = await _check(created, campaign=True)
    assert decision.outcome == "REVIEW" and decision.rule == "consent_review_required"
    assert "CONSENT_REVIEW_REQUIRED" in decision.reason and why in decision.reason
    [entry] = await mongo[AI_CONSENT_COLLECTION].find({"consent_type": "marketing_consent"}).to_list(None)
    assert entry["consent_status"] == "review_required" and isinstance(entry["evidence"], dict)


async def test_the_audit_row_has_every_section_11_field_and_the_delivery_result(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), _deps())
    log = await mongo[AI_COMPLIANCE_LOG_COLLECTION].find_one({"lead_id": created["lead_id"], "decision": "ALLOW"})
    message = await mongo[AI_MESSAGES_COLLECTION].find_one({"lead_id": created["lead_id"], "direction": "outbound"})
    assert log["lead_source"] == "website" and log["consent_evidence_id"] == f"inquiry:{created['lead_id']}"
    assert log["jurisdiction"]["states"] == ["NY"] and log["local_time"]["America/New_York"]
    assert log["rules_version"] and log["decision_reason"] and log["rule"] and "frequency" in log
    assert log["message_id"] == str(message["_id"]) and "template_id" in log
    assert log["delivery"]["status"] == "sent" and log["delivery"]["provider_id"] == message["provider_id"]
    await apply_delivery_status(StubPlatformClient(), "delivered", provider_id=message["provider_id"])
    log = await mongo[AI_COMPLIANCE_LOG_COLLECTION].find_one({"_id": log["_id"]})
    assert log["delivery"]["status"] == "delivered" and [e["status"] for e in log["delivery"]["events"]] == [
        "sent", "delivered"]


async def test_a_block_for_an_opt_out_names_the_opt_out_event(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    await handlers.handle_inbound_message(_inbound(created, "STOP"), _deps())
    decision = await _check(created)
    entry = await consent.latest_opt_out(dealer_scoped_db(DEALER), created["customer_id"], "sms")
    assert decision.rule == "opted_out" and decision.opt_out_event_id == str(entry["_id"])
    log = await mongo[AI_COMPLIANCE_LOG_COLLECTION].find_one({"_id": ObjectId(decision.log_id)})
    assert log["opt_out_event_id"] == str(entry["_id"])
