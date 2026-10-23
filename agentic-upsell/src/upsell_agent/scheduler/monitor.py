"""The AI watches itself (23 Oct 2026: "we need to continuously monitor the system and leads").

Every MONITOR_EVERY, the conversations since the last check are read, and the developers are emailed a short report
- only when something needs a look:

- a turn that went out as the safe template, or failed, with the safety check's reasons;
- the AI switched off / held events (agent/provider_health.py);
- a customer message with no reply for over UNANSWERED_AFTER;
- an opt-out, a handoff or a request for a person (worth reading, not always wrong).

Each line: when, the dealer and lead, what the customer wrote, what went out. The report goes to AI_MONITOR_EMAILS
(the CRM's POST /api/internal/ai/ops-alert, audience "monitor") - never the dealer; with no address set, nothing is
sent. The last check's time is kept in ai_system_status ("monitor"), so no window is read twice or skipped.
"""

import logging
from datetime import timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import AI_MESSAGES_COLLECTION, AI_TURN_LOG_COLLECTION, get_db

logger = logging.getLogger(__name__)

STATUS_COLLECTION = "ai_system_status"
MONITOR_ID = "monitor"
MONITOR_EVERY = timedelta(minutes=15)
UNANSWERED_AFTER = timedelta(minutes=10)
UNANSWERED_LOOKBACK = timedelta(hours=6)
MAX_LINES = 60

PROBLEMS = {"fallback": "SAFE TEMPLATE SENT", "error": "TURN FAILED", "held_ai_off": "AI OFF - HELD"}
WORTH_A_LOOK = {"opt_out_confirmation": "opt-out", "opted_out": "opt-out (STOP)", "handoff": "handed to staff",
                "offer_human": "asked for a person", "wrong_number": "wrong number"}


def _short(text: Any, n: int) -> str:
    return " ".join(str(text or "").split())[:n]


def _violations(log: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for node in log.get("nodes") or []:
        if node.get("node") == "guard":
            out += [str(v) for v in ((node.get("output") or {}).get("violations") or [])]
        if node.get("status") == "failed" and node.get("error"):
            out.append(f"{node.get('node')} failed: {node.get('error')}")
    return list(dict.fromkeys(out))


async def report(now: Any = None) -> dict[str, Any]:
    """The report for the window since the last check (and the new check time). Nothing is sent here."""
    now = now or clock.now()
    db = get_db()
    status = await db[STATUS_COLLECTION].find_one({"_id": MONITOR_ID}) or {}
    since = status.get("last_at") or now - MONITOR_EVERY
    if since.tzinfo is None:
        since = since.replace(tzinfo=now.tzinfo)
    problems: list[str] = []
    notes: list[str] = []
    async for log in db[AI_TURN_LOG_COLLECTION].find({"created_at": {"$gt": since, "$lte": now}}).sort("_id", 1):
        outcome = log.get("outcome")
        if outcome not in PROBLEMS and outcome not in WORTH_A_LOOK:
            continue
        when = log["_id"].generation_time.strftime("%H:%M") if hasattr(log.get("_id"), "generation_time") else ""
        said = _short((log.get("input") or {}).get("text"), 140)
        reply = _short((log.get("summary") or {}).get("reply"), 200)
        head = f"{when} UTC  dealer {log.get('dealer_id')}  lead {log.get('lead_id')}  [{log.get('trigger')}]"
        if outcome in PROBLEMS:
            why = "; ".join(_violations(log))[:400] or _short((log.get("result") or {}).get("error"), 300)
            problems.append(f"{PROBLEMS[outcome]}  {head}\n   customer: {said!r}\n   sent: {reply!r}\n   why: {why}")
        else:
            notes.append(f"{WORTH_A_LOOK[outcome]}  {head}\n   customer: {said!r}\n   sent: {reply!r}")
    unanswered: list[str] = []
    cursor = db[AI_MESSAGES_COLLECTION].find({
        "direction": "inbound", "answered_turn_id": None, "auto_reply": {"$ne": True},
        "created_at": {"$lt": now - UNANSWERED_AFTER, "$gt": now - UNANSWERED_LOOKBACK}}).sort("created_at", 1)
    async for message in cursor:
        unanswered.append(f"NO REPLY  {message['created_at']:%H:%M} UTC  dealer {message.get('dealer_id')}  lead "
                          f"{message.get('lead_id')}  {message.get('channel')}: {_short(message.get('text'), 140)!r}")
    from upsell_agent.agent import provider_health
    down = await provider_health.is_down()
    held = len(await provider_health.held_events(1000)) if down else 0
    sections = []
    if down:
        sections.append(f"THE AI IS OFF (model provider not answering) - {held} event(s) held.")
    if problems:
        sections.append("PROBLEMS\n" + "\n".join(problems[:MAX_LINES]))
    if unanswered:
        sections.append("CUSTOMER MESSAGES WITH NO REPLY (over 10 minutes)\n" + "\n".join(unanswered[:MAX_LINES]))
    if notes and (problems or unanswered or down):
        sections.append("ALSO WORTH A LOOK\n" + "\n".join(notes[:MAX_LINES]))
    elif notes:
        sections.append("WORTH A LOOK\n" + "\n".join(notes[:MAX_LINES]))
    return {"since": since, "now": now, "problems": len(problems), "unanswered": len(unanswered),
            "notes": len(notes), "down": down, "text": "\n\n".join(sections)}


async def run(*, platform: Any = None) -> dict[str, Any]:
    """One check: build the report, email it when there's anything in it, move the window on. Never raises."""
    try:
        result = await report()
    except Exception:  # noqa: BLE001 - the monitor never takes the worker down
        logger.exception("the AI monitor could not build its report")
        return {"status": "error"}
    sent = False
    if result["text"]:
        flagged = result["problems"] + result["unanswered"] + (1 if result["down"] else 0)
        subject = (f"AutoPulse AI monitor: {flagged} problem(s)" if flagged
                   else f"AutoPulse AI monitor: {result['notes']} conversation(s) worth a look")
        body = (f"Conversations from {result['since']:%Y-%m-%d %H:%M} to {result['now']:%H:%M} UTC.\n\n"
                f"{result['text']}")
        try:
            if platform is None:
                from upsell_agent.config import get_settings
                from upsell_agent.integrations.platform_client import get_platform_client
                platform = get_platform_client(get_settings())
            sent = await platform.send_ops_alert(subject, body, audience="monitor")
        except Exception:  # noqa: BLE001 - try again with the next window's report
            logger.exception("the AI monitor could not email its report")
            return {"status": "not_sent", **{k: result[k] for k in ("problems", "unanswered", "notes")}}
    await get_db()[STATUS_COLLECTION].update_one({"_id": MONITOR_ID}, {"$set": {"last_at": result["now"]}},
                                                 upsert=True)
    return {"status": "sent" if sent else "quiet" if not result["text"] else "no_address",
            **{k: result[k] for k in ("problems", "unanswered", "notes")}}
