"""Shadow comparison (MASTER_PLAN_1 Stage 13, APLAN Phase 7): for a dealer in
`shadow` mode, every AI draft next to what the customer actually received
(n8n's reply, or a staff member's), for review before going live.

Each pair is one AI turn:
- what the customer said (the messages the turn answered, or the new lead's
  comments),
- the AI's draft (stored as a `shadow` message, never sent) with the turn's
  outcome and guard result,
- the first reply the platform actually sent after that message and before
  the customer's next one (`emails`: automated = n8n / FollowUpJob, or staff).

Reviews ("better", "same", "worse", "unsafe" + a note) are kept per turn in a
DEV-only collection, so a sample can be reviewed by hand.

DEV only, and meant for a DEV copy of the data (devtools/copy_dealer.py),
never run against production.
"""

from datetime import timedelta
from typing import Any

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.integrations.mongodb import (
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    dealer_scoped_db,
)

PLATFORM_EMAILS_COLLECTION = "emails"
DEV_SHADOW_REVIEWS_COLLECTION = "dev_shadow_reviews"
VERDICTS = ("better", "same", "worse", "unsafe")
LEAD_WINDOW = timedelta(minutes=10)


def _aware(value):
    return value if value is None or value.tzinfo else value.replace(tzinfo=clock.now().tzinfo)


async def shadow_pairs(dealer_id: str, days: float = 7, limit: int = 200) -> dict[str, Any]:
    db = dealer_scoped_db(dealer_id)
    since = clock.now() - timedelta(days=days)
    drafts = await db.collection(AI_MESSAGES_COLLECTION).find(
        {"direction": "outbound", "status": "shadow", "created_at": {"$gte": since}}).to_list(None)
    drafts.sort(key=lambda d: d["created_at"], reverse=True)
    drafts = drafts[:limit]

    reviews = {r["turn_id"]: r for r in await db.collection(DEV_SHADOW_REVIEWS_COLLECTION).find({}).to_list(None)}
    pairs = []
    for draft in drafts:
        lead_id, turn_id = draft["lead_id"], draft.get("turn_id")
        turn = await db.collection(AI_TURN_LOG_COLLECTION).find_one({"turn_id": turn_id}) or {}
        inbound = await db.collection(AI_MESSAGES_COLLECTION).find(
            {"lead_id": lead_id, "direction": "inbound"}).to_list(None)
        inbound.sort(key=lambda m: m["created_at"])
        answered = [m for m in inbound if m.get("answered_turn_id") == turn_id]
        if answered:
            customer = [m["text"] for m in answered]
            start = _aware(answered[0]["created_at"])
            after = _aware(answered[-1]["created_at"])
        else:  # a new lead's first reply: the lead's own comments
            lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": ObjectId(lead_id)}) or {}
            comments = (lead.get("data") or {}).get("comments") or lead.get("comments")
            customer = [comments] if comments else []
            start = _aware(lead.get("createdAt")) or _aware(draft["created_at"]) - LEAD_WINDOW
            after = start
        later = [m for m in inbound if _aware(m["created_at"]) > after]
        until = _aware(later[0]["created_at"]) if later else None

        time_window: dict[str, Any] = {"$gte": start - timedelta(seconds=1)}
        if until:
            time_window["$lt"] = until
        actual = await db.collection(PLATFORM_EMAILS_COLLECTION).find({
            "lead_id": ObjectId(lead_id), "ai_generated": {"$ne": True}, "is_note": {"$ne": True},
            "status": {"$in": ["sent", "failed", "pending"]}, "timestamp": time_window,
        }).to_list(None)
        actual.sort(key=lambda m: m["timestamp"])
        first = actual[0] if actual else None
        guard_nodes = [n for n in turn.get("nodes", []) if n.get("node") == "guard" and n.get("status") == "done"]
        review = reviews.get(turn_id)
        pairs.append({
            "turn_id": turn_id, "lead_id": lead_id, "at": _aware(draft["created_at"]).isoformat(),
            "trigger": turn.get("trigger"), "channel": draft.get("channel"),
            "customer": customer,
            "ai": {"text": draft.get("text"), "outcome": turn.get("outcome"),
                   "used_fallback": bool((turn.get("summary") or {}).get("used_fallback")),
                   "guard_passed": bool(guard_nodes and guard_nodes[-1].get("output", {}).get("passed")),
                   "asked": (turn.get("summary") or {}).get("asked", [])},
            "actual": ({"text": first.get("mail_content"), "by": "staff" if first.get("message_by") else "n8n",
                        "channel": first.get("communication_type"),
                        "at": _aware(first["timestamp"]).isoformat()} if first else None),
            "review": {"verdict": review["verdict"], "note": review.get("note")} if review else None,
        })

    counts = {v: 0 for v in VERDICTS}
    for r in reviews.values():
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    return {"dealer_id": dealer_id, "days": days, "pairs": pairs,
            "summary": {"drafts": len(pairs), "with_actual_reply": sum(1 for p in pairs if p["actual"]),
                        "reviewed": sum(counts.values()), "verdicts": counts}}


async def save_review(dealer_id: str, turn_id: str, verdict: str, note: str | None = None) -> None:
    if verdict not in VERDICTS:
        raise ValueError(f"verdict must be one of {VERDICTS}")
    await dealer_scoped_db(dealer_id).collection(DEV_SHADOW_REVIEWS_COLLECTION).update_one(
        {"turn_id": turn_id},
        {"$set": {"turn_id": turn_id, "verdict": verdict, "note": note, "reviewed_at": clock.now()}},
        upsert=True)
