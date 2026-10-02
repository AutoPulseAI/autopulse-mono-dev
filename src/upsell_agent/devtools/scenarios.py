"""Scenario runner (MASTER_PLAN_1 Stage 3.7).

A scenario is a YAML file in agentic-upsell/scenarios/ describing a scripted
conversation and what must be true afterwards. The Debug UI's Scenarios page
and `make ai-scenarios` (CI) run the same files, which is how everyone sees how
far the build has got.

Steps (one key per step):
  ping_worker:        {timeout_s}
  new_lead:           {as, dealer: A|B|<id>, lead_type, channel, name, comments, send_event: true,
                       history?: DMS records, see devtools/simulate.insert_history}
  send_lead_created:  {lead, event_id?, expect: queued|duplicate}
  reply:              {lead, text, channel?}   like the platform: not sent at all if the dealer is off
  pause / resume:     {lead, reason?}
  wait_turns:         {lead, count, timeout_s}
  wait_status:        {lead, status, timeout_s}
  expect_turn:        {lead, index: -1, outcome?, trigger?, nodes?: [...], attempts?: {node: n}, ran?: [...],
                       not_ran?: [...], campaign_found?: bool}
  expect_turn_count:  {lead, count, settle_s}
  expect_messages:    {lead, direction: outbound, count, status?, settle_s}
  expect_last_sent:   {lead, channel?, max_latency_ms?, text_starts_with?, contains?, excludes?, question_marks?}
  expect_no_repeat_asks: {lead}   no two replies in a row asked for the same detail (MASTER_PLAN_2 Phase 5)
  expect_slots:       {lead, filled?: [paths], missing?: [paths], sources?: {path: platform|customer},
                       values?: {path: value}}
  send_campaign:      {lead, name, body?, days_ago?}   the dealer sent this lead a campaign
  compare_360:        {dealers: [A, B]}   stub vs live Customer 360 for seeded customers (needs the platform)
  set_dealer_mode:    {dealer, mode: off|shadow|live}   on the platform dealer record (restored after the scenario)
  advance_clock:      {hours} or {dealer: A, to: "Tue 10:00"} (the next such time in that dealer's timezone)
                      moves the dev clock and fires due follow-ups (reset after the scenario)
  expect_followup:    {lead, status, kind: channel_switch|handoff_check|resume_at_opening|cadence_touch|appointment_<step>, to_channel?, count?,
                       index: -1, timeout_s}
                      one of the lead's scheduled items of that kind, oldest first (-1 = the latest)
  delivery_status:    {lead, status, channel?}   the provider reports on the lead's last message on that channel
  expect_outbox:      {lead, channel, count, contains?, settle_s}   what actually left through the fake driver
  expect_no_followup: {lead, kind: channel_switch, settle_s}   nothing of that kind was scheduled for the lead
  expect_lead:        {lead, status?, staff_alert?: bool, summary_contains?, after_hours?: offered|now|later,
                       staff_notice?: <kind>, timeout_s}   the AI's state for the lead (after_hours: the
                       "now or when we open?" choice, MASTER_PLAN_3 B1)
  platform_reply:     {lead, text, by: n8n|staff}   the platform (n8n / staff) sent the customer this
  expect_shadow:      {lead, drafts, with_actual?}   the Shadow tab's pairs for this lead
  expect_context:     {lead, index: -1, new_messages?: [texts], min_working_memory?, last_from_ai?: bool,
                       last_asked?: bool, open_questions?: [texts], promise_contains?, summary_contains?,
                       memory_excludes?}   the context pack that turn's AI steps read (MASTER_PLAN_2)
  chat:               {lead, messages?: [texts], filler?: n, filler_chars: 700, timeout_s}   the customer sends
                      each message and waits for its reply (filler: n long, neutral messages)
  add_stock:          {as, dealer: A, vehicles: [{year, make, model, trim?, body?, condition?, color?, miles?}]}
                      dealer stock shaped like the vAuto feed (removed after the scenario)
  expect_inventory:   {lead, index: -1, searched?: bool, query?: {...}, min_loaded?, loaded_include?: <stock alias>,
                       never_loaded?: <stock alias>, only_loaded?: <stock alias>, loosened?: [steps],
                       colour_sent?: str, trigger?: str}   the stock that turn's Search stock step loaded
                      (MASTER_PLAN_3 Phases 1-2): loaded_include = that add_stock's vehicles (up to the per-turn
                      limit) were given to the AI; never_loaded = none came back from the search at all (e.g.
                      another dealer's); only_loaded = nothing else was given; loosened = the loosening steps,
                      in order; colour_sent = the colour spelling sent to /api/car
  compare_inventory:  {dealers: [A, B]}   stub vs live /api/car for the dev stock (needs the platform)
  set_contact:        {lead, source?, dealervault?: bool, sms_opt_in?: bool|null, zip?, comments?}   the platform
                      lead / customer as the send check reads them (MASTER_PLAN_3 C1); a zip is a DealerVault deal
                      row (removed after the scenario). Use new_lead's send_event: false, then send_lead_created
  expect_origin:      {lead, origin: inbound|outbound, timeout_s}   the lead's origin as the last turn saved it
  campaign_check:     {lead, expect: ALLOW|HOLD|REVIEW|BLOCK, reason_contains?, until_local?: "HH:MM", timeout_s}
                      the platform campaign worker's check request, answered by the worker (decision 66)
  expect_followup's due_local: "HH:MM"   the follow-up's due time in the dealer's timezone
  expect_booking:     {lead, status: pending|confirmed|cancelled|none, time?: "HH:MM", timeout_s}
                      the lead's platform booking (MASTER_PLAN_3 B5)
  take_offered_time:  {lead, index: 0, count: 2}  other customers fill a time we just offered (B5 item 3)
  expect_lead's visit_attempts / visit_declined: the visit offer's state (MASTER_PLAN_3 B4)
  sleep:              {seconds}

Run from the CLI:  python -m upsell_agent.devtools.scenarios [name ...]
"""

import asyncio
import itertools
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC
from pathlib import Path
from typing import Any

import yaml
from bson import ObjectId
from saq import Queue

from upsell_agent import clock
from upsell_agent.agent.llm import OFFLINE
from upsell_agent.config import get_settings
from upsell_agent.devtools import compare_360, compare_inventory, simulate
from upsell_agent.events.intake import accept_event
from upsell_agent.events.models import LeadPausedEvent, LeadResumedEvent
from upsell_agent.integrations.dealer_profile import dealer_profile
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_SEND_CHECKS_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_BOOKINGS_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.worker.queue import Enqueue

DEV_SCENARIO_RUNS_COLLECTION = "dev_scenario_runs"  # DEV only, not per dealer
DEALER_ALIASES = {"A": simulate.DEV_DEALERS[0]["_id"], "B": simulate.DEV_DEALERS[1]["_id"],
                  "C": simulate.DEV_DEALERS[2]["_id"]}
POLL_S = 0.25


def scenarios_dir() -> Path:
    return Path(os.environ.get("SCENARIOS_DIR", Path.cwd() / "scenarios"))


def load_scenarios() -> list[dict[str, Any]]:
    scenarios = []
    for path in sorted(scenarios_dir().glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        data["id"] = path.stem
        scenarios.append(data)
    return scenarios


class ScenarioFailed(AssertionError):
    pass


@dataclass
class RunContext:
    enqueue: Enqueue
    queue: Queue | None
    leads: dict[str, dict[str, str]] = field(default_factory=dict)
    moved_clock: bool = False
    changed_dealers: bool = False
    # add_stock alias -> the vehicles it inserted
    stock: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    # set_contact's DealerVault rows and campaign_check's requests (removed after)
    deals: list[Any] = field(default_factory=list)
    send_checks: list[str] = field(default_factory=list)

    def lead(self, alias: str) -> dict[str, str]:
        if alias not in self.leads:
            raise ScenarioFailed(f"unknown lead alias {alias!r}; create it with new_lead first")
        return self.leads[alias]


async def _turns(lead: dict[str, str]) -> list[dict]:
    """The lead's turns, oldest first. Rolling-summary runs are background
    work, not turns, so they're left out."""
    cursor = dealer_scoped_db(lead["dealer_id"]).collection(AI_TURN_LOG_COLLECTION).find(
        {"lead_id": lead["lead_id"], "trigger": {"$ne": "summary"}})
    return sorted(await cursor.to_list(None), key=lambda t: t["created_at"])


async def _wait(predicate, timeout_s: float, what: str) -> Any:
    deadline = time.monotonic() + timeout_s
    while True:
        value = await predicate()
        if value:
            return value
        if time.monotonic() > deadline:
            raise ScenarioFailed(f"timed out after {timeout_s}s waiting for {what}")
        await asyncio.sleep(POLL_S)


def _done_nodes(turn: dict) -> list[str]:
    ordered: list[str] = []
    for node in turn.get("nodes", []):
        if node.get("status") == "done" and (not ordered or ordered[-1] != node["node"]):
            ordered.append(node["node"])
    return ordered


def _unique_vins(history: dict[str, list[dict]] | None) -> dict[str, list[dict]] | None:
    """The platform keeps vehicles unique per dealer and VIN, so a scenario's
    fixed VINs get a per-run suffix (the same one everywhere in this history,
    so a deal still points at its vehicle)."""
    if not history:
        return history
    suffix = uuid.uuid4().hex[:6].upper()
    return {kind: [{**rec, "vin": f"{rec['vin'][:11]}{suffix}"} if rec.get("vin") else rec for rec in records]
            for kind, records in history.items()}


WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _kind_filter(args: dict[str, Any]) -> dict[str, Any]:
    from upsell_agent.scheduler.followups import (
        APPOINTMENT_KINDS,
        CHANNEL_SWITCHES,
        KIND_CADENCE_TOUCH,
        KIND_HANDOFF_CHECK,
        KIND_NEXT_ACTION,
        KIND_NEXT_ACTION_CHECK,
        KIND_RESUME,
        KIND_VISIT_FOLLOWUP,
    )

    flt: dict[str, Any] = {}
    if args.get("kind") in (KIND_HANDOFF_CHECK, KIND_RESUME, KIND_VISIT_FOLLOWUP, KIND_NEXT_ACTION,
                            KIND_NEXT_ACTION_CHECK, KIND_CADENCE_TOUCH, *APPOINTMENT_KINDS):
        flt["kind"] = args["kind"]
    elif args.get("kind") != "any":  # "any": every kind (MASTER_PLAN_3 C3)
        flt.update(CHANNEL_SWITCHES)
    return flt


def _after_hours_choice(state: dict) -> str | None:
    return ((state.get("conversation") or {}).get("after_hours") or {}).get("choice")


def _visit(state: dict) -> dict:
    """The visit offer's state (MASTER_PLAN_3 B4/B5)."""
    return (state.get("conversation") or {}).get("visit") or {}


async def _booking(lead: dict) -> dict | None:
    """The lead's platform booking (MASTER_PLAN_3 B5), read like the AI reads it."""
    db = dealer_scoped_db(lead["dealer_id"])
    row = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": ObjectId(lead["lead_id"])}) or {}
    booking_id = (row.get("data") or {}).get("bookingId")
    if not booking_id:
        return None
    return await db.collection(PLATFORM_BOOKINGS_COLLECTION).find_one({"_id": ObjectId(str(booking_id))})


async def _seconds_until_dealer_time(dealer: str, when: str) -> tuple[float, str]:
    """Seconds from the dev clock's now to the next "Tue 10:00" in the
    dealer's own timezone, so a scenario runs against the same business hours
    and contact window whatever time it is really run at."""
    from datetime import datetime, timedelta

    from upsell_agent.integrations.dealer_profile import dealer_profile

    day_name, hhmm = when.split()
    hour, minute = (int(x) for x in hhmm.split(":"))
    profile = await dealer_profile(DEALER_ALIASES.get(dealer, dealer))
    now_local = clock.now().astimezone(profile.tz)
    days = (WEEKDAYS.index(day_name[:3].lower()) - now_local.weekday()) % 7
    target = datetime.combine(now_local.date() + timedelta(days=days), datetime.min.time().replace(
        hour=hour, minute=minute), tzinfo=profile.tz)
    if target <= now_local:
        target += timedelta(days=7)
    return (target - now_local).total_seconds(), f"{target:%a %H:%M} {profile.timezone}"


async def _step(ctx: RunContext, kind: str, args: dict[str, Any]) -> str:
    if kind == "ping_worker":
        if ctx.queue is None:
            raise ScenarioFailed("no queue available to ping")
        nonce = uuid.uuid4().hex[:8]
        result = await ctx.queue.apply("ping", nonce=nonce, timeout=int(args.get("timeout_s", 10)))
        if not result or result.get("pong") != nonce:
            raise ScenarioFailed(f"unexpected ping result {result!r}")
        return f"worker {result['worker']} answered"

    if kind == "new_lead":
        dealer_id = DEALER_ALIASES.get(args.get("dealer", "A"), args.get("dealer"))
        created = await simulate.create_lead(
            dealer_id, lead_type=args.get("lead_type", "sales"), channel=args.get("channel", "sms"),
            name=args.get("name", "Scenario Customer"), comments=args.get("comments", ""),
            history=_unique_vins(args.get("history")),
        )
        ctx.leads[args["as"]] = {**created, "dealer_id": dealer_id, "channel": args.get("channel", "sms")}
        if args.get("send_event", True):
            await simulate.send_lead_created(dealer_id, created["lead_id"], created["customer_id"],
                                             args.get("channel", "sms"), ctx.enqueue)
        return f"lead {created['lead_id']}"

    if kind == "send_lead_created":
        lead = ctx.lead(args["lead"])
        result = await simulate.send_lead_created(lead["dealer_id"], lead["lead_id"], lead["customer_id"],
                                                  lead["channel"], ctx.enqueue, event_id=args.get("event_id"))
        expected = args.get("expect")
        if expected and result.status != expected:
            raise ScenarioFailed(f"expected {expected}, got {result.status}")
        return result.status

    if kind == "reply":
        lead = ctx.lead(args["lead"])
        result = await simulate.send_reply(lead["dealer_id"], lead["lead_id"], args.get("channel", lead["channel"]),
                                           args["text"], ctx.enqueue)
        note = " (dealer AI is off: no event sent)" if result.status == "skipped" else ""
        return f"customer: {args['text']!r}{note}"

    if kind in ("pause", "resume"):
        lead = ctx.lead(args["lead"])
        event_id = uuid.uuid4().hex
        if kind == "pause":
            event = LeadPausedEvent(event_id=event_id, dealer_id=lead["dealer_id"], lead_id=lead["lead_id"],
                                    reason=args.get("reason"))
        else:
            event = LeadResumedEvent(event_id=event_id, dealer_id=lead["dealer_id"], lead_id=lead["lead_id"])
        result = await accept_event(f"lead-{kind}d", event, ctx.enqueue)
        return result.status

    if kind == "staff_status":
        # MASTER_PLAN_3 C3: staff move the lead on the platform's status screen ("Visited", "DND",
        # "Appointment Booked" with `booking_in_days`), exactly as the platform tells the AI.
        lead = ctx.lead(args["lead"])
        from datetime import timedelta as later

        booking_at = None
        if args.get("booking_in_days") is not None:
            booking_at = (clock.now() + later(days=float(args["booking_in_days"]))).isoformat()
        result = await simulate.send_staff_status(lead["dealer_id"], lead["lead_id"], args["status"], ctx.enqueue,
                                                  booking_at=booking_at, manager_outcome=args.get("manager_outcome"))
        return f"staff set the lead to {args['status']!r} ({result.status})"

    if kind == "wait_turns":
        lead = ctx.lead(args["lead"])
        count = int(args.get("count", 1))

        async def enough():
            turns = await _turns(lead)
            return len(turns) >= count and all(t.get("outcome") for t in turns)

        await _wait(enough, float(args.get("timeout_s", 30)), f"{count} finished turn(s)")
        return f"{count} turn(s) finished"

    if kind == "wait_status":
        lead = ctx.lead(args["lead"])

        async def status_matches():
            doc = await dealer_scoped_db(lead["dealer_id"]).collection(AI_LEAD_STATE_COLLECTION).find_one(
                {"lead_id": lead["lead_id"]})
            return doc and doc.get("status") == args["status"]

        await _wait(status_matches, float(args.get("timeout_s", 15)), f"status {args['status']!r}")
        return f"status is {args['status']}"

    if kind == "expect_turn":
        lead = ctx.lead(args["lead"])
        turns = await _turns(lead)
        if not turns:
            raise ScenarioFailed("no turns recorded")
        turn = turns[int(args.get("index", -1))]
        problems = []
        if "outcome" in args and turn.get("outcome") != args["outcome"]:
            problems.append(f"outcome {turn.get('outcome')!r} != {args['outcome']!r}")
        if "trigger" in args and turn.get("trigger") != args["trigger"]:
            problems.append(f"trigger {turn.get('trigger')!r} != {args['trigger']!r}")
        if "nodes" in args and _done_nodes(turn) != args["nodes"]:
            problems.append(f"nodes {_done_nodes(turn)} != {args['nodes']}")
        attempts = {}
        for node in turn.get("nodes", []):
            attempts[node["node"]] = max(attempts.get(node["node"], 0), node.get("attempt", 0))
        for node, n in (args.get("attempts") or {}).items():
            if attempts.get(node, 0) != n:
                problems.append(f"{node} ran {attempts.get(node, 0)} time(s), expected {n}")
        ran = set(_done_nodes(turn))
        for node in args.get("ran", []):
            if node not in ran:
                problems.append(f"{node} did not run")
        for node in args.get("not_ran", []):
            if node in ran:
                problems.append(f"{node} ran but should not have")
        if "campaign_found" in args:
            load = next((n for n in turn.get("nodes", []) if n["node"] == "load_context"), {})
            found = bool((load.get("output") or {}).get("campaign"))
            if found != bool(args["campaign_found"]):
                problems.append(f"campaign found={found}, expected {args['campaign_found']}")
        if problems:
            raise ScenarioFailed("; ".join(problems))
        return f"turn outcome {turn.get('outcome')!r}"

    if kind == "expect_no_repeat_asks":
        lead = ctx.lead(args["lead"])
        asked = [set((t.get("summary") or {}).get("asked") or []) for t in await _turns(lead)]
        repeats = [sorted(a & b) for a, b in itertools.pairwise(asked) if a & b]
        if repeats:
            raise ScenarioFailed(f"asked twice in a row: {repeats}")
        return f"{sum(1 for a in asked if a)} asking replies, never the same detail twice in a row"

    if kind == "expect_turn_count":
        lead = ctx.lead(args["lead"])
        await asyncio.sleep(float(args.get("settle_s", 2)))
        count = len(await _turns(lead))
        if count != int(args["count"]):
            raise ScenarioFailed(f"{count} turn(s), expected {args['count']}")
        return f"{count} turn(s)"

    if kind == "expect_messages":
        lead = ctx.lead(args["lead"])
        await asyncio.sleep(float(args.get("settle_s", 1)))
        flt: dict[str, Any] = {"lead_id": lead["lead_id"], "direction": args.get("direction", "outbound")}
        if "status" in args:
            flt["status"] = args["status"]
        count = await dealer_scoped_db(lead["dealer_id"]).collection(AI_MESSAGES_COLLECTION).count_documents(flt)
        if count != int(args["count"]):
            raise ScenarioFailed(f"{count} {flt['direction']} message(s) matching {args.get('status', 'any status')}, "
                                 f"expected {args['count']}")
        return f"{count} {flt['direction']} message(s)"

    if kind == "expect_last_sent":
        lead = ctx.lead(args["lead"])
        rows = await dealer_scoped_db(lead["dealer_id"]).collection(AI_MESSAGES_COLLECTION).find(
            {"lead_id": lead["lead_id"], "direction": "outbound"}).to_list(None)
        if not rows:
            raise ScenarioFailed("no outbound message")
        last = max(rows, key=lambda r: r["created_at"])
        problems = []
        if last.get("status") != "sent":
            problems.append(f"status {last.get('status')!r} ({last.get('reason')})")
        if "channel" in args and last.get("channel") != args["channel"]:
            problems.append(f"channel {last.get('channel')!r} != {args['channel']!r}")
        if "max_latency_ms" in args and (last.get("latency_ms") is None or last["latency_ms"] > args["max_latency_ms"]):
            problems.append(f"event-to-send {last.get('latency_ms')} ms > {args['max_latency_ms']} ms")
        if "text_starts_with" in args and not str(last.get("text", "")).startswith(args["text_starts_with"]):
            problems.append(f"text {str(last.get('text'))[:60]!r} does not start with {args['text_starts_with']!r}")
        if "contains" in args and args["contains"].lower() not in str(last.get("text", "")).lower():
            problems.append(f"text {str(last.get('text'))[:80]!r} does not mention {args['contains']!r}")
        if "excludes" in args and args["excludes"].lower() in str(last.get("text", "")).lower():
            problems.append(f"text {str(last.get('text'))[:80]!r} mentions {args['excludes']!r}")
        if "question_marks" in args and str(last.get("text", "")).count("?") != int(args["question_marks"]):
            problems.append(f"{str(last.get('text', '')).count('?')} question(s) in {str(last.get('text'))[:120]!r}, "
                            f"expected {args['question_marks']}")
        if problems:
            raise ScenarioFailed("; ".join(problems))
        return f"sent on {last['channel']} in {last.get('latency_ms')} ms to {last.get('to')}"

    if kind == "expect_slots":
        from upsell_agent.api.leads import lead_profile

        lead = ctx.lead(args["lead"])
        profile = await lead_profile(lead["dealer_id"], lead["lead_id"])
        rows = {r["path"]: r for r in (profile or {}).get("slots", [])}
        problems = []
        for path in args.get("filled", []):
            if rows.get(path, {}).get("state") != "filled":
                problems.append(f"{path} is {rows.get(path, {}).get('state', 'absent')}, expected filled")
        for path in args.get("missing", []):
            if rows.get(path, {}).get("state") not in ("missing", "stale"):
                problems.append(f"{path} is {rows.get(path, {}).get('state')}, expected missing")
        for path, source in (args.get("sources") or {}).items():
            if rows.get(path, {}).get("source") != source:
                problems.append(f"{path} source {rows.get(path, {}).get('source')!r}, expected {source!r}")
        for path, value in (args.get("values") or {}).items():
            if rows.get(path, {}).get("value") != value:
                problems.append(f"{path} = {rows.get(path, {}).get('value')!r}, expected {value!r}")
        if problems:
            raise ScenarioFailed("; ".join(problems))
        required = (profile or {}).get("required", {})
        return f"{required.get('filled')}/{required.get('total')} required details collected"

    if kind == "send_campaign":
        from datetime import timedelta

        lead = ctx.lead(args["lead"])
        campaign_id = ObjectId()
        await get_db()["campaigns"].insert_one({
            "_id": campaign_id, "name": args["name"], "description": args.get("goal", ""),
            "message_type": lead["channel"], "dealer_id": ObjectId(lead["dealer_id"]), "status": "completed",
            "message_content": {"subject": "", "body": args.get("body", "Reply to find out more!")}, "dev_seed": True})
        await get_db()["campaignleads"].insert_one({
            "campaign_id": str(campaign_id), "name": args["name"], "lead_id": ObjectId(lead["lead_id"]),
            "dealer_id": lead["dealer_id"], "status": "sent", "dev_seed": True,
            "sent_at": clock.now() - timedelta(days=float(args.get("days_ago", 0.01)))})
        return f"campaign {campaign_id} sent"

    if kind == "compare_360":
        dealers = [DEALER_ALIASES.get(d, d) for d in args.get("dealers", ["A", "B"])]
        results = await compare_360.compare_dealers(dealers)
        if not results:
            raise ScenarioFailed("no seeded customers to compare; run `make ai-seed` first")
        errors = [r for r in results if r["error"]]
        if errors:
            raise ScenarioFailed(errors[0]["error"])
        mismatched = [r for r in results if r["problems"]]
        if mismatched:
            first = mismatched[0]
            raise ScenarioFailed(f"{len(mismatched)}/{len(results)} customers differ; "
                                 f"{first['name']}: {first['problems'][0]}")
        return f"{len(results)} customers match between stub and live"

    if kind == "set_dealer_mode":
        from upsell_agent.integrations.mongodb import PLATFORM_USERS_COLLECTION

        dealer_id = DEALER_ALIASES.get(args["dealer"], args["dealer"])
        ctx.changed_dealers = True
        await get_db()[PLATFORM_USERS_COLLECTION].update_one({"_id": ObjectId(dealer_id)},
                                                             {"$set": {"ai_mode": args["mode"]}})
        return f"dealer {args['dealer']} is now {args['mode']}"

    if kind == "advance_clock":
        from upsell_agent.integrations.redis_client import get_redis

        ctx.moved_clock = True
        if "to" in args:
            seconds, local = await _seconds_until_dealer_time(args.get("dealer", "A"), str(args["to"]))
            await clock.advance(get_redis(), seconds)
            detail = f" ({local})"
        else:
            await clock.advance(get_redis(), float(args["hours"]) * 3600)
            detail = ""
        await ctx.enqueue("fire_due_followups", key=f"fire_due_followups:scenario:{uuid.uuid4().hex[:8]}")
        # MASTER_PLAN_3 C3: a jump past Day 91 closes leads now, not at the next hourly cron.
        await ctx.enqueue("close_expired_leads", key=f"close_expired_leads:scenario:{uuid.uuid4().hex[:8]}")
        return f"clock is now {clock.now():%Y-%m-%d %H:%M} UTC{detail}"

    if kind == "expect_followup":
        lead = ctx.lead(args["lead"])
        followups = dealer_scoped_db(lead["dealer_id"]).collection(SCHEDULED_FOLLOWUPS_COLLECTION)
        kind_filter = _kind_filter(args)

        async def latest():
            rows = await followups.find({"lead_id": lead["lead_id"], **kind_filter}).to_list(None)
            if not rows:
                return None
            rows.sort(key=lambda r: r["created_at"])
            index = int(args.get("index", -1))
            if index >= len(rows) or index < -len(rows):
                return None
            last = rows[index]
            return (last, len(rows)) if last["status"] == args["status"] else None

        try:
            last, count = await _wait(latest, float(args.get("timeout_s", 15)), f"a {args['status']} follow-up")
        except ScenarioFailed:
            rows = sorted(await followups.find({"lead_id": lead["lead_id"], **kind_filter}).to_list(None),
                          key=lambda r: r["created_at"])
            seen = [f"{r['status']} ({r.get('reason')})" for r in rows]
            raise ScenarioFailed(f"expected follow-up [{args.get('index', -1)}] to be {args['status']}; "
                                 f"saw {seen or 'none'}") from None
        if "to_channel" in args and last["to_channel"] != args["to_channel"]:
            raise ScenarioFailed(f"follow-up goes to {last['to_channel']}, expected {args['to_channel']}")
        if "count" in args and count != int(args["count"]):
            raise ScenarioFailed(f"{count} follow-up(s) for this lead, expected {args['count']}")
        if "due_local" in args:
            profile = await dealer_profile(lead["dealer_id"])
            due = last["due_at"].replace(tzinfo=UTC).astimezone(profile.tz).strftime("%H:%M")
            if due != str(args["due_local"]):
                raise ScenarioFailed(f"follow-up is due at {due} dealer time, expected {args['due_local']}"
                                     f" ({last.get('reason')})")
        return f"follow-up to {last['to_channel']} is {last['status']}" + (
            f" ({last['reason']})" if last.get("reason") else "")

    if kind == "delivery_status":
        from upsell_agent.channels.delivery import apply_delivery_status
        from upsell_agent.integrations.platform_client import get_platform_client

        lead = ctx.lead(args["lead"])
        flt = {"lead_id": lead["lead_id"], "direction": "outbound", "status": "sent"}
        if "channel" in args:
            flt["channel"] = args["channel"]
        rows = await dealer_scoped_db(lead["dealer_id"]).collection(AI_MESSAGES_COLLECTION).find(flt).to_list(None)
        if not rows:
            raise ScenarioFailed(f"no sent {args.get('channel', '')} message to report on")
        last = max(rows, key=lambda r: r["created_at"])
        result = await apply_delivery_status(get_platform_client(get_settings()), args["status"],
                                             provider_id=last.get("provider_id"), error="scenario")
        if result.followup_due_now:
            await ctx.enqueue("fire_due_followups", key=f"fire_due_followups:scenario:{uuid.uuid4().hex[:8]}")
        return result.detail

    if kind == "expect_outbox":
        lead = ctx.lead(args["lead"])
        await asyncio.sleep(float(args.get("settle_s", 1)))
        rows = await dealer_scoped_db(lead["dealer_id"]).collection(DEV_OUTBOX_COLLECTION).find(
            {"lead_id": lead["lead_id"], "channel": args["channel"]}).to_list(None)
        if len(rows) != int(args["count"]):
            raise ScenarioFailed(f"{len(rows)} {args['channel']} message(s) left, expected {args['count']}")
        if "contains" in args and rows and not any(args["contains"].lower() in r["text"].lower() for r in rows):
            raise ScenarioFailed(f"no {args['channel']} message mentions {args['contains']!r}")
        return f"{len(rows)} {args['channel']} message(s) left" + (f" to {rows[-1]['to']}" if rows else "")

    if kind == "expect_no_followup":
        lead = ctx.lead(args["lead"])
        await asyncio.sleep(float(args.get("settle_s", 1)))
        rows = await dealer_scoped_db(lead["dealer_id"]).collection(SCHEDULED_FOLLOWUPS_COLLECTION).find(
            {"lead_id": lead["lead_id"], **_kind_filter(args),
             **({"status": args["status"]} if "status" in args else {})}).to_list(None)
        if rows:
            raise ScenarioFailed(f"{len(rows)} follow-up(s) scheduled: {[r['status'] for r in rows]}")
        return "no follow-up scheduled"

    if kind == "expect_lead":
        lead = ctx.lead(args["lead"])

        async def matches():
            doc = await dealer_scoped_db(lead["dealer_id"]).collection(AI_LEAD_STATE_COLLECTION).find_one(
                {"lead_id": lead["lead_id"]}) or {}
            ok = ("status" not in args or doc.get("status") == args["status"]) and (
                "staff_alert" not in args or bool(doc.get("staff_alert")) == bool(args["staff_alert"])) and (
                "summary_contains" not in args
                or args["summary_contains"].lower() in ((doc.get("summary") or {}).get("text") or "").lower()) and (
                "after_hours" not in args or _after_hours_choice(doc) == args["after_hours"]) and (
                "staff_notice" not in args or (doc.get("staff_notice") or {}).get("kind") == args["staff_notice"]) and (
                "visit_attempts" not in args or _visit(doc).get("attempts") == args["visit_attempts"]) and (
                "visit_declined" not in args or bool(_visit(doc).get("declined")) == bool(args["visit_declined"])) and (
                # MASTER_PLAN_3 C3: the lifecycle stage (agent/lifecycle.py).
                "stage" not in args or doc.get("stage") == args["stage"]) and (
                "next_action" not in args or bool(doc.get("next_action")) == bool(args["next_action"]))
            return doc if ok else None

        try:
            doc = await _wait(matches, float(args.get("timeout_s", 10)), "the lead's state")
        except ScenarioFailed:
            doc = await dealer_scoped_db(lead["dealer_id"]).collection(AI_LEAD_STATE_COLLECTION).find_one(
                {"lead_id": lead["lead_id"]}) or {}
            raise ScenarioFailed(f"lead is {doc.get('status')!r} at stage {doc.get('stage')!r}, staff alert "
                                 f"{(doc.get('staff_alert') or {}).get('reason')!r}, after-hours choice "
                                 f"{_after_hours_choice(doc)!r}, staff notice "
                                 f"{(doc.get('staff_notice') or {}).get('kind')!r}, visit attempts "
                                 f"{_visit(doc).get('attempts')!r} (declined {_visit(doc).get('declined')!r})"
                                 ) from None
        alert = (doc.get("staff_alert") or {}).get("reason")
        covered = (doc.get("summary") or {}).get("messages")
        notice = (doc.get("staff_notice") or {}).get("text")
        return (f"lead is {doc.get('status')}" + (f", stage {doc.get('stage_label')}" if doc.get("stage") else "")
                + (f"; staff alert: {alert}" if alert else "")
                + (f"; summary covers {covered} message(s)" if covered else "")
                + (f"; after hours: {_after_hours_choice(doc)}" if _after_hours_choice(doc) else "")
                + (f"; notice for the team: {notice}" if notice else ""))

    if kind == "expect_booking":
        # MASTER_PLAN_3 B5: {lead, status: pending|confirmed|cancelled|none, time?: "HH:MM"}
        lead = ctx.lead(args["lead"])
        want = args.get("status", "pending")

        async def found():
            booking = await _booking(lead)
            if want == "none":
                return {} if booking is None else None
            return booking if booking and booking.get("booking_status") == want and (
                "time" not in args or booking.get("bookingTime") == str(args["time"])) else None

        try:
            booking = await _wait(found, float(args.get("timeout_s", 10)), f"a {want} booking")
        except ScenarioFailed:
            booking = await _booking(lead)
            raise ScenarioFailed(f"booking is {booking and booking.get('booking_status')!r} at "
                                 f"{booking and booking.get('bookingTime')!r}, expected {want}") from None
        return "no booking" if want == "none" else (
            f"booking {booking['booking_status']} at {booking['bookingTime']} ({booking.get('notes')})")

    if kind == "take_offered_time":
        # MASTER_PLAN_3 B5 item 3: other customers fill one of the times we just offered this lead.
        lead = ctx.lead(args["lead"])
        state = await dealer_scoped_db(lead["dealer_id"]).collection(AI_LEAD_STATE_COLLECTION).find_one(
            {"lead_id": lead["lead_id"]}) or {}
        offered = _visit(state).get("offered_times") or []
        index = int(args.get("index", 0))
        if index >= len(offered):
            raise ScenarioFailed(f"only {len(offered)} time(s) offered")
        slot = offered[index]
        profile = await dealer_profile(lead["dealer_id"])
        from datetime import datetime
        day = datetime.fromisoformat(slot["iso"]).astimezone(profile.tz)
        midnight = day.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
        bookings = dealer_scoped_db(lead["dealer_id"]).collection(PLATFORM_BOOKINGS_COLLECTION)
        for n in range(int(args.get("count", 2))):
            await bookings.insert_one({"dealer_id": lead["dealer_id"], "lead_id": f"scenario-other-{uuid.uuid4().hex[:8]}",
                                       "customerName": f"Other {n + 1}", "email": "other@example.test",
                                       "phone": "5550000000", "bookingDate": midnight, "bookingTime": slot["time"],
                                       "booking_status": "pending", "notes": "scenario: fills the slot"})
        return f"{slot['display']} filled by {args.get('count', 2)} other booking(s)"

    if kind == "chat":
        lead = ctx.lead(args["lead"])
        texts = list(args.get("messages", []))
        filler = ("Just adding a bit more background while I think it over, nothing urgent on my side and "
                  "I appreciate the patience. ")
        size = int(args.get("filler_chars", 700))
        texts += [f"Note {i + 1}: " + (filler * (size // len(filler) + 1))[:size] for i in range(int(args.get("filler", 0)))]
        for text in texts:
            before = len(await _turns(lead))
            await simulate.send_reply(lead["dealer_id"], lead["lead_id"], lead["channel"], text, ctx.enqueue)

            async def answered(count=before + 1):
                turns = await _turns(lead)
                return len(turns) >= count and all(t.get("outcome") for t in turns)

            await _wait(answered, float(args.get("timeout_s", 20)), "the reply to a chat message")
        return f"{len(texts)} message(s) sent and answered"

    if kind == "platform_reply":
        lead = ctx.lead(args["lead"])
        await asyncio.sleep(0.5)  # after the AI's draft, like a real n8n reply
        await get_db()["emails"].insert_one({
            "dealer_id": lead["dealer_id"], "lead_id": ObjectId(lead["lead_id"]), "status": "sent",
            "ai_generated": False, "communication_type": lead["channel"], "mail_content": args["text"],
            "timestamp": clock.now(), **({"message_by": ObjectId()} if args.get("by") == "staff" else {})})
        return f"{args.get('by', 'n8n')} sent: {args['text']!r}"

    if kind == "expect_shadow":
        from upsell_agent.devtools.shadow import shadow_pairs

        lead = ctx.lead(args["lead"])
        pairs = [p for p in (await shadow_pairs(lead["dealer_id"], days=1))["pairs"] if p["lead_id"] == lead["lead_id"]]
        if len(pairs) != int(args["drafts"]):
            raise ScenarioFailed(f"{len(pairs)} shadow draft(s) for this lead, expected {args['drafts']}")
        with_actual = sum(1 for p in pairs if p["actual"])
        if "with_actual" in args and with_actual != int(args["with_actual"]):
            raise ScenarioFailed(f"{with_actual} draft(s) paired with a platform reply, expected {args['with_actual']}")
        return f"{len(pairs)} draft(s), {with_actual} next to what the customer actually got"

    if kind == "expect_context":
        lead = ctx.lead(args["lead"])
        turns = await _turns(lead)
        if not turns:
            raise ScenarioFailed("no turns recorded")
        turn = turns[int(args.get("index", -1))]
        load = next((n for n in turn.get("nodes", []) if n["node"] == "load_context" and n.get("status") == "done"), None)
        pack = ((load or {}).get("output") or {}).get("prompt", {}).get("context_pack")
        if not pack:
            raise ScenarioFailed("that turn has no context pack (prompts are only stored in DEV)")
        memory, conversation = pack["working_memory"], pack["conversation"]
        problems = []
        if "new_messages" in args and [m["text"] for m in pack["new_messages"]] != args["new_messages"]:
            problems.append(f"new messages {[m['text'] for m in pack['new_messages']]} != {args['new_messages']}")
        if len(memory) < int(args.get("min_working_memory", 0)):
            problems.append(f"{len(memory)} message(s) in working memory, expected at least {args['min_working_memory']}")
        if "last_from_ai" in args and bool(memory and memory[-1]["direction"] == "outbound") != bool(args["last_from_ai"]):
            problems.append("the newest working-memory message is " + (memory[-1]["direction"] if memory else "missing"))
        if "last_asked" in args and bool(conversation["last_asked"]) != bool(args["last_asked"]):
            problems.append(f"last asked {conversation['last_asked']}")
        if "open_questions" in args and [q["text"] for q in conversation["open_questions"]] != args["open_questions"]:
            problems.append(f"open questions {[q['text'] for q in conversation['open_questions']]}")
        if "promise_contains" in args and not any(args["promise_contains"].lower() in p["text"].lower()
                                                   for p in conversation["promises"]):
            problems.append(f"no promise mentions {args['promise_contains']!r}: {[p['text'] for p in conversation['promises']]}")
        if "summary_contains" in args and args["summary_contains"].lower() not in (pack.get("summary") or "").lower():
            problems.append(f"the summary doesn't mention {args['summary_contains']!r}: {(pack.get('summary') or '')[:200]!r}")
        if "memory_excludes" in args and any(args["memory_excludes"].lower() in m["text"].lower() for m in memory):
            problems.append(f"working memory still has {args['memory_excludes']!r}")
        if problems:
            raise ScenarioFailed("; ".join(problems))
        return (f"{len(pack['new_messages'])} new, {len(memory)} in working memory, "
                f"reply #{conversation['turn'] + 1}, {len(conversation['promises'])} promise(s)")

    if kind == "add_stock":
        from upsell_agent.devtools.dev_inventory import insert_stock
        from upsell_agent.integrations.mongodb import PLATFORM_VEHICLES_COLLECTION

        dealer_id = DEALER_ALIASES.get(args.get("dealer", "A"), args.get("dealer", "A"))
        rows = [(v["year"], v["make"], v["model"], v.get("trim", ""), v.get("body", ""), v.get("condition", "used"),
                 v.get("color", ""), v.get("miles", 0), v.get("price", 0))
                for v in args["vehicles"]]
        records = await insert_stock(dealer_id, rows, salt=uuid.uuid4().hex)
        await get_db()[PLATFORM_VEHICLES_COLLECTION].update_many(
            {"vin": {"$in": [r["vin"] for r in records]}, "dealerId": dealer_id},
            {"$set": {"dev_scenario": True}})
        ctx.stock[args["as"]] = records
        # The worker caches stock searches for 60 s; make it forget them so this stock is what it finds.
        await ctx.enqueue("clear_inventory_cache", key=f"clear_inventory_cache:scenario:{uuid.uuid4().hex[:8]}")
        await asyncio.sleep(0.5)
        return f"{len(records)} vehicle(s) in stock: {', '.join(r['vin'] for r in records)}"

    if kind == "expect_inventory":
        from upsell_agent.tools.inventory_tool import MAX_LOADED

        lead = ctx.lead(args["lead"])
        turns = await _turns(lead)
        if not turns:
            raise ScenarioFailed("no turns recorded")
        turn = turns[int(args.get("index", -1))]
        node = next((n for n in turn.get("nodes", []) if n["node"] == "search_stock" and n.get("status") == "done"), None)
        inventory = (node or {}).get("output")
        if inventory is None:
            raise ScenarioFailed("that turn has no Search stock step")
        loaded = [r["vin"] for r in inventory.get("records", [])]
        excluded = [e["vin"] for e in inventory.get("excluded", [])]
        problems = []
        if "searched" in args and bool(inventory.get("searched")) != bool(args["searched"]):
            problems.append(f"searched is {inventory.get('searched')}")
        if inventory.get("error"):
            problems.append(f"the search failed: {inventory['error']}")
        if "query" in args and inventory.get("query") != args["query"]:
            problems.append(f"query {inventory.get('query')} != {args['query']}")
        if len(loaded) < int(args.get("min_loaded", 0)):
            problems.append(f"{len(loaded)} vehicle(s) loaded, expected at least {args['min_loaded']}")
        if len(loaded) > MAX_LOADED:
            problems.append(f"{len(loaded)} vehicles given to the AI, the limit is {MAX_LOADED}")
        if "year" in (inventory.get("params") or {}):
            problems.append("the broken `year` parameter was sent")
        if alias := args.get("loaded_include"):
            wanted = [r["vin"] for r in ctx.stock[alias]][:MAX_LOADED]
            if missing := [v for v in wanted if v not in loaded]:
                problems.append(f"{alias}: {missing} not loaded (loaded {loaded})")
        if "loosened" in args and [st["step"] for st in inventory.get("loosened", [])] != list(args["loosened"]):
            problems.append(f"loosened {[st['step'] for st in inventory.get('loosened', [])]} != {args['loosened']}")
        if "colour_sent" in args and (inventory.get("params") or {}).get("exterior_color") != args["colour_sent"]:
            sent = [a["params"].get("exterior_color") for a in inventory.get("attempts", [])]
            if args["colour_sent"] not in sent:
                problems.append(f"colour {args['colour_sent']!r} never sent (sent {sent})")
        if "trigger" in args and args["trigger"] not in (inventory.get("trigger") or ""):
            problems.append(f"trigger {inventory.get('trigger')!r} doesn't mention {args['trigger']!r}")
        if alias := args.get("only_loaded"):
            allowed = {r["vin"] for r in ctx.stock[alias]}
            if wrong := [v for v in loaded if v not in allowed]:
                problems.append(f"loaded {wrong}, which aren't in {alias}")
        returned = set(loaded) | set(excluded)
        if (alias := args.get("never_loaded")) and (wrong := [r["vin"] for r in ctx.stock[alias] if r["vin"] in returned]):
            problems.append(f"{alias}: {wrong} came back from the search")
        if problems:
            raise ScenarioFailed("; ".join(problems))
        if not inventory.get("searched"):
            return "no search this turn"
        steps = [st["step"] for st in inventory.get("loosened", [])]
        return (f"{inventory.get('query')} matched {inventory.get('matched')}, {len(loaded)} loaded "
                f"({', '.join(loaded)}), {len(excluded)} left out" + (f", loosened {', '.join(steps)}" if steps else ""))

    if kind == "compare_inventory":
        dealers = [DEALER_ALIASES.get(d, d) for d in args.get("dealers", ["A", "B"])]
        results = await compare_inventory.compare_dealers(dealers)
        errors = [r for r in results if r["error"]]
        if errors:
            raise ScenarioFailed(errors[0]["error"])
        if not any(r["found"] for r in results):
            raise ScenarioFailed("no dev stock found; run `make ai-seed` first")
        mismatched = [r for r in results if r["problems"]]
        if mismatched:
            first = mismatched[0]
            raise ScenarioFailed(f"{len(mismatched)}/{len(results)} searches differ; "
                                 f"{first['search']}: {first['problems'][0]}")
        return f"{len(results)} searches match between stub and live /api/car"

    if kind == "set_contact":
        lead = ctx.lead(args["lead"])
        db = get_db()
        lead_set: dict[str, Any] = {}
        if "source" in args:
            lead_set.update(source=args["source"], lead_source=args["source"])
        if "comments" in args:
            lead_set.update({"comments": args["comments"], "data.comments": args["comments"]})
        if lead_set:
            await db[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(lead["lead_id"])}, {"$set": lead_set})
        customer_set: dict[str, Any] = {}
        if "dealervault" in args:
            customer_set["dealervault_upload"] = bool(args["dealervault"])
        if "sms_opt_in" in args:
            customer_set["phones.0.sms_opt_in"] = args["sms_opt_in"]
        if customer_set:
            await db[PLATFORM_CUSTOMERS_COLLECTION].update_one({"_id": ObjectId(lead["customer_id"])},
                                                               {"$set": customer_set})
        if args.get("zip"):
            inserted = await db[PLATFORM_DEALS_COLLECTION].insert_one(
                {"dealer_id": lead["dealer_id"], "deal_number": f"scenario-{uuid.uuid4().hex[:8]}",
                 "customer_id": ObjectId(lead["customer_id"]), "Zip": str(args["zip"]), "dev_scenario": True})
            ctx.deals.append(inserted.inserted_id)
        return ", ".join(f"{k}={v!r}" for k, v in args.items() if k != "lead")

    if kind == "expect_origin":
        lead = ctx.lead(args["lead"])

        async def origin():
            doc = await dealer_scoped_db(lead["dealer_id"]).collection(AI_LEAD_STATE_COLLECTION).find_one(
                {"lead_id": lead["lead_id"]}) or {}
            return doc.get("origin")

        found = await _wait(origin, float(args.get("timeout_s", 10)), "the lead's origin")
        if found.get("origin") != args["origin"]:
            raise ScenarioFailed(f"lead is {found.get('origin')} ({found.get('rule')}), expected {args['origin']}")
        return f"{found['origin']}: {found.get('rule')}"

    if kind == "campaign_check":
        lead = ctx.lead(args["lead"])
        key = f"scenario:{uuid.uuid4().hex[:10]}"
        checks = get_db()[AI_SEND_CHECKS_COLLECTION]
        await checks.insert_one({
            "request_key": key, "dealer_id": lead["dealer_id"], "campaign_id": "scenario",
            "campaign_lead_id": key, "lead_id": lead["lead_id"], "customer_id": lead["customer_id"], "phone": None,
            "channel": "sms", "purpose": "marketing", "status": "pending", "requested_at": clock.now(),
            "dev_scenario": True})
        ctx.send_checks.append(key)

        async def answered():
            entry = await checks.find_one({"request_key": key})
            return entry if entry and entry.get("status") == "answered" else None

        entry = await _wait(answered, float(args.get("timeout_s", 15)), "the send check's answer")
        detail = f"{entry['decision']}: {entry.get('reason')}"
        if entry["decision"] != args["expect"]:
            raise ScenarioFailed(f"expected {args['expect']}, got {detail}")
        if "reason_contains" in args and args["reason_contains"].lower() not in (entry.get("reason") or "").lower():
            raise ScenarioFailed(f"reason {entry.get('reason')!r} doesn't mention {args['reason_contains']!r}")
        if "until_local" in args:
            profile = await dealer_profile(lead["dealer_id"])
            until = entry["until"].replace(tzinfo=UTC).astimezone(profile.tz).strftime("%H:%M")
            if until != str(args["until_local"]):
                raise ScenarioFailed(f"held until {until} dealer time, expected {args['until_local']}")
            detail += f" (until {until} dealer time)"
        return detail

    if kind == "sleep":
        await asyncio.sleep(float(args.get("seconds", 1)))
        return "slept"

    raise ScenarioFailed(f"unknown step {kind!r}")


async def _replies_with_jargon(ctx: RunContext) -> list[str]:
    from upsell_agent.guardrails.plain_language import find_jargon

    found = []
    for lead in ctx.leads.values():
        rows = await dealer_scoped_db(lead["dealer_id"]).collection(AI_MESSAGES_COLLECTION).find(
            {"lead_id": lead["lead_id"], "direction": "outbound"}).to_list(None)
        for row in rows:
            if terms := find_jargon(f"{row.get('text') or ''} {row.get('subject') or ''}"):
                found.append(f"{terms} in {str(row.get('text'))[:80]!r}")
    return found


async def run_scenario(scenario: dict[str, Any], enqueue: Enqueue, queue: Queue | None) -> dict[str, Any]:
    ctx = RunContext(enqueue=enqueue, queue=queue)
    started = time.perf_counter()
    results, passed = [], True
    for raw in scenario.get("steps", []):
        (kind, args), = raw.items()
        args = args or {}
        if not passed:
            results.append({"step": kind, "status": "skipped", "detail": ""})
            continue
        try:
            detail = await _step(ctx, kind, args)
            results.append({"step": kind, "status": "passed", "detail": detail})
        except Exception as exc:  # noqa: BLE001 - a failing step fails the scenario, never the runner
            passed = False
            results.append({"step": kind, "status": "failed", "detail": str(exc) or repr(exc)})
    if passed:
        # Every reply the scenario produced must be plain English (MASTER_PLAN_2 Phase 7).
        leaky = await _replies_with_jargon(ctx)
        if leaky:
            passed = False
            results.append({"step": "plain replies", "status": "failed",
                            "detail": "internal terms in a reply: " + "; ".join(leaky[:3])})
        else:
            results.append({"step": "plain replies", "status": "passed",
                            "detail": "no internal terms in any reply"})
    if ctx.stock:
        from upsell_agent.integrations.mongodb import PLATFORM_VEHICLES_COLLECTION

        vins = [r["vin"] for rows in ctx.stock.values() for r in rows]
        await get_db()[PLATFORM_VEHICLES_COLLECTION].delete_many({"vin": {"$in": vins}, "dev_scenario": True})
    if ctx.deals:
        await get_db()[PLATFORM_DEALS_COLLECTION].delete_many({"_id": {"$in": ctx.deals}, "dev_scenario": True})
    if ctx.send_checks:
        await get_db()[AI_SEND_CHECKS_COLLECTION].delete_many({"request_key": {"$in": ctx.send_checks}})
    if ctx.changed_dealers:
        await simulate.ensure_platform_dealers()
    if ctx.moved_clock:
        # Every scenario starts on real time.
        from upsell_agent.integrations.redis_client import get_redis

        await clock.reset(get_redis())
    run = {"_id": scenario["id"], "name": scenario.get("name", scenario["id"]), "stage": scenario.get("stage"),
           "passed": passed, "steps": results, "ms": round((time.perf_counter() - started) * 1000),
           "last_run_at": clock.now()}
    await get_db()[DEV_SCENARIO_RUNS_COLLECTION].replace_one({"_id": run["_id"]}, run, upsert=True)
    return run


class RealModelsRefused(Exception):
    """Scenarios never call a real AI model. ai-api and ai-worker both read
    the same agentic-upsell/.env, so this check is accurate for both, even
    though this code runs in ai-api's own process: the actual model calls
    happen in ai-worker (scenarios enqueue jobs to it, the same as a real
    customer message), not here."""


async def run_all(enqueue: Enqueue, queue: Queue | None, only: list[str] | None = None) -> list[dict[str, Any]]:
    settings = get_settings()
    if settings.model_extract != OFFLINE or settings.model_compose != OFFLINE:
        raise RealModelsRefused(
            f"Refusing to run scenarios: MODEL_EXTRACT={settings.model_extract!r}, "
            f"MODEL_COMPOSE={settings.model_compose!r}. Scenarios call real AI models when these "
            "aren't 'offline' - set both to offline in agentic-upsell/.env and restart ai-api/ai-worker "
            "(`make ai-restart`) before running scenarios.")
    # Follow-ups check the dealer's AI mode on the platform's dealer record.
    await simulate.ensure_platform_dealers()
    runs = []
    for scenario in load_scenarios():
        if only and scenario["id"] not in only:
            continue
        runs.append(await run_scenario(scenario, enqueue, queue))
    return runs


async def last_runs() -> dict[str, dict[str, Any]]:
    docs = await get_db()[DEV_SCENARIO_RUNS_COLLECTION].find({}).to_list(None)
    return {d["_id"]: d for d in docs}


async def _cli(only: list[str]) -> int:
    from upsell_agent.integrations.mongodb import close_mongo, ensure_indexes, init_mongo
    from upsell_agent.integrations.redis_client import close_redis, init_redis
    from upsell_agent.worker.queue import make_enqueue, make_queue

    settings = get_settings()
    if not settings.is_dev:
        print("Scenarios only run with ENVIRONMENT=DEV.")
        return 2
    await init_mongo(settings)
    await ensure_indexes()
    await init_redis(settings)
    await simulate.ensure_dev_dealers()
    queue = make_queue(settings)
    await queue.connect()
    try:
        runs = await run_all(make_enqueue(queue), queue, only or None)
    except RealModelsRefused as exc:
        print(str(exc))
        return 2
    finally:
        await queue.disconnect()
        await close_mongo()
        await close_redis()
    for run in runs:
        print(f"{'PASS' if run['passed'] else 'FAIL'}  stage {run['stage']}  {run['name']}  ({run['ms']} ms)")
        for step in run["steps"]:
            if step["status"] != "passed":
                print(f"        {step['status']}: {step['step']} — {step['detail']}")
    failed = [r for r in runs if not r["passed"]]
    print(f"\n{len(runs) - len(failed)}/{len(runs)} scenarios passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_cli(sys.argv[1:])))
