"""Burst test (MASTER_PLAN_1 Stage 12, architecture §12): one dealer's campaign
floods in replies while another dealer keeps getting new leads.

    make ai-burst                         # 300 replies over 10 minutes (the plan's test)
    make ai-burst REPLIES=300 SECONDS=60  # a harsher, compressed run

What happens:
1. Dealer A sends a campaign to REPLIES customers (campaign + CampaignLead
   records, like the platform writes them).
2. Baseline: dealer B gets a few new leads with nothing else running; their
   first-reply times are measured.
3. Burst: every A customer replies, spread evenly over SECONDS, through the
   real event path (dedupe → queue → worker → pipeline → sender). Meanwhile B
   keeps getting new leads, and A's in-flight turn counter is sampled.

Passes when:
- every burst reply was answered and sent (no failed turns, no failed sends);
- every B first reply during the burst went out in under 8 seconds;
- B's p95 during the burst is within 2 seconds of its baseline p95 (other
  dealers aren't slowed);
- A never had more turns running than DEALER_MAX_INFLIGHT;
- every burst reply was written by the AI in its campaign's context (no
  template fallbacks - the first run found a guard bug this way).

For realistic turn times set OFFLINE_MODEL_LATENCY_MS on the worker (the Makefile
target uses 1200 ms per model call, about what gpt-4o-mini / gpt-4o take).
DEV only: it writes simulated leads for the dev dealers.
"""

import argparse
import asyncio
import statistics
import sys
import time
from datetime import timedelta
from typing import Any

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.config import get_settings
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.worker.locks import dealer_inflight_key

FIRST_REPLY_LIMIT_MS = 8_000
SLOWDOWN_ALLOWANCE_MS = 2_000
BURST_DEV_RUNS_COLLECTION = "dev_burst_runs"

REPLY_TEXTS = [
    "Yes, I'm interested! What's the price?", "Is it still available?", "Can I come in Saturday?",
    "My budget is about $30k", "Do you take trade-ins? I have a 2017 Civic", "Tell me more",
    "What colors do you have?", "I want to book a test drive", "How much would payments be?", "Interested",
]


def _pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(p / 100 * (len(ordered) - 1)))]


def _summary(values: list[float]) -> dict[str, Any]:
    return {"n": len(values), "p50": _pct(values, 50), "p95": _pct(values, 95), "max": max(values) if values else None,
            "mean": round(statistics.fmean(values)) if values else None}


async def _new_lead(dealer_id: str, name: str, enqueue) -> str:
    created = await simulate.create_lead(dealer_id, lead_type="sales", channel="sms", name=name,
                                         comments="Hi, is the RAV4 hybrid still available?")
    await simulate.send_lead_created(dealer_id, created["lead_id"], created["customer_id"], "sms", enqueue)
    return created["lead_id"]


async def _first_reply_ms(dealer_id: str, lead_ids: list[str], timeout_s: float) -> tuple[list[float], list[str]]:
    """Waits for each lead's first reply; returns (latencies, lead ids that never got one)."""
    states = dealer_scoped_db(dealer_id).collection(AI_LEAD_STATE_COLLECTION)
    deadline = time.monotonic() + timeout_s
    while True:
        docs = await states.find({"lead_id": {"$in": lead_ids}, "first_reply_ms": {"$exists": True}}).to_list(None)
        if len(docs) == len(lead_ids) or time.monotonic() > deadline:
            done = {d["lead_id"] for d in docs}
            return [float(d["first_reply_ms"]) for d in docs], [lid for lid in lead_ids if lid not in done]
        await asyncio.sleep(0.5)


async def _campaign(dealer_id: str, count: int) -> tuple[list[dict[str, str]], str]:
    campaign_id = ObjectId()
    await get_db()["campaigns"].insert_one({
        "_id": campaign_id, "name": "Burst test: spring RAV4 event", "description": "Book a test drive",
        "message_type": "sms", "dealer_id": ObjectId(dealer_id), "status": "completed", "dev_seed": True,
        "message_content": {"subject": "", "body": "Spring RAV4 event this weekend - reply to book a test drive!"}})
    leads, links = [], []
    for i in range(count):
        created = await simulate.create_lead(dealer_id, lead_type="sales", channel="sms", name=f"Burst Customer {i}",
                                             comments="")
        leads.append(created)
        links.append({"campaign_id": str(campaign_id), "name": "Burst test", "lead_id": ObjectId(created["lead_id"]),
                      "dealer_id": dealer_id, "status": "sent", "dev_seed": True,
                      "sent_at": clock.now() - timedelta(hours=2)})
    await get_db()["campaignleads"].insert_many(links)
    return leads, str(campaign_id)


async def run_burst(enqueue, redis, *, replies: int, seconds: float, probes: int, baseline_probes: int) -> dict:
    settings = get_settings()
    burst_dealer, other_dealer = simulate.DEV_DEALERS[0]["_id"], simulate.DEV_DEALERS[1]["_id"]
    await simulate.ensure_platform_dealers()
    print(f"Preparing a campaign to {replies} customers of dealer A ...")
    leads, campaign_id = await _campaign(burst_dealer, replies)

    print(f"Baseline: {baseline_probes} new leads for dealer B with nothing else running ...")
    baseline_ids = []
    for i in range(baseline_probes):
        baseline_ids.append(await _new_lead(other_dealer, f"Baseline Lead {i}", enqueue))
        await asyncio.sleep(1)
    baseline_ms, baseline_missing = await _first_reply_ms(other_dealer, baseline_ids, 60)

    peak = {"inflight": 0}
    stop = asyncio.Event()

    async def sample_inflight():
        key = dealer_inflight_key(burst_dealer)
        while not stop.is_set():
            peak["inflight"] = max(peak["inflight"], int(await redis.get(key) or 0))
            await asyncio.sleep(0.1)

    async def send_replies():
        gap = seconds / max(1, replies)
        start = time.monotonic()
        for i, lead in enumerate(leads):
            await asyncio.sleep(max(0.0, start + i * gap - time.monotonic()))
            await simulate.send_reply(burst_dealer, lead["lead_id"], "sms", REPLY_TEXTS[i % len(REPLY_TEXTS)], enqueue)

    probe_ids: list[str] = []

    async def send_probes():
        gap = seconds / max(1, probes)
        for i in range(probes):
            probe_ids.append(await _new_lead(other_dealer, f"Probe Lead {i}", enqueue))
            await asyncio.sleep(gap)

    print(f"Burst: {replies} replies over {seconds:g}s for dealer A, {probes} new leads for dealer B meanwhile ...")
    started = time.monotonic()
    sampler = asyncio.create_task(sample_inflight())
    await asyncio.gather(send_replies(), send_probes())
    sent_s = time.monotonic() - started

    lead_ids = [lead["lead_id"] for lead in leads]
    turns = dealer_scoped_db(burst_dealer).collection(AI_TURN_LOG_COLLECTION)
    deadline = time.monotonic() + max(120.0, seconds)
    while time.monotonic() < deadline:
        answered = await turns.count_documents({"lead_id": {"$in": lead_ids}, "trigger": "inbound_message"})
        if answered >= replies:
            break
        await asyncio.sleep(1)
    drained_s = time.monotonic() - started
    probe_ms, probe_missing = await _first_reply_ms(other_dealer, probe_ids, 60)
    stop.set()
    await sampler

    turn_docs = await turns.find({"lead_id": {"$in": lead_ids}, "trigger": "inbound_message"}).to_list(None)
    outbound = await dealer_scoped_db(burst_dealer).collection(AI_MESSAGES_COLLECTION).find(
        {"lead_id": {"$in": lead_ids}, "direction": "outbound", "is_fallback": {"$ne": True}}).to_list(None)
    by_status: dict[str, int] = {}
    for row in outbound:
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1
    errors = [t for t in turn_docs if t.get("outcome") == "error"]
    reply_ms = [float(r["latency_ms"]) for r in outbound if r.get("latency_ms") is not None]
    campaign_turns = sum(1 for t in turn_docs if (t.get("summary") or {}).get("campaign_id") == campaign_id)
    template_fallbacks = sum(1 for t in turn_docs if t.get("outcome") == "fallback")
    handed_off = await dealer_scoped_db(burst_dealer).collection(AI_LEAD_STATE_COLLECTION).count_documents(
        {"lead_id": {"$in": lead_ids}, "status": "handoff"})

    baseline = _summary(baseline_ms)
    during = _summary(probe_ms)
    checks = {
        "every burst reply answered": len({t["lead_id"] for t in turn_docs}) == replies,
        "no failed turns": not errors,
        "every burst reply sent": by_status.get("sent", 0) == replies,
        "every other-dealer first reply < 8s": bool(probe_ms) and not probe_missing
        and max(probe_ms) < FIRST_REPLY_LIMIT_MS,
        "other dealer not slowed (p95 within 2s of baseline)": bool(baseline_ms) and bool(probe_ms)
        and during["p95"] <= baseline["p95"] + SLOWDOWN_ALLOWANCE_MS,
        "dealer A never above its in-flight cap": peak["inflight"] <= settings.dealer_max_inflight,
        # Sent is not enough: the replies must be the AI's, in campaign context.
        "burst replies written by the AI (no template fallback)": template_fallbacks == 0,
        "every burst reply knew its campaign": campaign_turns == replies,
    }
    report = {
        "replies": replies, "seconds": seconds, "campaign_id": campaign_id, "sent_in_s": round(sent_s, 1),
        "drained_in_s": round(drained_s, 1), "burst_turns": len(turn_docs), "burst_errors": len(errors),
        "template_fallbacks": template_fallbacks, "handed_off": handed_off,
        "campaign_context_found": campaign_turns, "burst_send_status": by_status, "burst_reply_ms": _summary(reply_ms),
        "other_dealer_baseline_ms": baseline, "other_dealer_during_ms": during,
        "other_dealer_missing": len(probe_missing) + len(baseline_missing),
        "peak_inflight_dealer_a": peak["inflight"], "dealer_cap": settings.dealer_max_inflight,
        "worker_concurrency": settings.worker_concurrency, "checks": checks, "passed": all(checks.values()),
        "ran_at": clock.now(),
    }
    await get_db()[BURST_DEV_RUNS_COLLECTION].insert_one(dict(report))
    return report


def _print(report: dict) -> None:
    b, d, r = report["other_dealer_baseline_ms"], report["other_dealer_during_ms"], report["burst_reply_ms"]
    print(f"\nBurst: {report['replies']} replies sent in {report['sent_in_s']}s, all answered after "
          f"{report['drained_in_s']}s; {report['burst_turns']} turns, {report['burst_errors']} errors, "
          f"campaign context found in {report['campaign_context_found']}")
    print(f"  burst send statuses: {report['burst_send_status']}; template fallbacks {report['template_fallbacks']}, "
          f"leads handed off {report['handed_off']}")
    print(f"  burst reply time (event to send): p50 {r['p50']} ms, p95 {r['p95']} ms, max {r['max']} ms")
    print(f"  dealer B first reply, baseline:     p50 {b['p50']} ms, p95 {b['p95']} ms, max {b['max']} ms (n={b['n']})")
    print(f"  dealer B first reply, during burst: p50 {d['p50']} ms, p95 {d['p95']} ms, max {d['max']} ms (n={d['n']})")
    print(f"  dealer A peak turns in flight: {report['peak_inflight_dealer_a']} (cap {report['dealer_cap']}, "
          f"worker concurrency {report['worker_concurrency']})")
    for name, ok in report["checks"].items():
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    print(f"\n{'BURST TEST PASSED' if report['passed'] else 'BURST TEST FAILED'}")


async def _cli(args: argparse.Namespace) -> int:
    from upsell_agent.integrations.mongodb import close_mongo, ensure_indexes, init_mongo
    from upsell_agent.integrations.redis_client import close_redis, get_redis, init_redis
    from upsell_agent.worker.queue import make_enqueue, make_queue

    settings = get_settings()
    if not settings.is_dev:
        print("The burst test only runs with ENVIRONMENT=DEV.")
        return 2
    await init_mongo(settings)
    await ensure_indexes()
    await init_redis(settings)
    queue = make_queue(settings)
    await queue.connect()
    try:
        report = await run_burst(make_enqueue(queue), get_redis(), replies=args.replies, seconds=args.seconds,
                                 probes=args.probes, baseline_probes=args.baseline)
    finally:
        await queue.disconnect()
        await close_redis()
        await close_mongo()
    _print(report)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Burst test: one dealer's campaign replies vs another dealer's leads")
    parser.add_argument("--replies", type=int, default=300)
    parser.add_argument("--seconds", type=float, default=600)
    parser.add_argument("--probes", type=int, default=20, help="new leads for the other dealer during the burst")
    parser.add_argument("--baseline", type=int, default=5, help="new leads for the other dealer before the burst")
    sys.exit(asyncio.run(_cli(parser.parse_args())))
