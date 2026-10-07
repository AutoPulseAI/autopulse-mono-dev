"""Langfuse tracing (architecture §13, MASTER_PLAN_1 Stage 8): one trace per
turn, with every Pydantic AI model call (Extract, Compose) recorded inside it
through Pydantic AI's OpenTelemetry instrumentation. The trace id is stored
on the turn's ai_turn_log record.

Off unless LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set: without keys
turn_trace() yields None and nothing is sent anywhere. The Debug UI's own
trace (observability/trace.py) works either way.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from upsell_agent.config import Settings

logger = logging.getLogger(__name__)

_client: Any = None


def init_tracing(settings: Settings) -> bool:
    """Starts Langfuse if configured. Returns whether tracing is on."""
    global _client
    if not settings.langfuse_public_key or not settings.langfuse_secret_key:
        return False
    try:
        from langfuse import Langfuse
        from pydantic_ai import Agent

        _client = Langfuse(public_key=settings.langfuse_public_key, secret_key=settings.langfuse_secret_key,
                           host=settings.langfuse_host)
        Agent.instrument_all()  # model calls become spans in the current trace
        logger.info("Langfuse tracing on (%s)", settings.langfuse_host)
        return True
    except Exception:
        logger.exception("Langfuse could not start; continuing without it")
        _client = None
        return False


def shutdown_tracing() -> None:
    if _client is not None:
        try:
            _client.flush()
        except Exception:
            logger.exception("Langfuse flush failed")


@asynccontextmanager
async def turn_trace(turn_id: str, **metadata: Any) -> AsyncIterator[str | None]:
    """Wraps one turn in a Langfuse trace; yields its id, or None when off."""
    if _client is None:
        yield None
        return
    try:
        span_cm = _client.start_as_current_observation(name="turn", as_type="agent",
                                                        metadata={"turn_id": turn_id, **metadata})
        span_cm.__enter__()
    except Exception:
        logger.exception("could not start a Langfuse trace")
        yield None
        return
    try:
        yield _client.get_current_trace_id()
    finally:
        try:
            span_cm.__exit__(None, None, None)
        except Exception:
            logger.exception("could not close the Langfuse trace")
