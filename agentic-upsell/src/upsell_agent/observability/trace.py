"""Per-turn trace: what every pipeline step received, why it decided what it
did, and what it produced (MASTER_PLAN_1 Stage 3.3).

One TurnTracer per turn. It
  - emits live events to a sink (Redis pub/sub in DEV, feeding the Debug UI's
    server-sent-event stream; nothing in production),
  - builds the ai_turn_log document, including the same events so any past
    turn can be replayed with the same animation.

Full prompts are kept only when `store_prompts` is on (DEV only).
"""

import json
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Protocol

from upsell_agent import clock

DEV_TRACE_CHANNEL = "dev:trace"
# A turn has ~10 nodes x 2 events; this only stops a runaway loop from
# producing an unbounded document.
MAX_EVENTS_PER_TURN = 400


class TraceSink(Protocol):
    async def emit(self, event: dict[str, Any]) -> None: ...


class NullTraceSink:
    async def emit(self, event: dict[str, Any]) -> None:
        return None


class MemoryTraceSink:
    """For tests: keeps every event in a list."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def emit(self, event: dict[str, Any]) -> None:
        self.events.append(event)


class RedisTraceSink:
    def __init__(self, client) -> None:
        self._client = client

    async def emit(self, event: dict[str, Any]) -> None:
        await self._client.publish(DEV_TRACE_CHANNEL, json.dumps(event, default=str))


def _strip_prompts(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip_prompts(v) for k, v in value.items() if k != "prompt"}
    if isinstance(value, list):
        return [_strip_prompts(v) for v in value]
    return value


class NodeSpan:
    """Filled in by the node while it runs; read by the tracer when it ends."""

    def __init__(self) -> None:
        self.output: Any = None
        self.reasoning: Any = None
        self.metrics: dict[str, Any] = {}
        self.edge_label: str | None = None


class TurnTracer:
    def __init__(
        self,
        *,
        sink: TraceSink,
        dealer_id: str,
        lead_id: str | None,
        customer_id: str,
        trigger: str,
        channel: str | None,
        store_prompts: bool,
        turn_id: str | None = None,
    ) -> None:
        self.turn_id = turn_id or uuid.uuid4().hex
        self._sink = sink
        self._store_prompts = store_prompts
        self._seq = 0
        self._started = time.perf_counter()
        self._attempts: dict[str, int] = {}
        self.log: dict[str, Any] = {
            "turn_id": self.turn_id,
            "dealer_id": dealer_id,
            "lead_id": lead_id,
            "customer_id": customer_id,
            "trigger": trigger,
            "channel": channel,
            "created_at": clock.now(),
            "nodes": [],
            "events": [],
            "outcome": None,
        }

    def _clean(self, value: Any) -> Any:
        return value if self._store_prompts else _strip_prompts(value)

    async def _emit(self, event_type: str, node: str | None = None, **data: Any) -> None:
        self._seq += 1
        event = {
            "type": event_type,
            "seq": self._seq,
            "ts": clock.now().isoformat(),
            "turn_id": self.turn_id,
            "dealer_id": self.log["dealer_id"],
            "lead_id": self.log["lead_id"],
            "node": node,
            "data": self._clean(data),
        }
        if len(self.log["events"]) < MAX_EVENTS_PER_TURN:
            self.log["events"].append(event)
        await self._sink.emit(event)

    async def start(self, input: dict[str, Any]) -> None:
        self.log["input"] = self._clean(input)
        await self._emit("turn_started", trigger=self.log["trigger"], channel=self.log["channel"], input=input)

    @asynccontextmanager
    async def node(self, name: str, input: Any) -> AsyncIterator[NodeSpan]:
        attempt = self._attempts.get(name, 0) + 1
        self._attempts[name] = attempt
        span = NodeSpan()
        started_at = clock.now()
        t0 = time.perf_counter()
        await self._emit("node_started", name, attempt=attempt, input=input)
        try:
            yield span
        except Exception as exc:
            ms = round((time.perf_counter() - t0) * 1000)
            self.log["nodes"].append(
                {"node": name, "attempt": attempt, "status": "failed", "started_at": started_at, "ms": ms,
                 "input": self._clean(input), "error": repr(exc)}
            )
            await self._emit("node_failed", name, attempt=attempt, error=repr(exc), ms=ms)
            raise
        ms = round((time.perf_counter() - t0) * 1000)
        self.log["nodes"].append(
            {"node": name, "attempt": attempt, "status": "done", "started_at": started_at, "ms": ms,
             "input": self._clean(input), "output": self._clean(span.output),
             "reasoning": span.reasoning, "metrics": span.metrics}
        )
        await self._emit(
            "node_finished", name, attempt=attempt, output=span.output, reasoning=span.reasoning,
            metrics={**span.metrics, "ms": ms}, edge_label=span.edge_label,
        )

    async def retry(self, node: str, target: str, reason: str, attempt: int) -> None:
        await self._emit("node_retry", node, target=target, reason=reason, attempt=attempt)

    async def skipped(self, node: str, reason: str) -> None:
        self.log["nodes"].append({"node": node, "status": "skipped", "reason": reason})
        await self._emit("node_skipped", node, reason=reason)

    async def finish(self, outcome: str, summary: dict[str, Any] | None = None) -> dict[str, Any]:
        self.log["outcome"] = outcome
        self.log["summary"] = summary or {}
        self.log["ms"] = round((time.perf_counter() - self._started) * 1000)
        await self._emit("turn_finished", outcome=outcome, summary=summary or {}, ms=self.log["ms"])
        return self.log
