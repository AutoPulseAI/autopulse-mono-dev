"""/dev/* — the Debug UI's API (MASTER_PLAN_1 Stage 3).

Only registered when ENVIRONMENT=DEV (see main.create_app). In any other
environment these routes do not exist, so they return 404 — there is no
runtime flag to flip. Local-only tool, so no auth; every per-lead query is
still scoped by dealer_id.
"""

import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from upsell_agent import clock
from upsell_agent.agent import call_tasks
from upsell_agent.agent.conversation import load_conversation
from upsell_agent.agent.llm import OFFLINE
from upsell_agent.agent.pipeline import pipeline_definition
from upsell_agent.agent.summary import load_summary
from upsell_agent.agent.turn import LEADS_COLLECTION
from upsell_agent.api.call_tasks import view as call_task_view
from upsell_agent.api.leads import lead_profile
from upsell_agent.api.webhooks import FIRE_JOB
from upsell_agent.channels.delivery import apply_delivery_status
from upsell_agent.config import get_settings
from upsell_agent.devtools import scenarios, simulate
from upsell_agent.integrations.dealer_profile import dealer_profile
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    as_object_id,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.integrations.redis_client import get_redis
from upsell_agent.observability.trace import DEV_TRACE_CHANNEL
from upsell_agent.scheduler.followups import CHANNEL_SWITCHES, KIND_CHANNEL_SWITCH
from upsell_agent.slots.policy import MAX_ASKS_PER_SLOT
from upsell_agent.slots.schema import SCHEMA

router = APIRouter(prefix="/dev", tags=["dev"])


def _json(doc: Any) -> Any:
    """ObjectId/datetime-safe copy for JSON responses."""
    if isinstance(doc, dict):
        return {("id" if k == "_id" else k): _json(v) for k, v in doc.items()}
    if isinstance(doc, list):
        return [_json(v) for v in doc]
    if isinstance(doc, ObjectId):
        return str(doc)
    if isinstance(doc, datetime):
        # Mongo hands back naive UTC; mark it so the browser doesn't read it as local time.
        return (doc if doc.tzinfo else doc.replace(tzinfo=UTC)).isoformat()
    return doc


_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def _time_key(value: datetime | None) -> datetime:
    """Sort key that tolerates missing and naive (Mongo-returned) datetimes."""
    if value is None:
        return _EPOCH
    return value if value.tzinfo else value.replace(tzinfo=UTC)


@router.get("/ping")
async def ping() -> dict:
    """Also which models are running (MASTER_PLAN_2 Phase 9): the Debug UI shows
    them, and shows the offline model's test tags only when it's the one running."""
    settings = get_settings()
    models = {"extract": settings.model_extract, "compose": settings.model_compose}
    return {"environment": "DEV", "now": clock.now().isoformat(), "models": models,
            "offline": OFFLINE in models.values()}


@router.get("/pipeline")
async def pipeline() -> dict:
    return pipeline_definition()


@router.get("/stream")
async def stream(request: Request, dealer_id: str | None = None, lead_id: str | None = None):
    """Live trace events as server-sent events, optionally filtered to one dealer/lead."""

    async def events():
        pubsub = get_redis().pubsub()
        await pubsub.subscribe(DEV_TRACE_CHANNEL)
        try:
            while not await request.is_disconnected():
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if not message:
                    continue
                event = json.loads(message["data"])
                if dealer_id and event.get("dealer_id") != dealer_id:
                    continue
                if lead_id and event.get("lead_id") != lead_id:
                    continue
                yield {"event": "trace", "data": json.dumps(event)}
        finally:
            await pubsub.unsubscribe(DEV_TRACE_CHANNEL)
            await pubsub.aclose()

    return EventSourceResponse(events(), ping=15)


# --- Dealers and leads -------------------------------------------------------

@router.get("/dealers")
async def dealers() -> list[dict]:
    """The dev dealers, with the timezone and opening hours their rules run
    in (the Debug UI shows the dealer's local time next to Pakistan time)."""
    await simulate.ensure_dev_dealers()
    out = []
    for doc in await get_db()[simulate.DEV_DEALERS_COLLECTION].find({}).to_list(None):
        profile = await dealer_profile(str(doc["_id"]))
        out.append({**doc, "time_zone": profile.timezone, "hours": profile.hours_view(),
                    "hours_from_record": profile.hours_from_record})
    return _json(out)


@router.get("/leads")
async def leads(dealer_id: str) -> list[dict]:
    db = dealer_scoped_db(dealer_id)
    lead_docs = await db.collection(LEADS_COLLECTION).find({}).sort("_id", -1).to_list(200)
    states = {s["lead_id"]: s for s in await db.collection(AI_LEAD_STATE_COLLECTION).find({}).to_list(None)}
    out = []
    for lead in lead_docs:
        lead_id = str(lead["_id"])
        state = states.get(lead_id, {})
        data = lead.get("data") or {}
        out.append({
            "id": lead_id, "customer_id": str(lead.get("customer_id")), "name": lead.get("name"),
            "lead_type": data.get("lead_type") or state.get("lead_type"), "channel": data.get("channel", "sms"),
            "comments": data.get("comments", ""), "status": state.get("status", "new"),
            "status_reason": state.get("status_reason"),
            # MASTER_PLAN_3 C3: the lifecycle stage (agent/lifecycle.py).
            "stage": state.get("stage"), "stage_label": state.get("stage_label"),
        })
    return out


class NewLead(BaseModel):
    dealer_id: str
    lead_type: Literal["sales", "trade_in", "service", "general"] = "sales"
    channel: Literal["sms", "email"] = "sms"
    name: str = Field(min_length=1)
    comments: str = ""
    # A second lead for the same person: shares that lead's phone and email (MASTER_PLAN_3 C6).
    same_contact_as: str | None = None


@router.post("/simulate/lead")
async def simulate_lead(body: NewLead, request: Request) -> dict:
    created = await simulate.create_lead(body.dealer_id, lead_type=body.lead_type, channel=body.channel,
                                         name=body.name, comments=body.comments)
    await simulate.set_contact(body.dealer_id, created, body.same_contact_as)
    result = await simulate.send_lead_created(body.dealer_id, created["lead_id"], created["customer_id"],
                                              body.channel, request.app.state.enqueue)
    return {**created, "event": result.status}


class Reply(BaseModel):
    dealer_id: str
    lead_id: str
    channel: Literal["sms", "email"] = "sms"
    text: str = Field(min_length=1)


@router.post("/simulate/reply")
async def simulate_reply(body: Reply, request: Request) -> dict:
    try:
        result = await simulate.send_reply(body.dealer_id, body.lead_id, body.channel, body.text,
                                           request.app.state.enqueue)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"event": result.status}


class StaffStatus(BaseModel):
    dealer_id: str
    status: Literal["Appointment Booked", "Visited", "Sold", "DND", "Managerial Review",
                    "Sold Pending", "Sold Delivered", "Unsold"]
    # Visited only: how the visit ended (MASTER_PLAN_3 C5); sent with it as one event.
    manager_outcome: Literal["Sold Pending", "Sold Delivered", "Unsold"] | None = None
    # Appointment Booked only: dealer-local ISO date-time ("2026-10-08T15:00").
    booking_at: str | None = None


@router.post("/leads/{lead_id}/staff/status")
async def staff_status(lead_id: str, body: StaffStatus, request: Request) -> dict:
    """Plays staff moving the lead on the platform's status screen (MASTER_PLAN_3 C3): the Lead's status
    is saved and the AI gets `lead-paused`, exactly as the platform's status route sends it."""
    booking_at = None
    if body.booking_at:
        dealer = await dealer_profile(body.dealer_id)
        booking_at = datetime.fromisoformat(body.booking_at).replace(tzinfo=dealer.tz).astimezone(UTC).isoformat()
    try:
        result = await simulate.send_staff_status(body.dealer_id, lead_id, body.status, request.app.state.enqueue,
                                                  booking_at=booking_at, manager_outcome=body.manager_outcome)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"event": result.status}


class LeadAction(BaseModel):
    dealer_id: str
    reason: str | None = None


@router.post("/leads/{lead_id}/{action}")
async def lead_action(lead_id: str, action: Literal["pause", "resume"], body: LeadAction, request: Request) -> dict:
    from upsell_agent.events.intake import accept_event
    from upsell_agent.events.models import LeadPausedEvent, LeadResumedEvent

    event_id = str(ObjectId())
    if action == "pause":
        event = LeadPausedEvent(event_id=event_id, dealer_id=body.dealer_id, lead_id=lead_id, reason=body.reason)
    else:
        event = LeadResumedEvent(event_id=event_id, dealer_id=body.dealer_id, lead_id=lead_id)
    result = await accept_event(f"lead-{action}d", event, request.app.state.enqueue)
    return {"event": result.status}


@router.get("/leads/{lead_id}/conversation")
async def conversation(lead_id: str, dealer_id: str) -> list[dict]:
    """The lead's comments, every customer message, and every message the AI
    sent (or tried to), in time order. Each outbound message carries its send
    status: sent, failed, suppressed (no contact / opted out), shadow,
    unknown. A turn that sent nothing (e.g. the customer sent STOP) shows its
    draft instead, marked `kind: draft`."""
    db = dealer_scoped_db(dealer_id)
    lead = await db.collection(LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})
    if lead is None:
        raise HTTPException(status_code=404, detail="lead not found")
    items: list[dict] = []
    comments = (lead.get("data") or {}).get("comments") or lead.get("comments")
    if comments:
        items.append({"direction": "inbound", "kind": "lead", "channel": (lead.get("data") or {}).get("channel", "sms"),
                      "text": comments, "at": lead.get("createdAt")})
    turns_with_messages: set[str] = set()
    for msg in await db.collection(AI_MESSAGES_COLLECTION).find({"lead_id": lead_id}).to_list(None):
        if msg["direction"] == "outbound":
            turns_with_messages.add(msg.get("turn_id"))
        items.append({
            "direction": msg["direction"], "kind": "message", "channel": msg["channel"], "text": msg["text"],
            "at": msg.get("sent_at") or msg["created_at"], "status": msg.get("status"),
            "to": msg.get("to"), "reason": msg.get("reason"), "turn_id": msg.get("turn_id"),
            "latency_ms": msg.get("latency_ms"), "platform_record_id": msg.get("platform_record_id"),
            "sent": msg["direction"] == "outbound" and msg.get("status") == "sent",
            "delivery_status": msg.get("delivery_status"), "is_fallback": msg.get("is_fallback", False),
            "message_id": str(msg["_id"]),
            # MASTER_PLAN_4 F3: the vehicle photo the message carried (MMS / inline email image).
            "media_urls": list(msg.get("media_urls") or []),
        })
    for turn in await db.collection(AI_TURN_LOG_COLLECTION).find({"lead_id": lead_id}).to_list(None):
        summary = turn.get("summary") or {}
        reply = summary.get("reply")
        # A turn that attempted a send already shows as that message (a channel
        # switch or staff check sends under its own id, not the turn's).
        if reply and not summary.get("send_status") and turn["turn_id"] not in turns_with_messages:
            items.append({"direction": "outbound", "kind": "draft", "channel": turn.get("channel"), "text": reply,
                          "at": turn.get("created_at"), "turn_id": turn["turn_id"], "outcome": turn.get("outcome"),
                          "status": "not sent", "sent": False})
    items.sort(key=lambda i: _time_key(i["at"]))
    return _json(items)


@router.get("/leads/{lead_id}/slots")
async def slots(lead_id: str, dealer_id: str) -> dict:
    """The lead's real profile (same as GET /v1/leads/{id}/profile)."""
    profile = await lead_profile(dealer_id, lead_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="lead not found")
    state = await dealer_scoped_db(dealer_id).collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) or {}
    return _json({**profile, "implemented": True, "status": profile["lead"]["status"],
                  "status_reason": profile["lead"]["status_reason"],
                  "conversation": conversation_view(state), "summary": load_summary(state).model_dump()})


def conversation_view(state: dict) -> dict:
    """The conversation state for the Debug UI's Conversation panel: each asked
    detail with its label and whether it was just asked or is asked out."""
    conversation = load_conversation(state)
    asks = [{"path": path, "label": SCHEMA[path].label if path in SCHEMA else path, "count": a.count,
             "last_reply": a.last_turn,
             "status": ("just asked" if path in conversation.last_asked
                        else "asked out" if a.count >= MAX_ASKS_PER_SLOT else "")}
            for path, a in sorted(conversation.asks.items(), key=lambda kv: -kv[1].last_turn)]
    topic = conversation.last_topic
    for path in SCHEMA:
        if topic and path in topic:
            topic = topic.replace(path, SCHEMA[path].label.lower())
    return {**conversation.model_dump(mode="json"), "asks": asks, "max_asks": MAX_ASKS_PER_SLOT, "last_topic": topic}


# --- Turns (for the timeline and replay) -------------------------------------

@router.get("/turns")
async def turns(dealer_id: str, lead_id: str) -> list[dict]:
    docs = await dealer_scoped_db(dealer_id).collection(AI_TURN_LOG_COLLECTION).find({"lead_id": lead_id}).to_list(None)
    docs.sort(key=lambda t: t["created_at"])
    return _json([{"turn_id": d["turn_id"], "trigger": d.get("trigger"), "channel": d.get("channel"),
                   "outcome": d.get("outcome"), "created_at": d["created_at"], "ms": d.get("ms")} for d in docs])


@router.get("/turns/{turn_id}")
async def turn(turn_id: str, dealer_id: str) -> dict:
    doc = await dealer_scoped_db(dealer_id).collection(AI_TURN_LOG_COLLECTION).find_one({"turn_id": turn_id})
    if doc is None:
        raise HTTPException(status_code=404, detail="turn not found")
    return _json(doc)


# --- Scheduler and clock -----------------------------------------------------

@router.get("/clock")
async def get_clock() -> dict:
    await clock.sync(get_redis())
    return {"now": clock.now().isoformat(), "offset_s": clock.offset_s()}


class Advance(BaseModel):
    seconds: float = Field(gt=0, le=30 * 24 * 3600)


async def _fire_followups_now(request: Request, why: str) -> None:
    """Don't make the developer wait for the next minute's cron tick."""
    await request.app.state.enqueue(FIRE_JOB, key=f"{FIRE_JOB}:dev:{why}:{uuid.uuid4().hex[:8]}")


@router.post("/clock/advance")
async def advance_clock(body: Advance, request: Request) -> dict:
    offset = await clock.advance(get_redis(), body.seconds)
    await _fire_followups_now(request, "clock")
    # MASTER_PLAN_3 C3: a jump past Day 91 closes leads now, not at the next hourly cron.
    await request.app.state.enqueue("close_expired_leads", key=f"close_expired_leads:dev:{uuid.uuid4().hex[:8]}")
    return {"now": clock.now().isoformat(), "offset_s": offset}


class ToDealerTime(BaseModel):
    dealer_id: str
    time: str = Field(default="11:00", pattern=r"^\d{1,2}:\d{2}$")
    # Skip Saturday and Sunday (the dev dealers are open Monday-Friday).
    weekdays_only: bool = True


@router.post("/clock/to-dealer-time")
async def clock_to_dealer_time(body: ToDealerTime, request: Request) -> dict:
    """Moves the dev clock to the next HH:MM (strictly later than now) on the dealer's own clock, so a test starts
    at a known hour without clicking +1 hour until it gets there."""
    from datetime import timedelta

    profile = await dealer_profile(body.dealer_id)
    hour, minute = (int(x) for x in body.time.split(":"))
    now = clock.now().astimezone(profile.tz)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    while target <= now or (body.weekdays_only and target.weekday() >= 5):
        target += timedelta(days=1)
    offset = await clock.advance(get_redis(), (target - now).total_seconds())
    await _fire_followups_now(request, "clock")
    return {"now": clock.now().isoformat(), "offset_s": offset, "dealer_time": target.strftime("%a %H:%M")}


@router.post("/clock/reset")
async def reset_clock() -> dict:
    await clock.reset(get_redis())
    return {"now": clock.now().isoformat(), "offset_s": 0.0}


@router.get("/followups")
async def followups(dealer_id: str, lead_id: str | None = None) -> list[dict]:
    flt = {"lead_id": lead_id} if lead_id else {}
    docs = await dealer_scoped_db(dealer_id).collection(SCHEDULED_FOLLOWUPS_COLLECTION).find(flt).to_list(500)
    docs = [{**d, "kind": d.get("kind") or KIND_CHANNEL_SWITCH} for d in docs]
    return _json(sorted(docs, key=lambda d: _time_key(d.get("due_at"))))


@router.post("/followups/{followup_id}/fail-sms")
async def fail_sms(followup_id: str, request: Request, dealer_id: str = Query(...)) -> dict:
    """Simulates the provider reporting the ORIGINAL message as undelivered.
    Goes through the same code as a real Twilio / SendGrid callback, so the
    follow-up becomes due now and fires (architecture §6, "Failed SMS")."""
    doc = await dealer_scoped_db(dealer_id).collection(SCHEDULED_FOLLOWUPS_COLLECTION).find_one(
        {"_id": as_object_id(followup_id), "status": "pending", **CHANNEL_SWITCHES})
    if doc is None:
        raise HTTPException(status_code=404, detail="no pending channel switch with that id")
    failure = "undelivered" if doc["from_channel"] == "sms" else "bounced"
    result = await apply_delivery_status(
        request.app.state.platform, failure, provider_id=doc.get("source_provider_id"),
        idempotency_key=f"{doc['source_turn_id']}:{doc['from_channel']}", error="simulated in the Debug UI")
    if result.followup_due_now:
        await _fire_followups_now(request, "failed")
    return {"status": "due_now" if result.followup_due_now else "unchanged", "detail": result.detail}


class DeliveryUpdate(BaseModel):
    status: Literal["delivered", "failed", "undelivered", "bounced", "opened"]
    # A hard bounce / a number that can never receive texts: the address is marked invalid (C6).
    hard: bool = False


@router.post("/messages/{message_id}/status")
async def message_status(message_id: str, body: DeliveryUpdate, request: Request, dealer_id: str = Query(...)) -> dict:
    """Simulates a Twilio / SendGrid delivery callback for one sent message."""
    row = await dealer_scoped_db(dealer_id).collection(AI_MESSAGES_COLLECTION).find_one(
        {"_id": as_object_id(message_id), "direction": "outbound"})
    if row is None:
        raise HTTPException(status_code=404, detail="no outbound message with that id")
    result = await apply_delivery_status(request.app.state.platform, body.status,
                                         provider_id=row.get("provider_id"),
                                         idempotency_key=row.get("idempotency_key"), error="simulated",
                                         hard=body.hard)
    if result.followup_due_now:
        await _fire_followups_now(request, "failed")
    return _json(result.as_dict())


# --- Staff call tasks (MASTER_PLAN_3 C2) -----------------------------------------

@router.get("/call-tasks")
async def dev_call_tasks(dealer_id: str) -> list[dict]:
    """Every call task of the dealer, newest first (the platform reads /v1/call-tasks with the shared secret)."""
    rows = await dealer_scoped_db(dealer_id).collection(AI_CALL_TASKS_COLLECTION).find({}).sort(
        "opened_at", -1).to_list(100)
    return [call_task_view(r) for r in rows]


class CallTaskDone(BaseModel):
    dealer_id: str
    outcome: Literal["connected", "no_answer", "voicemail", "wrong_number", "other"] | None = None


@router.post("/call-tasks/{task_id}/{action}")
async def dev_call_task_resolve(task_id: str, action: Literal["complete", "dismiss"], body: CallTaskDone) -> dict:
    task = await call_tasks.resolve(
        dealer_scoped_db(body.dealer_id), task_id,
        status=call_tasks.COMPLETED if action == "complete" else call_tasks.DISMISSED,
        outcome=body.outcome, by="debug-ui")
    if task is None:
        raise HTTPException(status_code=404, detail="no call task with that id")
    return call_task_view(task)


# --- Stock (MASTER_PLAN_3 Phase 6 item 3) -------------------------------------

@router.post("/stock/{vin}/mark-sold")
async def mark_sold(vin: str, dealer_id: str = Query(...)) -> dict:
    """A simulator shortcut for testing freshness (Phase 5) by hand: removes
    this vehicle from the dealer's dev stock, the same as it dropping out of
    a real feed. `get_vehicle`/`find_sold` then see it as sold immediately -
    the 60s search cache is cleared too, so the next reply reflects it."""
    from upsell_agent.integrations.mongodb import PLATFORM_VEHICLES_COLLECTION
    from upsell_agent.tools.inventory_tool import clear_cache

    result = await dealer_scoped_db(dealer_id).collection(
        PLATFORM_VEHICLES_COLLECTION, dealer_field="dealerId").delete_one({"vin": vin})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="no such vehicle for this dealer")
    clear_cache()
    return {"status": "sold", "vin": vin}


# --- Metrics -----------------------------------------------------------------

@router.get("/metrics")
async def metrics(dealer_id: str, days: float = Query(7, gt=0, le=90)) -> dict:
    """Same numbers as GET /v1/metrics (observability/metrics.py)."""
    from upsell_agent.observability.metrics import dealer_metrics

    return _json(await dealer_metrics(dealer_id, days))


@router.get("/rollout-check")
async def rollout_check(dealer_id: str, days: float = Query(7, gt=0, le=90)) -> dict:
    """Same as GET /v1/rollout-check (observability/rollout.py)."""
    from upsell_agent.observability.rollout import rollout_check as check

    return _json(await check(dealer_id, days))


# --- Shadow comparison (Stage 13) --------------------------------------------

@router.get("/shadow")
async def shadow(dealer_id: str, days: float = Query(7, gt=0, le=90)) -> dict:
    """AI drafts next to what the customer actually received (devtools/shadow.py)."""
    from upsell_agent.devtools.shadow import shadow_pairs

    return _json(await shadow_pairs(dealer_id, days))


class ShadowReview(BaseModel):
    dealer_id: str
    turn_id: str
    verdict: Literal["better", "same", "worse", "unsafe"]
    note: str | None = None


@router.post("/shadow/review")
async def shadow_review(body: ShadowReview) -> dict:
    from upsell_agent.devtools.shadow import save_review

    await save_review(body.dealer_id, body.turn_id, body.verdict, body.note)
    return {"status": "saved"}


# --- Scenarios ---------------------------------------------------------------

@router.get("/scenarios")
async def list_scenarios() -> list[dict]:
    runs = await scenarios.last_runs()
    out = []
    for s in scenarios.load_scenarios():
        run = runs.get(s["id"])
        out.append({"id": s["id"], "name": s.get("name", s["id"]), "stage": s.get("stage"),
                    "description": s.get("description", ""), "steps": len(s.get("steps", [])),
                    "last_run": _json(run) if run else None})
    return sorted(out, key=lambda s: (s["stage"] or 0, s["id"]))


class RunScenarios(BaseModel):
    ids: list[str] | None = None


_run_lock = asyncio.Lock()


@router.post("/scenarios/run")
async def run_scenarios(body: RunScenarios, request: Request) -> list[dict]:
    if _run_lock.locked():
        raise HTTPException(status_code=409, detail="A scenario run is already in progress")
    async with _run_lock:
        try:
            runs = await scenarios.run_all(request.app.state.enqueue, request.app.state.queue, body.ids)
        except scenarios.RealModelsRefused as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _json(runs)
