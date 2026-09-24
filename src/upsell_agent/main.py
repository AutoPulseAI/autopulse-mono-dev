"""FastAPI app entrypoint.

Run with: uvicorn upsell_agent.main:app --reload --port 8100
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from upsell_agent.api.routes import router as upsell_router
from upsell_agent.config import get_settings
from upsell_agent.integrations.mongodb import close_mongo, ensure_indexes, init_mongo
from upsell_agent.integrations.redis_client import close_redis, init_redis
from upsell_agent.memory.short_term import checkpointer_context
from upsell_agent.observability.tracing import init_tracing


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_tracing(settings)
    await init_mongo(settings)
    await ensure_indexes()
    await init_redis(settings)

    # The Redis-backed LangGraph checkpointer is a long-lived connection,
    # opened once for the process (not per request) via its own async context
    # manager — see memory/short_term.py. asetup() creates the RedisSearch
    # indexes it needs; idempotent, safe to call on every startup.
    async with checkpointer_context(settings) as checkpointer:
        await checkpointer.asetup()
        app.state.checkpointer = checkpointer
        yield

    await close_mongo()
    await close_redis()


app = FastAPI(
    title="AutoPulse Upsell Agent",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(upsell_router)
