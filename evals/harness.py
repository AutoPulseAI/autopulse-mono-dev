"""Runs one real conversation turn for evals: the whole LangGraph pipeline
(extract, validate, decide, compose, guard, fallback) and the sender (to the
fake driver), on an in-memory database, with whichever models are configured
(MODEL_EXTRACT / MODEL_COMPOSE; "offline" by default).

Used by the DeepEval reply tests (evals/test_replies.py) and the Promptfoo
prompt-injection suite (evals/promptfoo/provider.py), so both judge exactly
what a customer would receive.
"""

import os

os.environ.setdefault("MODEL_EXTRACT", "offline")
os.environ.setdefault("MODEL_COMPOSE", "offline")
os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
# Evals never touch real services; these only satisfy the settings model.
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/evals")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("UPSELL_SERVICE_SHARED_SECRET", "evals")

from typing import Any

from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

from upsell_agent.agent.turn import TurnDeps, run_turn
from upsell_agent.config import get_settings
from upsell_agent.devtools import simulate
from upsell_agent.integrations import mongodb
from upsell_agent.observability.trace import MemoryTraceSink

DEALER = simulate.DEV_DEALERS[0]["_id"]


def uses_real_models() -> bool:
    settings = get_settings()
    return "offline" not in (settings.model_extract, settings.model_compose)


async def run_case(case: dict[str, Any]) -> dict[str, Any]:
    """case: text, lead_type (sales), channel (sms), trigger (inbound_message
    or lead_created), earlier (customer messages answered first), campaign
    (a campaign name the customer is replying to)."""
    mongodb.set_db_for_tests(AsyncMongoMockClient()[f"evals_{ObjectId()}"])
    channel = case.get("channel", "sms")
    trigger = case.get("trigger", "inbound_message")
    created = await simulate.create_lead(
        DEALER, lead_type=case.get("lead_type", "sales"), channel=channel, name="Maria Test",
        comments=case["text"] if trigger == "lead_created" else "")
    if case.get("campaign"):
        db = mongodb.get_db()
        campaign_id = ObjectId()
        await db["campaigns"].insert_one({
            "_id": campaign_id, "name": case["campaign"], "description": "", "message_type": channel,
            "dealer_id": ObjectId(DEALER), "message_content": {"subject": "", "body": case.get("campaign_body", "")}})
        from upsell_agent import clock

        await db["campaignleads"].insert_one({"campaign_id": str(campaign_id), "lead_id": ObjectId(created["lead_id"]),
                                              "dealer_id": DEALER, "status": "sent", "sent_at": clock.now()})

    async def turn(text: str, trig: str) -> dict:
        return await run_turn(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                              trigger=trig, channel=channel, inbound_text=text, shadow=False,
                              deps=TurnDeps(settings=get_settings(), sink=MemoryTraceSink()),
                              source_message_id=f"eval-{ObjectId()}")

    for earlier in case.get("earlier", []):
        await turn(earlier, "inbound_message")
    log = await turn(case["text"], trigger)
    guards = [n for n in log["nodes"] if n["node"] == "guard" and n["status"] == "done"]
    composes = [n for n in log["nodes"] if n["node"] == "compose" and n["status"] == "done"]
    summary = log["summary"]
    return {
        "reply": summary.get("reply") or "",
        "outcome": log["outcome"],
        "asked": summary.get("asked") or [],
        "used_fallback": bool(summary.get("used_fallback")),
        "flag_human": bool(summary.get("flag_human")),
        "guard_passed_first_time": bool(guards and guards[0]["output"].get("passed")),
        "guard_violations": [v for g in guards for v in g["output"].get("violations", [])],
        "draft": (composes[-1]["output"] if composes else None),
    }
