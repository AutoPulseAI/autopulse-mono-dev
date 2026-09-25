"""The numbers to watch (architecture §13, MASTER_PLAN_1 Stage 12 step 5), per
dealer over the last N days:

- first-reply time: event to send, p50 / p95 / max (ai_lead_state.first_reply_ms)
- template-fallback rate: turns whose reply was the template because an AI
  step failed or the guard said no twice (and, separately, template-mode first
  replies, which are by design)
- guard failures: drafts the guard rejected, and how many turns had one
- rejected extractions: values Validate threw away
- cost per day: summed from each turn's model calls
- qualified rate: leads the AI finished qualifying, of those it worked on;
  also hand-offs and opt-outs
- sending: sent / failed / suppressed; follow-ups: sent / cancelled / pending

Computed from the service's own collections, scoped to the dealer. Used by
GET /v1/metrics, the Debug UI Metrics tab and `make ai-report`.
"""

from datetime import timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)

TURN_TRIGGERS = ["lead_created", "inbound_message"]


def _pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(p / 100 * (len(ordered) - 1)))]


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


async def dealer_metrics(dealer_id: str, days: float = 7) -> dict[str, Any]:
    db = dealer_scoped_db(dealer_id)
    since = clock.now() - timedelta(days=days)
    turns = db.collection(AI_TURN_LOG_COLLECTION)
    in_window = {"created_at": {"$gte": since}, "trigger": {"$in": TURN_TRIGGERS}}

    total = await turns.count_documents(in_window)
    fallbacks = await turns.count_documents({**in_window, "summary.used_fallback": True})
    template_by_design = await turns.count_documents({**in_window, "outcome": "template_reply"})
    handoff_turns = await turns.count_documents({**in_window, "outcome": "handoff"})

    guard_failures = turns_with_guard_failure = rejected = 0
    cost_by_day: dict[str, float] = {}
    tokens = {"in": 0, "out": 0}
    cursor = turns.find(in_window, projection={"nodes.node": 1, "nodes.status": 1, "nodes.output.passed": 1,
                                    "nodes.output.rejected": 1, "summary.cost_usd": 1, "summary.tokens_in": 1,
                                    "summary.tokens_out": 1, "created_at": 1})
    async for turn in cursor:
        failed_here = 0
        for node in turn.get("nodes", []):
            if node.get("status") != "done":
                continue
            output = node.get("output") or {}
            if node.get("node") == "guard" and output.get("passed") is False:
                failed_here += 1
            elif node.get("node") == "validate":
                rejected += len(output.get("rejected") or [])
        guard_failures += failed_here
        turns_with_guard_failure += 1 if failed_here else 0
        summary = turn.get("summary") or {}
        day = turn["created_at"].strftime("%Y-%m-%d")
        cost_by_day[day] = round(cost_by_day.get(day, 0.0) + float(summary.get("cost_usd") or 0), 6)
        tokens["in"] += int(summary.get("tokens_in") or 0)
        tokens["out"] += int(summary.get("tokens_out") or 0)

    states = await db.collection(AI_LEAD_STATE_COLLECTION).find(
        {"created_at": {"$gte": since}}, projection={"status": 1, "first_reply_ms": 1}).to_list(None)
    first_reply = [float(s["first_reply_ms"]) for s in states if s.get("first_reply_ms") is not None]
    by_status: dict[str, int] = {}
    for state in states:
        by_status[state.get("status", "active")] = by_status.get(state.get("status", "active"), 0) + 1

    sends: dict[str, int] = {}
    async for row in db.collection(AI_MESSAGES_COLLECTION).find(
            {"direction": "outbound", "created_at": {"$gte": since}}, projection={"status": 1}):
        sends[row.get("status", "?")] = sends.get(row.get("status", "?"), 0) + 1
    followups: dict[str, int] = {}
    async for row in db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).find(
            {"created_at": {"$gte": since}}, projection={"status": 1}):
        followups[row["status"]] = followups.get(row["status"], 0) + 1

    ai_turns = total - template_by_design
    return {
        "dealer_id": dealer_id, "days": days, "since": since.isoformat(),
        "first_reply_ms": {"n": len(first_reply), "p50": _pct(first_reply, 50), "p95": _pct(first_reply, 95),
                           "max": max(first_reply) if first_reply else None,
                           "under_8s": _rate(sum(1 for v in first_reply if v < 8000), len(first_reply))},
        "turns": total,
        "template_fallback": {"turns": fallbacks, "rate": _rate(fallbacks, ai_turns),
                              "template_first_replies_by_design": template_by_design},
        "guard_failures": {"drafts": guard_failures, "turns": turns_with_guard_failure,
                           "rate": _rate(turns_with_guard_failure, ai_turns)},
        "rejected_extractions": {"values": rejected, "per_turn": _rate(rejected, total)},
        "cost_usd": {"total": round(sum(cost_by_day.values()), 6), "by_day": dict(sorted(cost_by_day.items())),
                     "tokens_in": tokens["in"], "tokens_out": tokens["out"]},
        "leads": {"total": len(states), "by_status": by_status,
                  "qualified_rate": _rate(by_status.get("qualified", 0), len(states)),
                  "handoff_rate": _rate(by_status.get("handoff", 0), len(states)),
                  "handoff_turns": handoff_turns},
        "sends": sends,
        "followups": followups,
    }


def format_report(m: dict[str, Any]) -> str:
    """Plain-text version for `make ai-report`."""
    fr, fb, gf = m["first_reply_ms"], m["template_fallback"], m["guard_failures"]

    def pct(value: float | None) -> str:
        return "-" if value is None else f"{value * 100:.1f}%"

    lines = [
        f"Dealer {m['dealer_id']}, last {m['days']:g} day(s): {m['turns']} turns, {m['leads']['total']} leads",
        (f"  First reply:        p50 {fr['p50']} ms, p95 {fr['p95']} ms, max {fr['max']} ms "
         f"({pct(fr['under_8s'])} under 8s, n={fr['n']})"),
        (f"  Template fallback:  {fb['turns']} turn(s), {pct(fb['rate'])} "
         f"(+{fb['template_first_replies_by_design']} template first replies by design)"),
        f"  Guard failures:     {gf['drafts']} draft(s) in {gf['turns']} turn(s), {pct(gf['rate'])}",
        f"  Rejected values:    {m['rejected_extractions']['values']}",
        (f"  Cost:               ${m['cost_usd']['total']:.4f} "
         + ", ".join(f"{d} ${c:.4f}" for d, c in m["cost_usd"]["by_day"].items())),
        (f"  Qualified:          {pct(m['leads']['qualified_rate'])}, handed off {pct(m['leads']['handoff_rate'])} "
         f"({m['leads']['by_status']})"),
        f"  Sends:              {m['sends']}",
        f"  Follow-ups:         {m['followups']}",
    ]
    return "\n".join(lines)
