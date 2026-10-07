"""Reads for the CRM's staff screens (MASTER_PLAN_4 stream C2): the AI Alerts
page, the Call Tasks page and the AI panel on a lead
(aidmvcs-be-dev/app/dealer/ai/**, proxied by app/api/dealer-ai/**).

  GET  /v1/staff/notices?dealer_id=...&include_handled=false
        every lead's current staff notice (call requests, bad contact, possible
        opt-out, visit booked/cancelled, ...), staff alert (no staff response
        after a handoff) and open handoff, newest first, each with whether
        staff have marked it handled.
  POST /v1/staff/notices/{lead_id}/handled   {dealer_id, source, by?}
        staff dealt with it. Kept beside the notice (`handled_notices`), never
        on it, so the AI's own reads and unsets of `staff_notice` are untouched.
        A newer notice on the same lead shows as unhandled again.
  GET  /v1/staff/call-tasks?dealer_id=...&view=open|upcoming|done
        the call tasks with the lead's stage and last AI touch; `upcoming` is
        the 60-minute timers still waiting (agent/call_tasks.py).
  GET  /v1/staff/leads/{lead_id}/consent?dealer_id=...
        per channel (sms, email, voice): opted out or not, and whether the
        address on file was marked invalid; plus an open possible-opt-out review.

Shared-secret auth like the other /v1 routes; every read is dealer-scoped.
Nothing here changes what the AI does.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from upsell_agent import clock
from upsell_agent.agent import cadence, call_tasks, lifecycle
from upsell_agent.agent.customer_key import lead_customer_id
from upsell_agent.api.auth import require_internal_auth
from upsell_agent.channels import consent
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    as_object_id,
    dealer_scoped_db,
)

router = APIRouter(prefix="/v1/staff", tags=["staff"], dependencies=[Depends(require_internal_auth)])

LIMIT = 300


def _iso(value: Any) -> Any:
    if not isinstance(value, datetime):
        return value
    return (value if value.tzinfo else value.replace(tzinfo=UTC)).isoformat()


def _same_time(a: Any, b: Any) -> bool:
    return a is not None and b is not None and _iso(a) == _iso(b)


def notices_for(state: dict[str, Any]) -> list[dict[str, Any]]:
    """The notices one lead state carries, as the Alerts page lists them."""
    lead_id = state.get("lead_id")
    handled = state.get("handled_notices") or {}
    stage = {"stage": state.get("stage"), "stage_label": lifecycle.label(state.get("stage"))}
    out: list[dict[str, Any]] = []

    def add(source: str, at: Any, kind: str, text: str | None, extra: dict[str, Any] | None = None) -> None:
        mark = handled.get(source) or {}
        is_handled = _same_time(mark.get("notice_at"), at)
        out.append({"id": f"{lead_id}.{source}", "lead_id": lead_id, "customer_id": state.get("customer_id"),
                    "source": source, "kind": kind, "text": text, "at": _iso(at), **stage, **(extra or {}),
                    "handled": is_handled, "handled_at": _iso(mark.get("at")) if is_handled else None,
                    "handled_by": mark.get("by") if is_handled else None})

    notice = state.get("staff_notice")
    if notice and notice.get("at"):
        # Other fields a notice may carry (a service request's preferred time and notes, a reason...) pass through.
        extra = {k: _iso(v) for k, v in notice.items() if k not in ("at", "kind", "text")}
        add("notice", notice["at"], notice.get("kind") or "notice", notice.get("text"), extra)
    alert = state.get("staff_alert")
    if alert and alert.get("at"):
        add("alert", alert["at"], "no_staff_response", alert.get("reason"),
            {"handoff_reason": alert.get("handoff_reason"), "customer_notified": alert.get("customer_notified")})
    if state.get("status") == "handoff" and state.get("status_at"):
        add("handoff", state["status_at"], "handoff", state.get("status_reason"))
    not_interested = ((state.get("conversation") or {}).get("not_interested") or {}).get("reason")
    if not_interested and state.get("last_turn_at"):
        add("not_interested", state["last_turn_at"], "not_interested",
            f"The customer said they're not interested: {not_interested}", {"reason": not_interested})
        # Every later turn moves last_turn_at: a handled reason stays handled while the reason is unchanged.
        mark = handled.get("not_interested") or {}
        if mark.get("reason") == not_interested:
            out[-1].update(handled=True, handled_at=_iso(mark.get("at")), handled_by=mark.get("by"))
    return out


async def list_notices(dealer_id: str, include_handled: bool = False) -> dict[str, Any]:
    db = dealer_scoped_db(dealer_id)
    states = await db.collection(AI_LEAD_STATE_COLLECTION).find(
        {"$or": [{"staff_notice": {"$ne": None}}, {"staff_alert": {"$ne": None}}, {"status": "handoff"},
                 {"conversation.not_interested.reason": {"$nin": [None, ""]}}]},
        projection={"lead_id": 1, "customer_id": 1, "staff_notice": 1, "staff_alert": 1, "status": 1,
                    "status_at": 1, "status_reason": 1, "stage": 1, "handled_notices": 1, "last_turn_at": 1,
                    "conversation.not_interested": 1}).to_list(None)
    rows = [n for s in states for n in notices_for(s)]
    unhandled = sum(1 for n in rows if not n["handled"])
    if not include_handled:
        rows = [n for n in rows if not n["handled"]]
    rows.sort(key=lambda n: n["at"] or "", reverse=True)
    return {"notices": rows[:LIMIT], "unhandled_count": unhandled}


class Handled(BaseModel):
    dealer_id: str
    source: Literal["notice", "alert", "handoff", "not_interested"]
    by: str | None = None


async def mark_handled(lead_id: str, body: Handled) -> dict[str, Any] | None:
    db = dealer_scoped_db(body.dealer_id)
    states = db.collection(AI_LEAD_STATE_COLLECTION)
    state = await states.find_one({"lead_id": lead_id})
    if state is None:
        return None
    current = next((n for n in notices_for(state) if n["source"] == body.source), None)
    if current is None:
        return {"handled": False, "reason": "That notice is no longer on the lead."}
    mark: dict[str, Any] = {"notice_at": current["at"], "at": clock.now(), "by": body.by}
    if body.source == "not_interested":
        mark["reason"] = current.get("reason")
    await states.update_one({"lead_id": lead_id}, {"$set": {f"handled_notices.{body.source}": mark}})
    return {"handled": True, "id": current["id"], "handled_at": _iso(mark["at"])}


@router.get("/notices")
async def get_notices(dealer_id: str = Query(...), include_handled: bool = False) -> dict[str, Any]:
    return await list_notices(dealer_id, include_handled)


@router.post("/notices/{lead_id}/handled")
async def post_handled(lead_id: str, body: Handled) -> dict[str, Any]:
    result = await mark_handled(lead_id, body)
    if result is None:
        raise HTTPException(status_code=404, detail="The AI has no state for that lead")
    return result


def _lead_extras(state: dict[str, Any] | None) -> dict[str, Any]:
    state = state or {}
    last_touch = cadence.CadenceState.load(state).last_touch_at
    return {"stage": state.get("stage"), "stage_label": lifecycle.label(state.get("stage")),
            "stage_reason": state.get("stage_reason"),
            "last_ai_touch_at": _iso(state.get("last_outbound_at") or last_touch),
            "ai_status": state.get("status")}


def _view(row: dict[str, Any]) -> dict[str, Any]:
    out = {k: _iso(v) for k, v in row.items() if k != "_id"}
    out["id"] = str(row["_id"])
    return out


async def list_call_tasks(dealer_id: str, view: str = "open") -> list[dict[str, Any]]:
    db = dealer_scoped_db(dealer_id)
    if view == "upcoming":
        rows = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).find(
            # PLAN_4 stream T: the next Days 1-7 morning / afternoon call task waits here too.
            {"kind": {"$in": ["call_task", "daily_call_task"]}, "status": {"$in": ["pending", "standby"]}}).sort(
            "due_at", 1).to_list(LIMIT)
        rows = [{"_id": r["_id"], "lead_id": r.get("lead_id"), "customer_id": r.get("customer_id"),
                 "phone": r.get("to"), "status": "waiting", "due_at": r.get("due_at"), "reason": r.get("reason"),
                 "sent_channels": r.get("sent_channels"), "created_at": r.get("created_at"),
                 # PLAN_4 stream H: the customer's own call request, waiting for calling hours.
                 "requested": bool(r.get("requested")),
                 "source": "daily" if r.get("kind") == "daily_call_task" else "connection_timer",
                 "slot": r.get("slot"), "day": r.get("day")} for r in rows]
    elif view == "done":
        rows = await db.collection(AI_CALL_TASKS_COLLECTION).find(
            {"status": {"$in": [call_tasks.COMPLETED, call_tasks.DISMISSED, call_tasks.CANCELLED,
                                call_tasks.MISSED]}}).sort(
            "closed_at", -1).to_list(LIMIT)
    else:
        rows = await db.collection(AI_CALL_TASKS_COLLECTION).find({"status": call_tasks.OPEN}).sort(
            "opened_at", 1).to_list(LIMIT)
    lead_ids = list({r["lead_id"] for r in rows if r.get("lead_id")})
    states = {s["lead_id"]: s for s in await db.collection(AI_LEAD_STATE_COLLECTION).find(
        {"lead_id": {"$in": lead_ids}},
        projection={"lead_id": 1, "stage": 1, "stage_reason": 1, "last_outbound_at": 1, "cadence": 1,
                    "status": 1}).to_list(None)} if lead_ids else {}
    return [{**_view(r), **_lead_extras(states.get(r.get("lead_id")))} for r in rows]


@router.get("/call-tasks")
async def get_call_tasks(dealer_id: str = Query(...),
                         view: Literal["open", "upcoming", "done"] = "open") -> list[dict[str, Any]]:
    return await list_call_tasks(dealer_id, view)


@router.get("/call-tasks/missed-by-agent")
async def get_missed_by_agent(dealer_id: str = Query(...), days: int = Query(30, ge=1, le=365)) -> dict[str, Any]:
    """PLAN_4 stream T: missed call tasks per assigned agent over the last `days` days (`assigned_to` null = the
    lead had nobody assigned). The BDC performance report is next SOW; this is the raw count it will use."""
    since = clock.now() - timedelta(days=days)
    return {"days": days, "since": _iso(since),
            "agents": await call_tasks.missed_by_agent(dealer_scoped_db(dealer_id), since=since)}


async def lead_consent(dealer_id: str, lead_id: str) -> dict[str, Any] | None:
    db = dealer_scoped_db(dealer_id)
    lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})
    if lead is None:
        return None
    customer_id = lead_customer_id(lead, dealer_id)
    customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one(
        {"_id": as_object_id(customer_id)}) if customer_id else None
    phone = consent.resolve_recipient(lead, customer, "sms")
    email = consent.resolve_recipient(lead, customer, "email")
    channels: dict[str, Any] = {}
    for channel, address, check_channel in (("sms", phone, "sms"), ("email", email, "email"),
                                            ("voice", phone, "sms")):
        entry = await consent.latest_opt_out(db, customer_id, channel, address)
        channels[channel] = {
            "address": address,
            "opted_out": bool(entry and entry.get("consent_status") == "opted_out"),
            "since": _iso(entry.get("recorded_at")) if entry else None,
            "source": entry.get("source") if entry else None,
            "address_invalid": await consent.is_invalid(db, check_channel, address) if address else False,
        }
    review = await consent.open_review(db, customer_id) if customer_id else None
    return {"lead_id": lead_id, "channels": channels,
            "possible_opt_out_review": ({"since": _iso(review.get("recorded_at")),
                                         "message": (review.get("evidence") or {}).get("message")}
                                        if review else None)}


@router.get("/leads/{lead_id}/consent")
async def get_lead_consent(lead_id: str, dealer_id: str = Query(...)) -> dict[str, Any]:
    result = await lead_consent(dealer_id, lead_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Lead not found for this dealer")
    return result
