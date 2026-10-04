"""API process entrypoint (architecture §2).

Run with: uvicorn upsell_agent.main:app --port 8100

The API only accepts events, drops duplicates and queues jobs. It never calls
a model or sends a message; the worker does (worker/main.py).

The /dev/* routes are registered only when ENVIRONMENT=DEV.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from upsell_agent import clock
from upsell_agent.api.call_tasks import router as call_tasks_router
from upsell_agent.api.customers import router as customers_router
from upsell_agent.api.events import router as events_router
from upsell_agent.api.insights import router as insights_router
from upsell_agent.api.leads import router as leads_router
from upsell_agent.api.metrics import router as metrics_router
from upsell_agent.api.service_vehicles import router as service_vehicles_router
from upsell_agent.api.staff_view import router as staff_view_router
from upsell_agent.api.webhooks import router as webhooks_router
from upsell_agent.config import Settings, get_settings
from upsell_agent.integrations.mongodb import close_mongo, ensure_indexes, get_db, init_mongo
from upsell_agent.integrations.platform_client import get_platform_client
from upsell_agent.integrations.redis_client import close_redis, get_redis, init_redis
from upsell_agent.worker.queue import make_enqueue, make_queue

# Vite's dev server, when the Debug UI is run outside Docker without its proxy.
DEBUG_UI_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def create_app(settings: Settings | None = None, *, connect: bool = True) -> FastAPI:
    """`connect=False` skips MongoDB/Redis/queue setup, for tests that inject
    their own fakes into app.state."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if not connect:
            yield
            return
        await init_mongo(settings)
        await ensure_indexes()
        await init_redis(settings)
        queue = make_queue(settings)
        await queue.connect()
        app.state.queue = queue
        app.state.enqueue = make_enqueue(queue)
        try:
            yield
        finally:
            await queue.disconnect()
            await close_mongo()
            await close_redis()

    app = FastAPI(title="AutoPulse AI Service", version="0.2.0", lifespan=lifespan)
    app.state.settings = settings
    # Delivery webhooks forward statuses to the platform's conversation screen.
    app.state.platform = get_platform_client(settings)

    @app.get("/health")
    async def health() -> dict:
        checks = {}
        if connect:
            checks["mongo"] = bool(await get_db().command("ping"))
            checks["redis"] = bool(await get_redis().ping())
        return {"status": "ok", "environment": "DEV" if settings.is_dev else "PROD", **checks}

    app.include_router(events_router)
    app.include_router(leads_router)
    app.include_router(call_tasks_router)
    app.include_router(staff_view_router)
    app.include_router(customers_router)  # MASTER_PLAN_4 D3 (stream A3)
    app.include_router(metrics_router)
    app.include_router(webhooks_router)
    app.include_router(service_vehicles_router)  # MASTER_PLAN_4 D5/D6 (stream A4)
    app.include_router(insights_router)  # PLAN_4 stream L

    if settings.is_dev:
        from upsell_agent.api.dev import router as dev_router

        app.include_router(dev_router)

        @app.middleware("http")
        async def sync_dev_clock(request, call_next):
            # The Debug UI or a scenario may have moved the dev clock from
            # another process; every request here sees the current value.
            if connect:
                await clock.sync(get_redis())
            return await call_next(request)
        app.add_middleware(CORSMiddleware, allow_origins=DEBUG_UI_ORIGINS, allow_methods=["*"], allow_headers=["*"])

    return app


app = create_app()
