"""Shared fixtures: an in-memory MongoDB (mongomock-motor) wired into
integrations/mongodb.py, and settings built for DEV or production.

Unit tests always use the deterministic offline model (agent/offline_model.py):
no network, no key, same code path as a real model."""

import os

os.environ["MODEL_EXTRACT"] = "offline"
os.environ["MODEL_COMPOSE"] = "offline"
os.environ["LANGFUSE_PUBLIC_KEY"] = ""
os.environ["LANGFUSE_SECRET_KEY"] = ""
# PLAN_4 stream L: the morning / afternoon send-time test moves cadence touches off the fixed 10:00 that the
# schedule tests check; tests of the test itself turn it on (tests/unit/test_learning.py).
os.environ["SEND_TIME_AB"] = "false"

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from mongomock_motor import AsyncMongoMockClient

from upsell_agent import clock
from upsell_agent.config import Settings
from upsell_agent.integrations import dealer_profile, mongodb
from upsell_agent.learning import optimizer
from upsell_agent.tools import inventory_tool


@pytest.fixture
def mongo():
    db = AsyncMongoMockClient()["unit_tests"]
    previous = mongodb._db
    mongodb.set_db_for_tests(db)
    yield db
    mongodb.set_db_for_tests(previous)


@pytest.fixture(autouse=True)
def reset_clock():
    # The eval harness pins every customer to New York (evals/harness.py); a
    # run with both suites mustn't carry that into the unit tests.
    from upsell_agent.compliance import customer_zone, engine

    engine.customer_zone = customer_zone.customer_zone
    clock.set_offset(0)
    dealer_profile.clear_cache()
    inventory_tool.clear_cache()
    optimizer.clear_cache()
    yield
    clock.set_offset(0)
    dealer_profile.clear_cache()
    inventory_tool.clear_cache()


@pytest.fixture
def during_opening_hours():
    """Inside the dev dealers' opening hours, whenever the suite runs. A new
    inbound lead while the dealer is closed gets the after-hours choice
    (MASTER_PLAN_3 B1), which tests about the normal first reply don't expect."""
    set_clock(_last_weekday_noon())


@pytest.fixture
def ny_customer(monkeypatch):
    """The customer lives in New York, like the dev dealer. Dev customers have
    555 phones and no DealerVault address, so the send check would otherwise
    use only the hours legal in every continental zone (MASTER_PLAN_3 B0.5)."""
    from upsell_agent.compliance import engine
    from upsell_agent.compliance.customer_zone import CustomerZone

    async def fixed(_db, _customer_id, _phone):
        return CustomerZone(("America/New_York",), "zip", "ZIP 10001 (test)", "NY")

    monkeypatch.setattr(engine, "customer_zone", fixed)


def _last_weekday_noon() -> datetime:
    """The most recent Tuesday 12:00 New York time: open for the dev dealers and
    inside every US customer window."""
    ny = ZoneInfo("America/New_York")
    local = datetime.now(UTC).astimezone(ny)
    day = local.date() - timedelta(days=(local.weekday() - 1) % 7)
    at = datetime.combine(day, time(12), tzinfo=ny)
    return at if at <= local else at - timedelta(days=7)


def set_clock(at: datetime) -> None:
    """Make clock.now() read `at` (then move on in real time)."""
    clock.set_offset((at - datetime.now(UTC)).total_seconds())


def make_settings(environment: str) -> Settings:
    return Settings(
        ENVIRONMENT=environment,
        MONGODB_URI="mongodb://localhost:27017/unit_tests",
        REDIS_URL="redis://localhost:6379/15",
        UPSELL_SERVICE_SHARED_SECRET="test-secret",
        MODEL_EXTRACT="offline",
        MODEL_COMPOSE="offline",
    )


@pytest.fixture
def legacy_switch(monkeypatch):
    """The Day 1-90 cadence off (CADENCE_ENABLED=false): a lead gets Plan 1's single 24h switch to the other
    channel instead. For the tests of that machinery, which still serves a lead with no cadence (MASTER_PLAN_3
    C4, decision 153)."""
    from upsell_agent.agent import lifecycle
    monkeypatch.setattr(lifecycle, "cadence_enabled", lambda: False)
