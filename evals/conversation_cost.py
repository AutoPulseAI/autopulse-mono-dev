"""Per-conversation cost and grammar measurement (MASTER_PLAN_4 stream E;
client ask of 5 Oct 2026: "calculate the cost, including when the AI extracts
data and calls tools/APIs, in all scenarios ... across all the buckets").

Drives the scripted conversations in evals/conversations/*.yaml through the
REAL turn pipeline - the same event handlers the worker uses
(events/handlers.py -> agent/turn.py: extract, validate, search stock,
decide, compose, guard, retry, template fallback, send), with the fake
channel driver and the stub platform/inventory - on a fresh in-memory
database per conversation (mongomock, as the unit tests and evals/harness.py
do), seeded with the dev dealers and dev stock (devtools/seed.py,
devtools/dev_inventory.py). Nothing touches a real database, CRM or provider.

Measured per AI call: step (extract / compose / retry / summary / other),
model, input / cached input / output tokens, latency and cost. Per turn: guard
retries, template fallbacks, stock searches (and the inventory queries behind
them), booking calls, and every outbound message. The rolling-summary job a
turn queues is run inline right after that turn, so its cost is counted.

Run (from agentic-upsell/):

    python -m evals.conversation_cost --model-extract offline --model-compose offline --out evals/reports/conversation_cost
    python -m evals.conversation_cost --model-extract openai:gpt-5-mini --model-compose openai:gpt-5-mini \
        --out evals/reports/conversation_cost --budget 5

Options: --only <id prefix> (repeatable), --grammar auto|judge|heuristic|off, --prices prices.json
({"model": [input, cached_input, output] USD per 1M tokens}). Models also come from MODEL_EXTRACT /
MODEL_COMPOSE when the flags are left out.
"""

import argparse
import os
import sys


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="python -m evals.conversation_cost", description=__doc__.split("\n\n")[0])
    p.add_argument("--model-extract", default=os.environ.get("MODEL_EXTRACT", "offline"))
    p.add_argument("--model-compose", default=os.environ.get("MODEL_COMPOSE", "offline"))
    p.add_argument("--out", default="evals/reports/conversation_cost")
    p.add_argument("--conversations", default=None, help="directory of conversation YAML files")
    p.add_argument("--only", action="append", default=[], help="run only conversations whose id starts with this")
    p.add_argument("--budget", type=float, default=5.0, help="stop when the measured spend passes this (USD)")
    p.add_argument("--grammar", choices=("auto", "judge", "heuristic", "off"), default="auto")
    p.add_argument("--prices", default=None, help="JSON file: {model: [input, cached_input, output]} per 1M tokens")
    p.add_argument("--tag", default=None, help="report file name tag (default: the compose model)")
    p.add_argument("--max-messages", type=int, default=None, help="only the first N customer messages (trials)")
    p.add_argument("--extract-timeout", type=float, default=None, help="EXTRACT_TIMEOUT_S for this run")
    p.add_argument("--compose-timeout", type=float, default=None, help="COMPOSE_TIMEOUT_S for this run")
    p.add_argument("--reasoning-effort", default=None, choices=("minimal", "low", "medium", "high"),
                   help="OpenAI reasoning effort for GPT-5 models, only when the pipeline sets none itself")
    return p.parse_args(argv)


# The models must be in the environment before upsell_agent's settings are first read.
if __name__ == "__main__":
    _ARGS = _parse_args()
    os.environ["MODEL_EXTRACT"] = _ARGS.model_extract
    os.environ["MODEL_COMPOSE"] = _ARGS.model_compose
    if _ARGS.extract_timeout:
        os.environ["EXTRACT_TIMEOUT_S"] = str(_ARGS.extract_timeout)
    if _ARGS.compose_timeout:
        os.environ["COMPOSE_TIMEOUT_S"] = str(_ARGS.compose_timeout)
os.environ.setdefault("MODEL_EXTRACT", "offline")
os.environ.setdefault("MODEL_COMPOSE", "offline")
# No traces to Langfuse, no live platform: the stub platform client and inventory over the in-memory database.
os.environ["LANGFUSE_PUBLIC_KEY"] = ""
os.environ["LANGFUSE_SECRET_KEY"] = ""
os.environ["PLATFORM_CLIENT"] = "stub"
os.environ.setdefault("UPSELL_SERVICE_SHARED_SECRET", "evals")

import asyncio
import contextvars
import csv
import json
import re
import statistics
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import yaml
from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient
from pydantic_ai import Agent

from upsell_agent import clock
from upsell_agent.agent import llm
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.compliance import engine
from upsell_agent.compliance.customer_zone import CustomerZone
from upsell_agent.config import get_settings
from upsell_agent.devtools import seed, simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations import dealer_profile, mongodb
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.tools import inventory_tool

DEALER = simulate.DEV_DEALERS[0]["_id"]  # dev dealer A: New York, Mon-Fri 9-7, Sat 9-5
DEALER_TZ = ZoneInfo("America/New_York")
# A Tuesday, like evals/harness.py's EVAL_NOW. A conversation's `start` is "Tue HH:MM" in that week.
WEEK_OF = datetime(2026, 9, 21, tzinfo=DEALER_TZ)  # Monday
DAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
MINUTES_BETWEEN_MESSAGES = 2
CONVERSATIONS_DIR = Path(__file__).parent / "conversations"

# USD per 1M tokens: (input, cached input, output). OpenAI list prices; the cached rate applies to the cached
# part of the input. Reasoning tokens (GPT-5 family) are billed as output and are included in output tokens.
# agent/llm.py's PRICES_PER_MTOK wins when it has a 3-price row for the model (stream G adds GPT-5 there).
PRICES: dict[str, tuple[float, float, float]] = {
    "gpt-5": (1.25, 0.125, 10.00),
    "gpt-5-mini": (0.25, 0.025, 2.00),
    "gpt-5-nano": (0.05, 0.005, 0.40),
    "gpt-4.1": (2.00, 0.50, 8.00),
    "gpt-4.1-mini": (0.40, 0.10, 1.60),
    "gpt-4.1-nano": (0.10, 0.025, 0.40),
    "gpt-4o": (2.50, 1.25, 10.00),
    "gpt-4o-mini": (0.15, 0.075, 0.60),
}
MONTHLY_VOLUMES = (100, 500, 1000)


# --- What we record ----------------------------------------------------------------------------------

@dataclass
class Call:
    step: str
    model: str
    input_tokens: int
    cached_tokens: int
    output_tokens: int
    reasoning_tokens: int
    requests: int
    ms: int
    cost_usd: float | None
    ok: bool = True
    error: str | None = None


@dataclass
class Turn:
    index: int
    trigger: str  # lead_created | inbound_message
    customer: str
    replies: list[str] = field(default_factory=list)
    calls: list[Call] = field(default_factory=list)
    outcome: str | None = None
    guard_retries: int = 0
    fallback: bool = False
    fallback_reason: str | None = None
    flag_human: bool = False
    after_hours: str | None = None
    booked: bool = False
    stock_searches: int = 0
    inventory_queries: int = 0
    booking_calls: int = 0
    tools: list[str] = field(default_factory=list)
    summary_runs: int = 0
    no_reply_reason: str | None = None
    ms: int = 0


@dataclass
class Conversation:
    id: str
    bucket: str
    source: str
    covers: list[str]
    turns: list[Turn] = field(default_factory=list)
    bucket_assigned: str | None = None
    grammar: dict[str, Any] | None = None
    error: str | None = None


# --- Instrumentation ---------------------------------------------------------------------------------

_current: contextvars.ContextVar[Turn | None] = contextvars.ContextVar("cost_eval_turn", default=None)
_step_override: contextvars.ContextVar[str | None] = contextvars.ContextVar("cost_eval_step", default=None)
_PRICE_OVERRIDES: dict[str, tuple[float, float, float]] = {}
_REASONING_EFFORT: dict[str, str | None] = {"value": None}


def price_for(model: str) -> tuple[float, float, float] | None:
    if model == llm.OFFLINE:
        return (0.0, 0.0, 0.0)
    name = model.split(":", 1)[-1]
    if name in _PRICE_OVERRIDES:
        return _PRICE_OVERRIDES[name]
    pipeline = getattr(llm, "PRICES_PER_MTOK", {}).get(name)
    if pipeline and len(pipeline) >= 3:
        return tuple(pipeline[:3])  # type: ignore[return-value]
    if name in PRICES:
        return PRICES[name]
    if pipeline and len(pipeline) == 2:
        return (pipeline[0], pipeline[0], pipeline[1])
    return None


def call_cost(model: str, tokens_in: int, cached: int, tokens_out: int) -> float | None:
    price = price_for(model)
    if price is None:
        return None
    p_in, p_cached, p_out = price
    return round((max(tokens_in - cached, 0) * p_in + cached * p_cached + tokens_out * p_out) / 1e6, 8)


def _usage_numbers(usage: Any) -> tuple[int, int, int, int, int]:
    """(input, cached input, output, reasoning, requests) from a pydantic_ai usage object, defensively:
    `input_tokens` already includes the cached part (OpenAI prompt_tokens)."""
    if callable(usage):
        usage = usage()
    details = getattr(usage, "details", None) or {}
    cached = (getattr(usage, "cache_read_tokens", None) or getattr(usage, "cached_tokens", None)
              or details.get("cached_tokens") or 0)
    reasoning = details.get("reasoning_tokens") or 0
    return (getattr(usage, "input_tokens", 0) or 0, int(cached), getattr(usage, "output_tokens", 0) or 0,
            int(reasoning), getattr(usage, "requests", 1) or 1)


def _model_name(agent: Agent) -> str:
    """The model string the pipeline asked for (MODEL_EXTRACT / MODEL_COMPOSE)."""
    settings = get_settings()
    return settings.model_compose if agent.name == "compose" else settings.model_extract


_original_run = Agent.run


async def _recording_run(self: Agent, *args: Any, **kwargs: Any) -> Any:
    """Every Pydantic AI call the pipeline makes goes through Agent.run (agent/llm.py run_agent)."""
    turn = _current.get()
    started = time.perf_counter()
    model = _model_name(self)
    effort = _REASONING_EFFORT["value"]
    if effort and "gpt-5" in model and not kwargs.get("model_settings") and not getattr(self, "model_settings", None):
        kwargs["model_settings"] = {"openai_reasoning_effort": effort}
    try:
        result = await _original_run(self, *args, **kwargs)
    except BaseException as exc:
        if turn is not None:
            turn.calls.append(Call(step=_step(self, turn), model=model, input_tokens=0, cached_tokens=0,
                                   output_tokens=0, reasoning_tokens=0, requests=0,
                                   ms=round((time.perf_counter() - started) * 1000), cost_usd=0.0, ok=False,
                                   error=f"{type(exc).__name__}: {exc}"[:300]))
        raise
    if turn is not None:
        tin, cached, tout, reasoning, requests = _usage_numbers(result.usage)
        turn.calls.append(Call(step=_step(self, turn), model=model, input_tokens=tin, cached_tokens=cached,
                               output_tokens=tout, reasoning_tokens=reasoning, requests=requests,
                               ms=round((time.perf_counter() - started) * 1000),
                               cost_usd=call_cost(model, tin, cached, tout)))
    return result


def _step(agent: Agent, turn: Turn) -> str:
    if override := _step_override.get():
        return override
    name = agent.name or "other"
    if name == "compose" and any(c.step in ("compose", "retry") for c in turn.calls):
        return "retry"  # a second Compose in the same turn: the guard sent the draft back
    return name if name in ("extract", "compose", "summary") else "other"


_original_stock_search = inventory_tool.StubInventorySource.search
_original_create_booking = StubPlatformClient.create_booking
_original_update_booking = StubPlatformClient.update_booking


async def _counted_stock_search(self: Any, params: dict[str, str], limit: int) -> dict[str, Any]:
    if turn := _current.get():
        turn.inventory_queries += 1
        turn.tools.append("inventory: " + ", ".join(f"{k}={v}" for k, v in params.items() if k != "dealer_id"))
    return await _original_stock_search(self, params, limit)


async def _counted_create_booking(self: Any, dealer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if turn := _current.get():
        turn.booking_calls += 1
        turn.tools.append(f"booking: create {payload.get('bookingDate') or ''} {payload.get('bookingTime') or ''}".strip())
    return await _original_create_booking(self, dealer_id, payload)


async def _counted_update_booking(self: Any, dealer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if turn := _current.get():
        turn.booking_calls += 1
        turn.tools.append(f"booking: update {payload.get('status') or ''} {payload.get('bookingDate') or ''} "
                          f"{payload.get('bookingTime') or ''}".strip())
    return await _original_update_booking(self, dealer_id, payload)


def install() -> None:
    Agent.run = _recording_run  # type: ignore[method-assign]
    inventory_tool.StubInventorySource.search = _counted_stock_search  # type: ignore[method-assign]
    StubPlatformClient.create_booking = _counted_create_booking  # type: ignore[method-assign]
    StubPlatformClient.update_booking = _counted_update_booking  # type: ignore[method-assign]


# --- Driving one conversation --------------------------------------------------------------------------

def load_conversations(directory: Path | None = None) -> list[dict[str, Any]]:
    """Each YAML file holds a list of conversations: id, bucket (credit | trade_in | general | service),
    source (the lead source the bucket classifier reads), lead_type, channel, name, start ("Tue 10:00",
    dealer time), comments (the lead form), covers (what it exercises), messages (the customer's texts)."""
    items: list[dict[str, Any]] = []
    for path in sorted((directory or CONVERSATIONS_DIR).glob("*.yaml")):
        items.extend(yaml.safe_load(path.read_text(encoding="utf-8")) or [])
    return items


def _start_time(spec: str) -> datetime:
    day, hhmm = spec.split()
    hour, minute = (int(x) for x in hhmm.split(":"))
    return (WEEK_OF + timedelta(days=DAYS[day[:3].lower()])).replace(hour=hour, minute=minute)


async def _new_york_customer(_db: Any, _customer_id: Any, _phone: Any) -> CustomerZone:
    return CustomerZone(("America/New_York",), "zip", "ZIP 10001 (cost eval)", "NY")


class _InlineSummary:
    """TurnDeps.enqueue: remembers the rolling-summary job a turn queues; the runner runs it right after."""

    def __init__(self) -> None:
        self.pending: list[dict[str, Any]] = []

    async def __call__(self, function: str, *, key: str, **kwargs: Any) -> str | None:
        self.pending.append({"function": function, **kwargs})
        return key


def _deps(enqueue: _InlineSummary) -> TurnDeps:
    return TurnDeps(settings=get_settings(), sink=MemoryTraceSink(), enqueue=enqueue,
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _setup(conv: dict[str, Any]) -> dict[str, str]:
    mongodb.set_db_for_tests(AsyncMongoMockClient()[f"cost_eval_{ObjectId()}"])
    dealer_profile.clear_cache()
    inventory_tool.clear_cache()
    engine.customer_zone = _new_york_customer
    clock.set_offset((_start_time(conv.get("start", "Tue 10:00")) - datetime.now(UTC)).total_seconds())
    await seed.seed()  # dev dealers, platform dealer records, dev customers and the dev stock
    created = await simulate.create_lead(DEALER, lead_type=conv.get("lead_type", "sales"),
                                         channel=conv.get("channel", "sms"), name=conv["name"],
                                         comments=conv.get("comments", ""))
    await simulate.set_contact(DEALER, created)
    await mongodb.get_db()[PLATFORM_LEADS_COLLECTION].update_one(
        {"_id": ObjectId(created["lead_id"])}, {"$set": {"source": conv["source"], "data.source": conv["source"]}})
    return created


async def _outbound_since(lead_id: str, seen: set[str]) -> list[str]:
    rows = await mongodb.get_db()[AI_MESSAGES_COLLECTION].find(
        {"lead_id": lead_id, "direction": "outbound"}).sort("created_at", 1).to_list(None)
    texts = []
    for row in rows:
        if str(row["_id"]) in seen:
            continue
        seen.add(str(row["_id"]))
        status = row.get("status")
        text = str(row.get("text") or "").strip()
        texts.append(text if status in (None, "sent", "delivered") else f"[{status}] {text}")
    return texts


async def _turn_logs_since(lead_id: str, seen: set[str]) -> list[dict[str, Any]]:
    logs = await mongodb.get_db()[AI_TURN_LOG_COLLECTION].find({"lead_id": lead_id}).sort("created_at", 1).to_list(None)
    fresh = [log for log in logs if str(log["_id"]) not in seen]
    seen.update(str(log["_id"]) for log in fresh)
    return fresh


def _apply_logs(turn: Turn, logs: list[dict[str, Any]]) -> None:
    for log in logs:
        if log.get("trigger") == "summary":
            continue
        summary = log.get("summary") or {}
        turn.outcome = log.get("outcome") or turn.outcome
        turn.guard_retries += int(summary.get("retries") or 0)
        turn.fallback = turn.fallback or bool(summary.get("used_fallback"))
        turn.fallback_reason = summary.get("fallback_reason") or turn.fallback_reason
        turn.flag_human = turn.flag_human or bool(summary.get("flag_human"))
        turn.after_hours = summary.get("after_hours") or turn.after_hours
        turn.booked = turn.booked or bool(summary.get("booked"))
        for node in log.get("nodes") or []:
            if node.get("node") == "search_stock" and node.get("status") == "done":
                output = node.get("output") or {}
                if output.get("searched") is True:
                    turn.stock_searches += 1


async def _run_turn(turn: Turn, created: dict[str, str], conv: Conversation, enqueue: _InlineSummary,
                    seen_logs: set[str], seen_msgs: set[str], coro_factory: Any) -> None:
    # Customer messages are minutes apart in real life: tools/inventory_tool.py's 60s cache wouldn't hit.
    inventory_tool.clear_cache()
    token = _current.set(turn)
    started = time.perf_counter()
    try:
        result = await coro_factory()
        turn.ms = round((time.perf_counter() - started) * 1000)
        # The rolling summary the turn queued: run now, like the worker would right after.
        while enqueue.pending:
            job = enqueue.pending.pop(0)
            from upsell_agent.agent.summary import update_summary

            await update_summary(job["dealer_id"], job["lead_id"], _deps(enqueue))
            turn.summary_runs += 1
    finally:
        _current.reset(token)
    _apply_logs(turn, await _turn_logs_since(created["lead_id"], seen_logs))
    turn.replies = await _outbound_since(created["lead_id"], seen_msgs)
    if not turn.replies:
        reason = (result or {}).get("reason") or (result or {}).get("status") if isinstance(result, dict) else None
        turn.no_reply_reason = str(reason or turn.outcome or "no reply")


async def run_conversation(spec: dict[str, Any]) -> Conversation:
    conv = Conversation(id=spec["id"], bucket=spec["bucket"], source=spec["source"], covers=spec.get("covers", []))
    channel = spec.get("channel", "sms")
    created = await _setup(spec)
    enqueue = _InlineSummary()
    seen_logs: set[str] = set()
    seen_msgs: set[str] = set()

    first = Turn(index=0, trigger="lead_created", customer=f"(lead form) {spec.get('comments', '')}")
    await _run_turn(first, created, conv, enqueue, seen_logs, seen_msgs, lambda: handlers.handle_lead_created(
        LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                         customer_id=created["customer_id"], channel=channel), _deps(enqueue)))
    conv.turns.append(first)

    for i, text in enumerate(spec["messages"], start=1):
        clock.set_offset(clock.offset_s() + MINUTES_BETWEEN_MESSAGES * 60)
        message_id = str(ObjectId())
        turn = Turn(index=i, trigger="inbound_message", customer=str(text))
        await _run_turn(turn, created, conv, enqueue, seen_logs, seen_msgs, lambda t=str(text), m=message_id:
                        handlers.handle_inbound_message(InboundMessageEvent(
                            event_id=m, dealer_id=DEALER, customer_id=created["customer_id"],
                            lead_id=created["lead_id"], channel=channel, message_id=m, text=t,
                            received_at=clock.now()), _deps(enqueue)))
        conv.turns.append(turn)

    state = await mongodb.get_db()[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}
    conv.bucket_assigned = state.get("original_bucket") or ("none (service)" if spec["bucket"] == "service" else None)
    return conv


# --- Grammar -----------------------------------------------------------------------------------------

def _find_grammar_judge() -> Any:
    """Stream G's grammar judge, if this build has it. Accepts a few likely shapes; returns a callable
    (list of reply texts) -> {"score": float|None, "issues": [str], "label": str} or None."""
    import importlib
    import inspect

    for module_name in ("evals.grammar", "evals.grammar_judge", "evals.metrics.grammar", "evals.judges.grammar",
                        "evals.test_grammar"):
        try:
            module = importlib.import_module(module_name)
        except Exception:  # noqa: BLE001, S112 - absent or broken: try the next
            continue
        for fn_name in ("judge_conversation", "grade_conversation", "judge_replies", "judge_grammar",
                        "grammar_judge", "score_grammar", "grade_grammar", "judge", "grade"):
            fn = getattr(module, fn_name, None)
            if not callable(fn):
                continue

            def call(replies: list[str], fn: Any = fn, label: str = f"{module_name}.{fn_name}") -> dict[str, Any]:
                try:
                    out = fn(replies)
                except TypeError:
                    out = [fn(r) for r in replies]
                if inspect.isawaitable(out):
                    out = asyncio.get_event_loop().run_until_complete(out)  # pragma: no cover
                return _normalise_grammar(out, label)

            return call
    return None


def _normalise_grammar(out: Any, label: str) -> dict[str, Any]:
    def one(x: Any) -> tuple[float | None, list[str]]:
        if isinstance(x, (int, float)):
            return float(x), []
        if isinstance(x, dict):
            score = x.get("score", x.get("grade", x.get("grammar_score")))
            issues = x.get("issues") or x.get("errors") or x.get("problems") or []
            return (float(score) if isinstance(score, (int, float)) else None), [str(i) for i in issues]
        score = getattr(x, "score", None)
        issues = getattr(x, "issues", None) or getattr(x, "errors", None) or []
        return (float(score) if isinstance(score, (int, float)) else None), [str(i) for i in issues]

    if isinstance(out, list):
        parts = [one(x) for x in out]
        scores = [s for s, _ in parts if s is not None]
        return {"label": label, "score": round(statistics.mean(scores), 3) if scores else None,
                "issues": [i for _, issues in parts for i in issues]}
    score, issues = one(out)
    return {"label": label, "score": score, "issues": issues}


def _guard_mechanical_check() -> Any:
    """A mechanical grammar check in the guard, if this build has one."""
    import importlib

    for module_name, fn_name in (("upsell_agent.guardrails.draft_guard", "grammar_issues"),
                                 ("upsell_agent.guardrails.draft_guard", "mechanical_issues"),
                                 ("upsell_agent.guardrails.plain_language", "grammar_issues"),
                                 ("upsell_agent.guardrails.plain_language", "mechanical_issues"),
                                 ("upsell_agent.guardrails.grammar", "grammar_issues"),
                                 ("upsell_agent.guardrails.grammar", "mechanical_issues")):
        try:
            fn = getattr(importlib.import_module(module_name), fn_name, None)
        except Exception:  # noqa: BLE001, S112 - absent: try the next
            continue
        if callable(fn):
            return fn, f"{module_name}.{fn_name}"
    return None


_HEURISTICS: list[tuple[str, re.Pattern]] = [
    ("doubled word", re.compile(r"\b(\w+)\s+\1\b", re.IGNORECASE)),
    ("lowercase sentence start", re.compile(r"(?:^|[.!?]\s+)[a-z]")),
    ("lowercase 'i'", re.compile(r"(?<![\w'])i(?![\w'])")),
    ("no space after punctuation", re.compile(r"[a-z][,.!?;][A-Za-z]{2,}")),
    ("space before punctuation", re.compile(r"\w\s+[,.!?;:](?!\w)")),
    ("repeated punctuation", re.compile(r"[!?.,]{2,}(?<!\.\.\.)")),
    ("double space", re.compile(r"\S  +\S")),
    ("'a' before a vowel sound", re.compile(r"\ba\s+(?:[aeio]\w+|hour|honest)\b", re.IGNORECASE)),
    ("'an' before a consonant", re.compile(r"\ban\s+(?![aeiou]|hour|honest|SUV|F-|X|S\b|R\b)[b-df-hj-np-tv-z]\w*",
                                           re.IGNORECASE)),
    ("no end punctuation", re.compile(r"[A-Za-z0-9]$")),
    ("unfinished template slot", re.compile(r"\{[a-z_]+\}|\[[A-Z_ ]+\]|None\b")),
]


def heuristic_issues(text: str) -> list[str]:
    """A small, LanguageTool-free mechanical check: counts surface errors only (not tone or awkwardness)."""
    body = re.sub(r"https?://\S+|\S+@\S+", "", text).strip()
    found = []
    for label, pattern in _HEURISTICS:
        for m in pattern.finditer(body):
            found.append(f"{label}: {m.group(0)!r}")
    return found


def grade(conversations: list[Conversation], mode: str) -> str:
    """Fills conv.grammar; returns the method used."""
    judge = _find_grammar_judge() if mode in ("auto", "judge") else None
    if mode == "judge" and judge is None:
        print("No grammar judge found in evals/ (stream G); falling back to the heuristic.", file=sys.stderr)
    guard = _guard_mechanical_check() if judge is None and mode != "off" else None
    method = "off"
    for conv in conversations:
        replies = [r for t in conv.turns for r in t.replies]
        if mode == "off":
            conv.grammar = None
            continue
        if judge is not None:
            conv.grammar = judge(replies)
            method = conv.grammar["label"]
            continue
        if guard is not None:
            fn, label = guard
            issues = [str(i) for r in replies for i in (fn(r) or [])]
            method = label
        else:
            issues = [i for r in replies for i in heuristic_issues(r)]
            method = "heuristic (evals/conversation_cost.py heuristic_issues)"
        conv.grammar = {"label": method, "score": None, "issues": issues,
                        "per_100_replies": round(100 * len(issues) / max(len(replies), 1), 1)}
    return method


# --- Report ------------------------------------------------------------------------------------------

def _pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def stats(convs: list[Conversation]) -> dict[str, Any]:
    turns = [t for c in convs for t in c.turns]
    calls = [call for t in turns for call in t.calls]
    replies = sum(len(t.replies) for t in turns)
    tin = sum(c.input_tokens for c in calls)
    cached = sum(c.cached_tokens for c in calls)
    unknown_price = any(c.cost_usd is None and c.ok for c in calls)
    cost = sum(c.cost_usd or 0 for c in calls)
    reply_ms = [t.ms for t in turns if t.replies]
    return {
        "conversations": len(convs),
        "customer_messages": sum(1 for t in turns if t.trigger == "inbound_message"),
        "ai_replies": replies,
        "turns_without_reply": sum(1 for t in turns if not t.replies),
        "model_calls": len(calls),
        "failed_calls": sum(1 for c in calls if not c.ok),
        "calls_by_step": {s: sum(1 for c in calls if c.step == s) for s in ("extract", "compose", "retry", "summary", "other")},
        "tokens_in": tin, "tokens_cached": cached, "tokens_out": sum(c.output_tokens for c in calls),
        "tokens_reasoning": sum(c.reasoning_tokens for c in calls),
        "cache_hit_pct": round(100 * cached / tin, 1) if tin else 0.0,
        "cost_usd": round(cost, 6), "cost_unknown": unknown_price,
        "cost_per_conversation": round(cost / len(convs), 6) if convs else 0.0,
        "cost_per_reply": round(cost / replies, 6) if replies else 0.0,
        "turn_ms_p50": _pct(reply_ms, 0.5), "turn_ms_p95": _pct(reply_ms, 0.95),
        "call_ms_p50": _pct([c.ms for c in calls], 0.5), "call_ms_p95": _pct([c.ms for c in calls], 0.95),
        "guard_retries": sum(t.guard_retries for t in turns),
        "fallbacks": sum(1 for t in turns if t.fallback),
        "stock_searches": sum(t.stock_searches for t in turns),
        "inventory_queries": sum(t.inventory_queries for t in turns),
        "booking_calls": sum(t.booking_calls for t in turns),
        "summary_runs": sum(t.summary_runs for t in turns),
    }


def _money(v: float | None, digits: int = 4) -> str:
    return "n/a" if v is None else f"${v:,.{digits}f}"


def _ms(v: float | None) -> str:
    return "n/a" if v is None else f"{v / 1000:.1f}s" if v >= 1000 else f"{v:.0f}ms"


def handoff_at(conv: Conversation) -> int | None:
    """The customer message after which the lead was with staff and the AI stopped replying."""
    for t in conv.turns:
        if not t.replies and "with staff" in (t.no_reply_reason or ""):
            return t.index
    return None


def _grammar_cell(conv: Conversation) -> str:
    g = conv.grammar
    if not g:
        return "n/a"
    if g.get("score") is not None:
        return f"{g['score']:.2f} ({len(g.get('issues') or [])} issues)"
    replies = sum(len(t.replies) for t in conv.turns)
    return f"{len(g.get('issues') or [])} flags / {replies} replies"


def write_report(convs: list[Conversation], out_dir: Path, tag: str, meta: dict[str, Any]) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = meta["started"].strftime("%Y%m%d-%H%M")
    base = out_dir / f"conversation_cost_{tag}_{stamp}"
    overall = stats(convs)
    buckets = ["credit", "trade_in", "general", "service"]
    by_bucket = {b: stats([c for c in convs if c.bucket == b]) for b in buckets if any(c.bucket == b for c in convs)}

    lines: list[str] = []
    w = lines.append
    w(f"# Conversation cost and grammar report: {tag}")
    w("")
    w(f"Run {meta['started'].strftime('%Y-%m-%d %H:%M UTC')}, models: extract `{meta['model_extract']}`, "
      f"compose `{meta['model_compose']}`. {len(convs)} scripted conversations "
      f"(evals/conversations/), driven turn by turn through the real pipeline (events/handlers.py -> agent/turn.py) "
      f"with the fake channel driver, stub platform and the dev dealer's seeded stock. "
      f"Generated by `python -m evals.conversation_cost`. Timeouts: extract {meta['extract_timeout_s']}s, "
      f"compose {meta['compose_timeout_s']}s; reasoning effort: "
      f"{meta.get('reasoning_effort') or 'as the pipeline sets it (model default if none)'}.")
    if meta.get("stopped"):
        w("")
        w(f"**Run stopped early:** {meta['stopped']}")
    w("")
    w("Prices (USD per 1M tokens, input / cached input / output): " + "; ".join(
        f"`{m}` {p[0]} / {p[1]} / {p[2]}" for m in sorted({meta['model_extract'], meta['model_compose']})
        if (p := price_for(m))) + ". Reasoning tokens are billed as output and are included in the output column.")
    w("")
    w("## Summary for the client")
    w("")
    o = overall
    w("| | Value |")
    w("|---|---|")
    w(f"| Conversations measured | {o['conversations']} ({o['customer_messages']} customer messages, {o['ai_replies']} AI replies) |")
    w(f"| Average cost per conversation | **{_money(o['cost_per_conversation'])}** |")
    w(f"| Average cost per AI reply | **{_money(o['cost_per_reply'], 5)}** |")
    full = o["cost_per_reply"] * (o["customer_messages"] + o["conversations"]) / max(o["conversations"], 1)
    w(f"| A conversation the AI answers end to end (every message + the first reply, no staff handoff) | "
      f"{_money(full)} |")
    w(f"| AI calls per conversation | {o['model_calls'] / max(o['conversations'], 1):.1f} "
      f"(extract {o['calls_by_step']['extract']}, compose {o['calls_by_step']['compose']}, guard retries "
      f"{o['calls_by_step']['retry']}, summary {o['calls_by_step']['summary']} in total) |")
    w(f"| Tool / API calls (total) | {o['stock_searches']} stock searches ({o['inventory_queries']} inventory queries), "
      f"{o['booking_calls']} booking calls - these are our own APIs and cost no AI tokens |")
    w(f"| Prompt cache hit | {o['cache_hit_pct']}% of input tokens |")
    w(f"| Reply time (whole turn) p50 / p95 | {_ms(o['turn_ms_p50'])} / {_ms(o['turn_ms_p95'])} |")
    w(f"| Template fallbacks | {o['fallbacks']} of {o['ai_replies']} replies |")
    w("")
    w("Projected AI spend per dealership per month (at this run's average cost per conversation; "
      "conversations of 12-15 customer messages):")
    w("")
    w("| Conversations / month | " + " | ".join(f"{v:,}" for v in MONTHLY_VOLUMES) + " |")
    w("|---|" + "---|" * len(MONTHLY_VOLUMES))
    w("| All buckets | " + " | ".join(_money(o["cost_per_conversation"] * v, 2) for v in MONTHLY_VOLUMES) + " |")
    w("| All buckets, no staff handoffs (upper bound) | "
      + " | ".join(_money(full * v, 2) for v in MONTHLY_VOLUMES) + " |")
    for b, s in by_bucket.items():
        w(f"| {b} | " + " | ".join(_money(s["cost_per_conversation"] * v, 2) for v in MONTHLY_VOLUMES) + " |")
    w("")
    w("Not included: follow-up touches the cadence sends on later days (Day 1-90), staff-side tools, SMS/email "
      "provider fees, and the grammar judge's own cost (an eval, not production).")
    w("")
    w("## By bucket")
    w("")
    w("| Bucket | Conv. | Cust. msgs | AI replies | Model calls | Tokens in / cached / out | Cache hit | Total cost | "
      "Per conv. | Per reply | Reply p50 / p95 | Guard retries | Fallbacks | Stock searches | Bookings |")
    w("|---|" + "---|" * 14)
    for b, s in [*by_bucket.items(), ("**all**", overall)]:
        w(f"| {b} | {s['conversations']} | {s['customer_messages']} | {s['ai_replies']} | {s['model_calls']} | "
          f"{s['tokens_in']:,} / {s['tokens_cached']:,} / {s['tokens_out']:,} | {s['cache_hit_pct']}% | "
          f"{_money(s['cost_usd'])} | {_money(s['cost_per_conversation'])} | {_money(s['cost_per_reply'], 5)} | "
          f"{_ms(s['turn_ms_p50'])} / {_ms(s['turn_ms_p95'])} | {s['guard_retries']} | {s['fallbacks']} | "
          f"{s['stock_searches']} | {s['booking_calls']} |")
    w("")
    w("## By conversation")
    w("")
    w(f"Grammar column: {meta.get('grammar_method', 'n/a')}.")
    w("")
    w("| Conversation | Bucket (assigned) | Cust. msgs | AI replies | Calls | Tokens in / cached / out | Cache hit | "
      "Cost | Per reply | Reply p50 / p95 | Retries | Fallbacks | Stock / inv. queries | Bookings | With staff from | "
      "Grammar |")
    w("|---|" + "---|" * 15)
    for c in convs:
        s = stats([c])
        w(f"| {c.id} | {c.bucket} ({c.bucket_assigned or '?'}) | {s['customer_messages']} | {s['ai_replies']} | "
          f"{s['model_calls']} | {s['tokens_in']:,} / {s['tokens_cached']:,} / {s['tokens_out']:,} | "
          f"{s['cache_hit_pct']}% | {_money(s['cost_usd'])} | {_money(s['cost_per_reply'], 5)} | "
          f"{_ms(s['turn_ms_p50'])} / {_ms(s['turn_ms_p95'])} | {s['guard_retries']} | {s['fallbacks']} | "
          f"{s['stock_searches']} / {s['inventory_queries']} | {s['booking_calls']} | "
          f"{f'msg {h}' if (h := handoff_at(c)) else '-'} | {_grammar_cell(c)} |"
          + (f" error: {c.error} |" if c.error else ""))
    w("")
    w("\"With staff from\": the lead was handed to staff (the customer asked for a person, said not interested, "
      "sounded urgent, or no safe reply could be written); after that the AI saves the customer's messages for staff "
      "and makes no AI calls, so those conversations cost less than a fully AI-handled one.")
    w("")
    w("## By AI step")
    w("")
    from upsell_agent.config import Settings

    prod_timeout_s = {"extract": Settings.model_fields["extract_timeout_s"].default,
                      "summary": 15.0,  # agent/summary.py SUMMARY_TIMEOUT_S
                      "compose": Settings.model_fields["compose_timeout_s"].default}
    prod_timeout_s["retry"] = prod_timeout_s["compose"]
    w(f"Last column: calls slower than the production default timeout for that step (extract "
      f"{prod_timeout_s['extract']}s, compose {prod_timeout_s['compose']}s); in production those replies would "
      f"have been the template fallback.")
    w("")
    w("| Step | Calls | Tokens in | Cached | Out (reasoning) | Cost | Share of cost | Latency p50 / p95 | "
      "Over prod. timeout |")
    w("|---|---|---|---|---|---|---|---|---|")
    all_calls = [call for c in convs for t in c.turns for call in t.calls]
    total = sum(x.cost_usd or 0 for x in all_calls) or 1
    for step in ("extract", "compose", "retry", "summary", "other"):
        cs = [x for x in all_calls if x.step == step]
        if not cs:
            continue
        cost = sum(x.cost_usd or 0 for x in cs)
        w(f"| {step} | {len(cs)} | {sum(x.input_tokens for x in cs):,} | {sum(x.cached_tokens for x in cs):,} | "
          f"{sum(x.output_tokens for x in cs):,} ({sum(x.reasoning_tokens for x in cs):,}) | {_money(cost)} | "
          f"{100 * cost / total:.0f}% | {_ms(_pct([x.ms for x in cs], 0.5))} / {_ms(_pct([x.ms for x in cs], 0.95))} | "
          + (f"{sum(1 for x in cs if x.ms > limit * 1000)} of {len(cs)} |"
             if (limit := prod_timeout_s.get(step)) else "n/a |"))
    failed = [x for x in all_calls if not x.ok]
    if failed:
        w("")
        w(f"Failed AI calls: {len(failed)} (e.g. {failed[0].error})")
    w("")
    w("## Grammar flags")
    w("")
    any_flags = False
    for c in convs:
        issues = (c.grammar or {}).get("issues") or []
        if issues:
            any_flags = True
            w(f"- **{c.id}**: " + "; ".join(issues[:12]) + (f" (+{len(issues) - 12} more)" if len(issues) > 12 else ""))
    if not any_flags:
        w("None flagged." if meta.get("grammar_method") not in (None, "off") else "Grammar not graded (n/a).")
    w("")
    w("## Appendix: transcripts")
    w("")
    w("Every message the customer sent and every message that left for them, in order. "
      "Turn notes: outcome, AI calls, cost, tools, retries, fallbacks.")
    for c in convs:
        w("")
        w(f"### {c.id}")
        w("")
        w(f"Bucket {c.bucket} (classifier: {c.bucket_assigned}), source \"{c.source}\". Covers: {', '.join(c.covers)}.")
        w("")
        for t in c.turns:
            who = "Lead form" if t.trigger == "lead_created" else f"Customer {t.index}"
            w(f"**{who}:** {t.customer.removeprefix('(lead form) ')}  ")
            for r in t.replies:
                w(f"> **AI:** {r}  ")
            if not t.replies:
                w(f"> *(no reply: {t.no_reply_reason})*  ")
            notes = [f"outcome {t.outcome}", f"{len(t.calls)} AI call(s)",
                     _money(sum(x.cost_usd or 0 for x in t.calls), 5), _ms(t.ms)]
            if t.guard_retries:
                notes.append(f"{t.guard_retries} guard retr{'y' if t.guard_retries == 1 else 'ies'}")
            if t.fallback:
                notes.append(f"template fallback ({t.fallback_reason})")
            if t.tools:
                notes.append("tools: " + " | ".join(t.tools))
            if t.summary_runs:
                notes.append("summary updated")
            if t.after_hours:
                notes.append(f"after hours: {t.after_hours}")
            if t.flag_human:
                notes.append("flagged for staff")
            w(f"<sub>{'; '.join(notes)}</sub>")
            w("")

    md = base.with_suffix(".md")
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    calls_csv = Path(f"{base}_calls.csv")
    with calls_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["conversation", "bucket", "turn", "trigger", "step", "model", "input_tokens", "cached_tokens",
                         "output_tokens", "reasoning_tokens", "requests", "ms", "cost_usd", "ok"])
        for c in convs:
            for t in c.turns:
                for x in t.calls:
                    writer.writerow([c.id, c.bucket, t.index, t.trigger, x.step, x.model, x.input_tokens,
                                     x.cached_tokens, x.output_tokens, x.reasoning_tokens, x.requests, x.ms,
                                     x.cost_usd, x.ok])
    conv_csv = Path(f"{base}_conversations.csv")
    with conv_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        cols = ["customer_messages", "ai_replies", "model_calls", "tokens_in", "tokens_cached", "tokens_out",
                "tokens_reasoning", "cache_hit_pct", "cost_usd", "cost_per_reply", "turn_ms_p50", "turn_ms_p95",
                "guard_retries", "fallbacks", "stock_searches", "inventory_queries", "booking_calls", "summary_runs"]
        writer.writerow(["conversation", "bucket", "bucket_assigned", *cols, "grammar_score", "grammar_flags"])
        for c in convs:
            s = stats([c])
            writer.writerow([c.id, c.bucket, c.bucket_assigned, *[s[k] for k in cols],
                             (c.grammar or {}).get("score"), len((c.grammar or {}).get("issues") or [])])
    raw = Path(f"{base}.json")
    raw.write_text(json.dumps({"meta": {**meta, "started": meta["started"].isoformat()}, "overall": overall,
                               "by_bucket": by_bucket, "conversations": [asdict(c) for c in convs]},
                              indent=1, default=str), encoding="utf-8")
    return {"markdown": md, "calls_csv": calls_csv, "conversations_csv": conv_csv, "json": raw}


# --- CLI ---------------------------------------------------------------------------------------------

async def run(args: argparse.Namespace) -> int:
    get_settings.cache_clear()
    settings = get_settings()
    if args.prices:
        _PRICE_OVERRIDES.update({k: tuple(v) for k, v in json.loads(Path(args.prices).read_text()).items()})
    for model in {settings.model_extract, settings.model_compose}:
        if model.startswith("openai:") and not settings.openai_api_key:
            print(f"{model} needs OPENAI_API_KEY (agentic-upsell/.env).", file=sys.stderr)
            return 2
        if price_for(model) is None:
            print(f"warning: no price for {model}; costs show as n/a (pass --prices).", file=sys.stderr)
    _REASONING_EFFORT["value"] = args.reasoning_effort
    install()
    specs = [s for s in load_conversations(Path(args.conversations) if args.conversations else None)
             if not args.only or any(s["id"].startswith(p) for p in args.only)]
    meta: dict[str, Any] = {"started": datetime.now(UTC), "model_extract": settings.model_extract,
                            "model_compose": settings.model_compose, "budget_usd": args.budget,
                            "extract_timeout_s": settings.extract_timeout_s,
                            "compose_timeout_s": settings.compose_timeout_s,
                            "reasoning_effort": args.reasoning_effort}
    convs: list[Conversation] = []
    spent = 0.0
    for n, spec in enumerate(specs, start=1):
        if args.max_messages:
            spec = {**spec, "messages": spec["messages"][:args.max_messages]}
        print(f"[{n}/{len(specs)}] {spec['id']} ...", flush=True)
        try:
            conv = await run_conversation(spec)
        except Exception as exc:  # noqa: BLE001 - report it, keep the others
            conv = Conversation(id=spec["id"], bucket=spec["bucket"], source=spec["source"],
                                covers=spec.get("covers", []), error=f"{type(exc).__name__}: {exc}"[:300])
            print(f"   failed: {conv.error}", file=sys.stderr)
        convs.append(conv)
        s = stats([conv])
        spent += s["cost_usd"]
        print(f"   {s['ai_replies']} replies, {s['model_calls']} calls, {_money(s['cost_usd'])}, "
              f"cache {s['cache_hit_pct']}%, spent so far {_money(spent)}", flush=True)
        errors = [conv.error or ""] + [c.error or "" for t in conv.turns for c in t.calls]
        if any("AuthenticationError" in e or "status_code: 401" in e or "invalid_api_key" in e for e in errors):
            meta["stopped"] = "the OpenAI key was rejected (authentication error); not retried."
            break
        remaining = len(specs) - n
        projected = spent + (spent / n) * remaining
        if spent > args.budget or projected > args.budget:
            meta["stopped"] = (f"projected spend {_money(projected, 2)} passes the {_money(args.budget, 2)} budget "
                               f"after {n} conversation(s) ({_money(spent, 4)} spent).")
            break
    meta["grammar_method"] = grade(convs, args.grammar)
    meta["spent_usd"] = round(spent, 6)
    tag = args.tag or re.sub(r"[^A-Za-z0-9.-]+", "-", settings.model_compose)
    paths = write_report(convs, Path(args.out), tag, meta)
    o = stats(convs)
    print(f"\n{o['conversations']} conversations, {o['ai_replies']} replies, {o['model_calls']} AI calls: "
          f"{_money(o['cost_usd'])} total, {_money(o['cost_per_conversation'])} per conversation, "
          f"{_money(o['cost_per_reply'], 5)} per reply, cache hit {o['cache_hit_pct']}%")
    if meta.get("stopped"):
        print("STOPPED: " + meta["stopped"])
    for kind, path in paths.items():
        print(f"{kind}: {path}")
    clock.set_offset(0)
    return 1 if meta.get("stopped") else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run(_ARGS)))
