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
- sending: sent / failed / suppressed; follow-ups (24h channel switches):
  sent / cancelled / pending; staff checks after a handoff, likewise
- freshness (MASTER_PLAN_3 Phase 5): how often a vehicle mentioned this turn
  was re-checked right before sending, and how often that catch something
  sold. "Sold vehicle mentioned" has no separate audit query: the send/
  follow-up code paths never fall through to the vehicle-naming text once a
  VIN is caught sold (guardrails/draft_guard.py's grounding check would also
  reject it if they somehow did), so this count is a canary on how often the
  feed goes stale under a dealer, not a search for a leak.

Computed from the service's own collections, scoped to the dealer. Used by
GET /v1/metrics, the Debug UI Metrics tab and `make ai-report`.
"""

from datetime import timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import (
    AI_COMPLIANCE_LOG_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.scheduler.followups import KIND_HANDOFF_CHECK

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
    grounding_rejections = turns_with_grounding_rejection = 0
    freshness_checked = freshness_caught_sold = 0
    inventory_query_ms: list[float] = []
    cost_by_day: dict[str, float] = {}
    tokens = {"in": 0, "out": 0}
    cursor = turns.find(in_window, projection={"nodes.node": 1, "nodes.status": 1, "nodes.output.passed": 1,
                                    "nodes.output.rejected": 1, "nodes.output.freshness_recheck": 1,
                                    "nodes.output.checks.grounded_in_real_stock": 1,
                                    "nodes.output.searched": 1, "nodes.ms": 1,
                                    "summary.cost_usd": 1, "summary.tokens_in": 1,
                                    "summary.tokens_out": 1, "created_at": 1})
    async for turn in cursor:
        failed_here = grounding_failed_here = 0
        for node in turn.get("nodes", []):
            if node.get("status") != "done":
                continue
            output = node.get("output") or {}
            if node.get("node") == "guard" and output.get("passed") is False:
                failed_here += 1
                # MASTER_PLAN_3 Phase 4/7: specifically a vehicle-fact rejection,
                # not any guard failure (an invented number rejects too).
                if (output.get("checks") or {}).get("grounded_in_real_stock") is False:
                    grounding_failed_here += 1
            elif node.get("node") == "validate":
                rejected += len(output.get("rejected") or [])
            elif node.get("node") == "search_stock" and output.get("searched") and node.get("ms") is not None:
                inventory_query_ms.append(float(node["ms"]))
            if node.get("node") == "send" and output.get("freshness_recheck"):
                freshness_checked += 1
                freshness_caught_sold += 1 if output["freshness_recheck"].get("sold") else 0
        guard_failures += failed_here
        turns_with_guard_failure += 1 if failed_here else 0
        grounding_rejections += grounding_failed_here
        turns_with_grounding_rejection += 1 if grounding_failed_here else 0
        summary = turn.get("summary") or {}
        day = turn["created_at"].strftime("%Y-%m-%d")
        cost_by_day[day] = round(cost_by_day.get(day, 0.0) + float(summary.get("cost_usd") or 0), 6)
        tokens["in"] += int(summary.get("tokens_in") or 0)
        tokens["out"] += int(summary.get("tokens_out") or 0)

    # Rolling-summary runs (MASTER_PLAN_2 Phase 3) are not turns but do cost.
    async for run in turns.find({"created_at": {"$gte": since}, "trigger": "summary"},
                                projection={"summary": 1, "created_at": 1}):
        summary = run.get("summary") or {}
        day = run["created_at"].strftime("%Y-%m-%d")
        cost_by_day[day] = round(cost_by_day.get(day, 0.0) + float(summary.get("cost_usd") or 0), 6)
        tokens["in"] += int(summary.get("tokens_in") or 0)
        tokens["out"] += int(summary.get("tokens_out") or 0)

    # A 24h channel switch's own re-check (Phase 5 item 2) logs under its own
    # "followup" trigger, not one of TURN_TRIGGERS.
    async for run in turns.find({"created_at": {"$gte": since}, "trigger": "followup"},
                                projection={"nodes.node": 1, "nodes.status": 1, "nodes.output.freshness_recheck": 1}):
        for node in run.get("nodes", []):
            if node.get("status") == "done" and node.get("node") == "send" and (fr := (node.get("output") or {}).get("freshness_recheck")):
                freshness_checked += 1
                freshness_caught_sold += 1 if fr.get("sold") else 0

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
    staff_checks: dict[str, int] = {}
    async for row in db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).find(
            {"created_at": {"$gte": since}}, projection={"status": 1, "kind": 1}):
        counts = staff_checks if row.get("kind") == KIND_HANDOFF_CHECK else followups
        counts[row["status"]] = counts.get(row["status"], 0) + 1

    # The send check (MASTER_PLAN_3 C1/B3 item 6): decisions by outcome and
    # rule; a text the system started, allowed outside the customer's window
    # or the dealer's hours, must be 0. B2 item 5: lead sources the origin
    # table couldn't map, for the client to classify.
    send_checks: dict[str, dict[str, int]] = {}
    outside_hours = 0
    async for row in db.collection(AI_COMPLIANCE_LOG_COLLECTION).find(
            {"logged_at": {"$gte": since}}, projection={"decision": 1, "rule": 1, "is_reply": 1, "checks": 1}):
        by_rule = send_checks.setdefault(row.get("decision", "?"), {})
        by_rule[row.get("rule", "?")] = by_rule.get(row.get("rule", "?"), 0) + 1
        if row.get("decision") == "ALLOW" and not row.get("is_reply") and any(
                c["rule"] in ("customer_time", "dealer_hours") and not c["passed"] for c in row.get("checks") or []):
            outside_hours += 1
    unmapped: dict[str, int] = {}
    async for state in db.collection(AI_LEAD_STATE_COLLECTION).find(
            {"origin.unmapped": True}, projection={"origin.source": 1}):
        source = (state.get("origin") or {}).get("source") or "(none)"
        unmapped[source] = unmapped.get(source, 0) + 1

    # MASTER_PLAN_3 B4 item 7: the client's goal is fewer handoffs and more bookings.
    offered: set[str] = set()
    booked: set[str] = set()
    async for turn in turns.find({"created_at": {"$gte": since}}, projection={"lead_id": 1, "summary": 1}):
        summary = turn.get("summary") or {}
        if summary.get("visit_offer_attempt"):
            offered.add(turn.get("lead_id"))
        if summary.get("booked"):
            booked.add(turn.get("lead_id"))

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
        "grounding_rejections": {"drafts": grounding_rejections, "turns": turns_with_grounding_rejection,
                                 "rate": _rate(turns_with_grounding_rejection, ai_turns)},
        "inventory_query_ms": {"n": len(inventory_query_ms), "p50": _pct(inventory_query_ms, 50),
                               "p95": _pct(inventory_query_ms, 95),
                               "max": max(inventory_query_ms) if inventory_query_ms else None},
        "rejected_extractions": {"values": rejected, "per_turn": _rate(rejected, total)},
        "cost_usd": {"total": round(sum(cost_by_day.values()), 6), "by_day": dict(sorted(cost_by_day.items())),
                     "tokens_in": tokens["in"], "tokens_out": tokens["out"]},
        "leads": {"total": len(states), "by_status": by_status,
                  "qualified_rate": _rate(by_status.get("qualified", 0), len(states)),
                  "handoff_rate": _rate(by_status.get("handoff", 0), len(states)),
                  "handoff_turns": handoff_turns},
        "visits": {"offered_leads": len(offered), "booked_leads": len(booked),
                   "offer_rate": _rate(len(offered), len(states)), "booking_rate": _rate(len(booked), len(states)),
                   "handoff_rate": _rate(by_status.get("handoff", 0), len(states))},
        "sends": sends,
        "followups": followups,
        "staff_checks": staff_checks,
        "send_checks": {"by_decision": send_checks, "sent_outside_allowed_hours": outside_hours},
        "unmapped_lead_sources": dict(sorted(unmapped.items(), key=lambda kv: -kv[1])),
        "freshness": {"rechecked": freshness_checked, "caught_sold": freshness_caught_sold},
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
        (f"  Grounding rejected: {m['grounding_rejections']['drafts']} draft(s) in "
         f"{m['grounding_rejections']['turns']} turn(s), {pct(m['grounding_rejections']['rate'])}"),
        (f"  Inventory query:    p50 {m['inventory_query_ms']['p50']} ms, p95 {m['inventory_query_ms']['p95']} ms, "
         f"max {m['inventory_query_ms']['max']} ms (n={m['inventory_query_ms']['n']})"),
        f"  Rejected values:    {m['rejected_extractions']['values']}",
        (f"  Cost:               ${m['cost_usd']['total']:.4f} "
         + ", ".join(f"{d} ${c:.4f}" for d, c in m["cost_usd"]["by_day"].items())),
        (f"  Qualified:          {pct(m['leads']['qualified_rate'])}, handed off {pct(m['leads']['handoff_rate'])} "
         f"({m['leads']['by_status']})"),
        (f"  Visits:             offered to {pct(m['visits']['offer_rate'])}, booked {pct(m['visits']['booking_rate'])}, "
         f"handed off {pct(m['visits']['handoff_rate'])}"),
        f"  Sends:              {m['sends']}",
        f"  Follow-ups:         {m['followups']}",
        f"  Staff checks:       {m['staff_checks']}",
        (f"  Send checks:        {m['send_checks']['by_decision']} "
         f"(allowed outside hours: {m['send_checks']['sent_outside_allowed_hours']})"),
        f"  Unmapped sources:   {m['unmapped_lead_sources'] or 'none'}",
        f"  Freshness re-checks: {m['freshness']['rechecked']}, caught sold {m['freshness']['caught_sold']}",
    ]
    return "\n".join(lines)
