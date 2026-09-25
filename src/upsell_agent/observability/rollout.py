"""Go-live checks for one dealer (MASTER_PLAN_1 Stage 13, BPLAN Phase 6): the
two things the rollout's "done when" names - no double messages, no lost
replies - measured from the data, plus the Stage 12 numbers against agreed
limits.

Double messages:
- **Platform auto-messages on an AI lead**: any automated outbound record in
  the platform's conversation (`emails`: not AI-generated, no staff author, not
  a note) on a lead the AI is handling, after the AI started on it. For a
  `live` dealer that means n8n or a FollowUpJob also wrote to the customer.
  (Shadow dealers are expected to have them: n8n still replies.)
- **AI double sends**: more than one outbound AI message for the same turn and
  channel is impossible by design (idempotency key); two sends from turns
  answering the same customer message would show here too.

Lost replies:
- a customer message recorded but never answered, older than 5 minutes, on a
  lead the AI should be answering (not paused / handed off / opted out);
- an event accepted (`ai_events`) whose job never ran: an inbound message never
  recorded, or a new lead with no first reply, older than 5 minutes.

The checks read platform data read-only, scoped to the dealer.
"""

from datetime import timedelta
from typing import Any

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.integrations.dealer_mode import dealer_ai_mode
from upsell_agent.integrations.mongodb import (
    AI_EVENTS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.observability.metrics import dealer_metrics

PLATFORM_EMAILS_COLLECTION = "emails"
GRACE = timedelta(minutes=5)
SILENT_STATUSES = {"handoff", "paused", "opted_out"}

# Agreed limits for going live and staying live (runbooks/rollout.md).
LIMITS = {
    "first_reply_p95_ms": 8_000,
    "template_fallback_rate": 0.05,
    "guard_failure_rate": 0.10,
    "send_failure_rate": 0.02,
}


def _aware(value):
    return value if value is None or value.tzinfo else value.replace(tzinfo=clock.now().tzinfo)


async def _platform_auto_messages(db, states: list[dict]) -> list[dict]:
    """Automated non-AI outbound messages on AI-handled leads, after the AI started."""
    if not states:
        return []
    started = {s["lead_id"]: _aware(s.get("created_at")) for s in states}
    lead_ids = [ObjectId(lid) for lid in started if ObjectId.is_valid(lid)]
    rows = await db.collection(PLATFORM_EMAILS_COLLECTION).find({
        "lead_id": {"$in": lead_ids},
        "status": {"$in": ["sent", "failed", "pending", "draft"]},
        "ai_generated": {"$ne": True},
        "message_by": None,
        "is_note": {"$ne": True},
        "communication_type": {"$ne": "note"},
    }, projection={"lead_id": 1, "timestamp": 1, "date": 1, "mail_content": 1, "communication_type": 1}).to_list(None)
    found = []
    for row in rows:
        at = _aware(row.get("timestamp") or row.get("date"))
        since = started.get(str(row["lead_id"]))
        if at is not None and since is not None and at >= since:
            found.append({"lead_id": str(row["lead_id"]), "at": at.isoformat(), "channel": row.get("communication_type"),
                          "text": (row.get("mail_content") or "")[:120]})
    return found


async def _ai_double_sends(db, since) -> list[dict]:
    rows = await db.collection(AI_MESSAGES_COLLECTION).find(
        {"direction": "outbound", "created_at": {"$gte": since}, "is_fallback": {"$ne": True},
         "status": {"$in": ["sent", "sending", "unknown"]}},
        projection={"turn_id": 1, "lead_id": 1, "channel": 1}).to_list(None)
    per_turn: dict[tuple, int] = {}
    for row in rows:
        key = (row.get("lead_id"), row.get("turn_id"))
        per_turn[key] = per_turn.get(key, 0) + 1
    return [{"lead_id": lead, "turn_id": turn, "sends": n} for (lead, turn), n in per_turn.items() if n > 1]


async def _lost_replies(db, since, states: list[dict]) -> dict[str, list]:
    cutoff = clock.now() - GRACE
    status_by_lead = {s["lead_id"]: s.get("status", "active") for s in states}
    unanswered = await db.collection(AI_MESSAGES_COLLECTION).find(
        {"direction": "inbound", "answered_turn_id": None, "created_at": {"$gte": since, "$lt": cutoff}},
        projection={"lead_id": 1, "text": 1, "created_at": 1}).to_list(None)
    unanswered = [{"lead_id": r.get("lead_id"), "text": (r.get("text") or "")[:120],
                   "at": _aware(r["created_at"]).isoformat()}
                  for r in unanswered if status_by_lead.get(r.get("lead_id"), "active") not in SILENT_STATUSES]

    events = await db.collection(AI_EVENTS_COLLECTION).find(
        {"received_at": {"$gte": since, "$lt": cutoff}}, projection={"type": 1}).to_list(None)
    never_ran = []
    messages = db.collection(AI_MESSAGES_COLLECTION)
    for event in events:
        event_id = str(event["_id"]).split(":", 1)[-1]
        if event.get("type") == "inbound-message":
            if not await messages.find_one({"platform_message_id": event_id}, projection={"_id": 1}):
                never_ran.append({"event": event["_id"], "why": "the customer's message was never recorded"})
        elif event.get("type") == "lead-created":
            if status_by_lead.get(event_id) in SILENT_STATUSES:
                continue
            if not await messages.find_one({"lead_id": event_id, "direction": "outbound"}, projection={"_id": 1}):
                never_ran.append({"event": event["_id"], "why": "the new lead never got a first reply"})
    return {"unanswered_messages": unanswered, "events_never_handled": never_ran}


async def rollout_check(dealer_id: str, days: float = 7) -> dict[str, Any]:
    db = dealer_scoped_db(dealer_id)
    since = clock.now() - timedelta(days=days)
    mode = await dealer_ai_mode(dealer_id)
    states = await db.collection(AI_LEAD_STATE_COLLECTION).find(
        {"created_at": {"$gte": since}}, projection={"lead_id": 1, "status": 1, "created_at": 1}).to_list(None)
    metrics = await dealer_metrics(dealer_id, days)

    platform_auto = await _platform_auto_messages(db, states)
    doubles = await _ai_double_sends(db, since)
    lost = await _lost_replies(db, since, states)

    sends = metrics["sends"]
    attempted = sum(n for status, n in sends.items() if status in ("sent", "failed", "unknown"))
    send_failure_rate = (sends.get("failed", 0) + sends.get("unknown", 0)) / attempted if attempted else None
    fr_p95 = metrics["first_reply_ms"]["p95"]
    fallback = metrics["template_fallback"]["rate"]
    guard = metrics["guard_failures"]["rate"]

    def within(value, limit):
        return value is None or value <= limit

    checks = {
        # A live dealer's customers hear only from the AI; in shadow, n8n replying is expected.
        "no platform auto-messages on AI leads (n8n / FollowUpJob)": mode != "live" or not platform_auto,
        "no AI double sends": not doubles,
        "no unanswered customer messages": not lost["unanswered_messages"],
        "no events left unhandled": not lost["events_never_handled"],
        f"first reply p95 under {LIMITS['first_reply_p95_ms'] / 1000:g}s": within(fr_p95, LIMITS["first_reply_p95_ms"]),
        f"template fallback under {LIMITS['template_fallback_rate']:.0%}": within(fallback,
                                                                                  LIMITS["template_fallback_rate"]),
        f"guard failures under {LIMITS['guard_failure_rate']:.0%}": within(guard, LIMITS["guard_failure_rate"]),
        f"send failures under {LIMITS['send_failure_rate']:.0%}": within(send_failure_rate,
                                                                         LIMITS["send_failure_rate"]),
    }
    return {
        "dealer_id": dealer_id, "ai_mode": mode, "days": days, "leads": len(states),
        "passed": all(checks.values()), "checks": checks,
        "platform_auto_messages": platform_auto[:50], "ai_double_sends": doubles[:50],
        "unanswered_messages": lost["unanswered_messages"][:50],
        "events_never_handled": lost["events_never_handled"][:50],
        "numbers": {"first_reply_p95_ms": fr_p95, "template_fallback_rate": fallback, "guard_failure_rate": guard,
                    "send_failure_rate": None if send_failure_rate is None else round(send_failure_rate, 4)},
        "limits": LIMITS,
    }


def format_check(result: dict[str, Any]) -> str:
    lines = [(f"Dealer {result['dealer_id']} ({result['ai_mode']}), last {result['days']:g} day(s), "
              f"{result['leads']} AI leads: {'READY / HEALTHY' if result['passed'] else 'NOT READY'}")]
    lines += [f"  {'PASS' if ok else 'FAIL'}  {name}" for name, ok in result["checks"].items()]
    for key, label in (("platform_auto_messages", "platform auto-message"), ("ai_double_sends", "AI double send"),
                       ("unanswered_messages", "unanswered"), ("events_never_handled", "event never handled")):
        for item in result[key][:5]:
            lines.append(f"        {label}: {item}")
    return "\n".join(lines)
