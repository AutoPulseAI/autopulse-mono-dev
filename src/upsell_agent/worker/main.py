"""Worker process entrypoint (architecture §2).

Run with:  saq upsell_agent.worker.main.settings

Scale by running more of these; each one is stateless apart from MongoDB and Redis.
"""

import asyncio
import logging
from typing import Any

from saq import CronJob

from upsell_agent import clock
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels import get_channel_driver
from upsell_agent.channels.sender import Sender
from upsell_agent.compliance import send_checks
from upsell_agent.config import Settings, get_settings
from upsell_agent.integrations.mongodb import close_mongo, ensure_indexes, init_mongo
from upsell_agent.integrations.platform_client import get_platform_client
from upsell_agent.integrations.redis_client import close_redis, get_redis, init_redis
from upsell_agent.observability.trace import NullTraceSink, RedisTraceSink
from upsell_agent.observability.tracing import init_tracing, shutdown_tracing
from upsell_agent.scheduler.followups import worker_id
from upsell_agent.worker.jobs import (
    FUNCTIONS,
    close_expired_leads,
    fire_due_followups,
    sweep_maintenance,
    sweep_recalls,
    plan_birthdays,
)
from upsell_agent.worker.queue import make_enqueue, make_queue

logger = logging.getLogger(__name__)

def build_turn_deps(settings: Settings) -> TurnDeps:
    platform = get_platform_client(settings)
    sender = Sender(
        get_channel_driver(settings),
        platform,
        max_attempts=settings.send_max_attempts,
        retry_base_s=settings.send_retry_base_s,
    )
    return TurnDeps(
        # Live trace events exist only in DEV (MASTER_PLAN_1 Stage 3.2).
        sink=RedisTraceSink(get_redis()) if settings.is_dev else NullTraceSink(),
        store_prompts=settings.is_dev,
        sender=sender,
        platform=platform,
        settings=settings,
    )


async def startup(ctx: dict[str, Any]) -> None:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    await init_mongo(settings)
    await ensure_indexes()
    await init_redis(settings)
    init_tracing(settings)
    ctx["redis"] = get_redis()
    ctx["deps"] = build_turn_deps(settings)
    # Turns queue follow-up work (the rolling summary) on this worker's own queue.
    ctx["deps"].enqueue = make_enqueue(ctx["worker"].queue)
    # Answers the platform campaign worker's send-check requests every 2s
    # (MASTER_PLAN_3 decision 66): faster than a per-minute cron, so a
    # campaign isn't slowed down by waiting for its answers.
    ctx["send_checks"] = asyncio.create_task(send_checks.run_forever(worker_id()))
    logger.info(
        "worker started (environment=%s, dev=%s, channel_driver=%s, platform_client=%s, first_reply=%s, "
        "models=%s/%s)",
        settings.environment, settings.is_dev, settings.channel_driver, settings.platform_client,
        settings.first_reply_mode, settings.model_extract, settings.model_compose,
    )


async def shutdown(ctx: dict[str, Any]) -> None:
    if task := ctx.get("send_checks"):
        task.cancel()
    shutdown_tracing()
    await close_mongo()
    await close_redis()


async def before_process(ctx: dict[str, Any]) -> None:
    # Pick up any clock moves made from the Debug UI (DEV only).
    if get_settings().is_dev:
        await clock.sync(get_redis())


def settings() -> dict[str, Any]:
    app_settings = get_settings()
    return {
        "queue": make_queue(app_settings),
        "functions": FUNCTIONS,
        # The 24h channel switch checks for due follow-ups every minute
        # (architecture §6). SAQ runs one per tick across all workers; the
        # atomic claim makes an overlap harmless anyway.
        # MASTER_PLAN_3 C3: the Day 91 sweep closes expired leads, hourly.
        "cron_jobs": [CronJob(fire_due_followups, cron="* * * * *", timeout=300),
                      CronJob(close_expired_leads, cron="7 * * * *", timeout=600),
                      # MASTER_PLAN_4 D5/D6 (stream A4): recall and maintenance monitors, hourly.
                      CronJob(sweep_recalls, cron="23 * * * *", timeout=900),
                      CronJob(sweep_maintenance, cron="41 * * * *", timeout=900),
                      # MASTER_PLAN_4 D7 (stream A3): birthdays whose DealerVault date arrived late, daily.
                      CronJob(plan_birthdays, cron="17 6 * * *", timeout=600)],
        # SAQ's sweep re-delivers a job it moved to "active" but never started
        # (seen twice in 300 during the Stage 12 burst test: a reply waited
        # 30-40s). Every 10s instead of 60s bounds that wait; a re-delivered
        # turn reuses its turn id, so it can never message anyone twice
        # (events/handlers.py).
        "timers": {"sweep": 10},
        "concurrency": app_settings.worker_concurrency,
        "startup": startup,
        "shutdown": shutdown,
        "before_process": before_process,
    }
