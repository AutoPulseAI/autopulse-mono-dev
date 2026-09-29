"""Campaign texts pass the send check through a shared queue (MASTER_PLAN_3
B3 item 7, architecture §15 decision 66).

The platform still sends campaign texts. Before each one, its campaign worker
(`aidmvcs-be-dev/app/lib/ai/aiSendCheck.js`) writes a request into
`ai_send_checks`:

    {request_key, dealer_id, campaign_id, campaign_lead_id, lead_id, phone,
     channel: "sms", purpose: "marketing", status: "pending", requested_at}

This service claims each pending request, runs `can_contact` (campaign: the
customer's own inquiry doesn't count as consent), and writes its answer onto
that entry only:

    {status: "answered", decision: ALLOW | HOLD | REVIEW | BLOCK, until,
     reason, rule, answered_at, log_id}

It never sends campaign texts and never writes platform records. An ALLOW
counts toward the 3-per-24h cap as soon as it's given (it's in the
compliance log). If this service is down, requests wait in the queue.

A worker runs `answer_pending` every couple of seconds (worker/main.py).
Claims are atomic, so several workers never answer the same request; a claim
older than 2 minutes goes back to pending.
"""

import asyncio
import logging
from datetime import timedelta
from typing import Any

from pymongo import ReturnDocument

from upsell_agent import clock
from upsell_agent.compliance.engine import can_contact
from upsell_agent.integrations.mongodb import AI_SEND_CHECKS_COLLECTION, get_db

logger = logging.getLogger(__name__)

POLL_INTERVAL_S = 2.0
STUCK_AFTER = timedelta(minutes=2)
BATCH_LIMIT = 200


async def _claim(claimed_by: str) -> dict | None:
    """Atomically takes the oldest pending request (cross-dealer by design,
    like the follow-up claim; each answer is scoped to its own dealer)."""
    now = clock.now()
    return await get_db()[AI_SEND_CHECKS_COLLECTION].find_one_and_update(
        {"status": "pending"},
        {"$set": {"status": "checking", "claimed_at": now, "claimed_by": claimed_by}},
        sort=[("requested_at", 1)], return_document=ReturnDocument.AFTER)


async def _reset_stuck() -> int:
    result = await get_db()[AI_SEND_CHECKS_COLLECTION].update_many(
        {"status": "checking", "claimed_at": {"$lt": clock.now() - STUCK_AFTER}},
        {"$set": {"status": "pending"}})
    return result.modified_count


async def answer_one(request: dict) -> dict[str, Any]:
    dealer_id = str(request.get("dealer_id") or "")
    if not dealer_id:
        answer: dict[str, Any] = {"decision": "BLOCK", "reason": "the request has no dealer", "rule": "bad_request",
                                  "until": None}
    else:
        decision = await can_contact(
            dealer_id=dealer_id, customer_id=str(request["customer_id"]) if request.get("customer_id") else None,
            lead_id=str(request["lead_id"]) if request.get("lead_id") else None,
            channel=request.get("channel") or "sms", purpose=request.get("purpose") or "marketing", is_reply=False,
            to=request.get("phone") or None, campaign=True, source="campaign",
            request_id=str(request.get("request_key") or request["_id"]))
        answer = {"decision": decision.outcome, "reason": decision.reason, "rule": decision.rule,
                  "until": decision.until, "log_id": decision.log_id}
    answer.update(status="answered", answered_at=clock.now())
    await get_db()[AI_SEND_CHECKS_COLLECTION].update_one(
        {"_id": request["_id"], "status": "checking"}, {"$set": answer})
    return answer


async def answer_pending(claimed_by: str, limit: int = BATCH_LIMIT) -> dict[str, int]:
    summary: dict[str, int] = {"reset": await _reset_stuck(), "answered": 0}
    for _ in range(limit):
        request = await _claim(claimed_by)
        if request is None:
            break
        try:
            answer = await answer_one(request)
        except Exception:
            # Left `checking`: the stuck-claim reset retries it in 2 minutes.
            logger.exception("send check %s failed", request.get("_id"))
            continue
        summary["answered"] += 1
        summary[answer["decision"]] = summary.get(answer["decision"], 0) + 1
    return summary


async def run_forever(claimed_by: str, interval_s: float = POLL_INTERVAL_S) -> None:
    """The worker's background loop. Never raises; stops when cancelled."""
    while True:
        try:
            await answer_pending(claimed_by)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("answering campaign send checks failed")
        await asyncio.sleep(interval_s)
