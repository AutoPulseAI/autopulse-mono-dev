"""Shared fixtures: an in-memory MongoDB (mongomock-motor) wired into
integrations/mongodb.py, and settings built for DEV or production.

Unit tests always use the deterministic offline model (agent/offline_model.py):
no network, no key, same code path as a real model."""

import os

os.environ["MODEL_EXTRACT"] = "offline"
os.environ["MODEL_COMPOSE"] = "offline"
os.environ["LANGFUSE_PUBLIC_KEY"] = ""
os.environ["LANGFUSE_SECRET_KEY"] = ""

from datetime import UTC, datetime

import pytest
from mongomock_motor import AsyncMongoMockClient

from upsell_agent import clock
from upsell_agent.config import Settings
from upsell_agent.integrations import dealer_profile, mongodb
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
    clock.set_offset(0)
    dealer_profile.clear_cache()
    inventory_tool.clear_cache()
    yield
    clock.set_offset(0)
    dealer_profile.clear_cache()
    inventory_tool.clear_cache()


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
