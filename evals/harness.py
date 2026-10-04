"""Runs real conversations for evals: the whole pipeline (extract, validate,
decide, compose, guard, fallback) and the sender (to the fake driver), through
the same event handlers the worker uses, on an in-memory database, with
whichever models are configured (MODEL_EXTRACT / MODEL_COMPOSE; "offline" by
default).

- `run_case`: one reply, with optional earlier messages, campaign, and planted
  context (a rolling summary, dealer details) for the injection suite. Used by
  evals/test_replies.py and evals/promptfoo/provider.py.
- `run_conversation`: a multi-turn conversation, every turn recorded
  (MASTER_PLAN_2 Phase 10, evals/test_conversations.py).

Both judge exactly what a customer would receive. The dealer is the dev dealer
A (New York, with store details and opening hours), and the clock is Tuesday,
September 22 2026, 10:00 in New York, so date answers are checkable.
"""

import os

os.environ.setdefault("MODEL_EXTRACT", "offline")
os.environ.setdefault("MODEL_COMPOSE", "offline")
os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
# Evals never touch real services; these only satisfy the settings model.
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/evals")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("UPSELL_SERVICE_SHARED_SECRET", "evals")

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

from upsell_agent import clock
from upsell_agent.agent import llm
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.compliance import engine
from upsell_agent.compliance.customer_zone import CustomerZone
from upsell_agent.config import get_settings
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations import dealer_profile, mongodb
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    PLATFORM_VEHICLES_COLLECTION,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink

DEALER = simulate.DEV_DEALERS[0]["_id"]
EVAL_NOW = datetime(2026, 9, 22, 10, 0, tzinfo=ZoneInfo("America/New_York"))
REPLY_TRIGGERS = ("lead_created", "inbound_message")


def uses_real_models() -> bool:
    settings = get_settings()
    return "offline" not in (settings.model_extract, settings.model_compose)


async def _new_york_customer(_db, _customer_id, _phone) -> CustomerZone:
    return CustomerZone(("America/New_York",), "zip", "ZIP 10001 (evals)", "NY")


def _deps() -> TurnDeps:
    return TurnDeps(settings=get_settings(), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


def _vehicle(vin: str, **overrides: Any) -> dict[str, Any]:
    """One `vehicles` row, shaped like the vAuto feed (MASTER_PLAN_3 Phase 7
    item 1). `overrides` uses the same friendly names a case's `stock` list
    does: year, make, model, trim, body, condition, color, miles."""
    row = {"dealerId": DEALER, "vin": vin, "year": 2022, "make": "Toyota", "model": "RAV4", "trim": "LE",
          "body": "SUV", "condition": "used", "color": "White", "miles": 20000}
    row.update(overrides)
    return {
        "dealerId": row["dealerId"], "vin": vin, "year": row["year"], "make": row["make"], "model": row["model"],
        "trim": row["trim"], "body": row["body"], "condition": row["condition"], "exteriorcolor": row["color"],
        "mileage": row["miles"], "internetreduced": 25000, "instoreprice": 26500,
        "inventoryUrl": f"https://dev.example/{vin}", "imagesSecure": [f"https://dev.example/{vin}.jpg"],
        "createdAt": clock.now(),
    }


async def _setup(case: dict[str, Any]) -> dict[str, str]:
    """A fresh database with the dev dealers, the clock at EVAL_NOW, and a new
    lead (whose first reply runs when `comments` is given or the trigger is a new lead)."""
    mongodb.set_db_for_tests(AsyncMongoMockClient()[f"evals_{ObjectId()}"])
    # Each case runs in its own event loop (asyncio.run); a cached agent's OpenAI client is bound to the
    # previous one, and a real model then fails with "Event loop is closed" and the turn sends the template
    # (found by stream G's grammar eval). Fresh agents per case.
    for agent in (llm.extract_agent, llm.compose_agent, llm.summary_agent):
        agent.cache_clear()
    dealer_profile.clear_cache()
    # Dev customers have 555 phones and no DealerVault address, so the send
    # check would use only hours legal in every US zone, and a campaign reply
    # at 10:00 New York (7:00 Los Angeles) would be held to "no questions"
    # (MASTER_PLAN_3 C1). The evals judge replies, not zones: customers are in New York.
    engine.customer_zone = _new_york_customer
    # tools/inventory_tool.py's 60s cache is a module-level global, keyed by
    # dealer_id + params - the same dealer_id across every eval case sharing
    # this process, so a stale hit from an earlier case's (different)
    # database is otherwise possible within the TTL window.
    from upsell_agent.tools.inventory_tool import clear_cache as clear_inventory_cache

    clear_inventory_cache()
    clock.set_offset((EVAL_NOW - datetime.now(UTC)).total_seconds())
    await simulate.ensure_platform_dealers()
    if case.get("dealer_info"):
        info = {f"dealer_account_information.{k}": v for k, v in case["dealer_info"].items()}
        await mongodb.get_db()[PLATFORM_USERS_COLLECTION].update_one({"_id": ObjectId(DEALER)}, {"$set": info})
    for i, row in enumerate(case.get("stock", [])):
        vin = row.pop("vin", None) or f"EVALVIN{i:010d}"
        await mongodb.get_db()[PLATFORM_VEHICLES_COLLECTION].insert_one(_vehicle(vin, **row))
    return await simulate.create_lead(DEALER, lead_type=case.get("lead_type", "sales"),
                                      channel=case.get("channel", "sms"), name="Maria Test",
                                      comments=case.get("comments", ""))


async def _first_reply(created: dict[str, str], channel: str) -> None:
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel=channel), _deps())


async def _say(created: dict[str, str], text: str, channel: str) -> dict[str, Any]:
    message_id = str(ObjectId())
    return await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=message_id, dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel=channel, message_id=message_id, text=text, received_at=clock.now()), _deps())


async def _logs(created: dict[str, str]) -> list[dict]:
    return await mongodb.get_db()[AI_TURN_LOG_COLLECTION].find(
        {"lead_id": created["lead_id"]}).sort("created_at", 1).to_list(None)


def _turn_view(log: dict) -> dict[str, Any]:
    nodes = {n["node"]: n for n in log["nodes"] if n.get("status") == "done"}
    guards = [n for n in log["nodes"] if n["node"] == "guard" and n.get("status") == "done"]
    summary = log.get("summary") or {}
    return {
        "trigger": log["trigger"],
        "customer": (log.get("input") or {}).get("text", ""),
        "reply": summary.get("reply") or "",
        "outcome": log["outcome"],
        "asked": summary.get("asked") or [],
        "used_fallback": bool(summary.get("used_fallback")),
        "flag_human": bool(summary.get("flag_human")),
        "guard_passed_first_time": bool(guards and guards[0]["output"].get("passed")),
        "guard_violations": [v for g in guards for v in g["output"].get("violations", [])],
        "draft": (nodes.get("compose") or {}).get("output"),
        "decision": (nodes.get("decide") or {}).get("output"),
        "inventory": (nodes.get("search_stock") or {}).get("output"),
        "questions": ((nodes.get("extract") or {}).get("output") or {}).get("questions", []),
        "cost_usd": float(summary.get("cost_usd") or 0), "ms": log.get("ms"),
    }


async def run_case(case: dict[str, Any]) -> dict[str, Any]:
    """One reply. case: text, lead_type (sales), channel (sms), trigger
    (inbound_message or lead_created), earlier (customer messages answered
    first), campaign (name the customer is replying to), summary (a rolling
    summary planted on the lead), dealer_info (fields set on the dealer's record)."""
    channel = case.get("channel", "sms")
    trigger = case.get("trigger", "inbound_message")
    created = await _setup({**case, "comments": case["text"] if trigger == "lead_created" else ""})
    if case.get("campaign"):
        db = mongodb.get_db()
        campaign_id = ObjectId()
        await db["campaigns"].insert_one({
            "_id": campaign_id, "name": case["campaign"], "description": "", "message_type": channel,
            "dealer_id": ObjectId(DEALER), "message_content": {"subject": "", "body": case.get("campaign_body", "")}})
        await db["campaignleads"].insert_one({"campaign_id": str(campaign_id), "lead_id": ObjectId(created["lead_id"]),
                                              "dealer_id": DEALER, "status": "sent", "sent_at": clock.now()})
    if trigger == "lead_created":
        await _first_reply(created, channel)
    else:
        for earlier in case.get("earlier", []):
            await _say(created, earlier, channel)
        if case.get("summary"):
            await mongodb.get_db()[AI_LEAD_STATE_COLLECTION].update_one(
                {"lead_id": created["lead_id"]},
                {"$set": {"summary": {"text": case["summary"], "messages": 6, "covers_until": None}},
                 "$setOnInsert": {"dealer_id": DEALER, "status": "active", "customer_id": created["customer_id"]}},
                upsert=True)
        await _say(created, case["text"], channel)
    logs = [log for log in await _logs(created) if log["trigger"] in REPLY_TRIGGERS]
    return _turn_view(logs[-1])


async def run_conversation(case: dict[str, Any]) -> dict[str, Any]:
    """A whole conversation: the lead (and its first reply), then each of
    `messages` from the customer, answered in turn. Returns every turn, the
    final profile and conversation state, and the customer messages left
    without a reply or a reason (there must be none)."""
    channel = case.get("channel", "sms")
    created = await _setup(case)
    await _first_reply(created, channel)
    for text in case.get("messages", []):
        await _say(created, text, channel)
    db = mongodb.get_db()
    from upsell_agent.api.leads import lead_profile

    profile = await lead_profile(DEALER, created["lead_id"])
    state = await db[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}
    unanswered = await db[AI_MESSAGES_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "direction": "inbound", "answered_turn_id": None})
    turns = [_turn_view(log) for log in await _logs(created)]
    return {"turns": turns, "replies": [t for t in turns if t["trigger"] in REPLY_TRIGGERS],
            "slots": {s["path"]: s for s in profile["slots"]}, "status": state.get("status"),
            "conversation": state.get("conversation") or {}, "unanswered": unanswered}
