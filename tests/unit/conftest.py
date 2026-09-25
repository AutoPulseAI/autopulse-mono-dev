"""Shared fixtures: an in-memory MongoDB (mongomock-motor) wired into
integrations/mongodb.py, and settings built for DEV or production.

Unit tests always use the deterministic offline model (agent/offline_model.py):
no network, no key, same code path as a real model."""

import os

os.environ["MODEL_EXTRACT"] = "offline"
os.environ["MODEL_COMPOSE"] = "offline"
os.environ["LANGFUSE_PUBLIC_KEY"] = ""
os.environ["LANGFUSE_SECRET_KEY"] = ""

import pytest
from mongomock_motor import AsyncMongoMockClient

from upsell_agent import clock
from upsell_agent.config import Settings
from upsell_agent.integrations import mongodb


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
    yield
    clock.set_offset(0)


def make_settings(environment: str) -> Settings:
    return Settings(
        ENVIRONMENT=environment,
        MONGODB_URI="mongodb://localhost:27017/unit_tests",
        REDIS_URL="redis://localhost:6379/15",
        UPSELL_SERVICE_SHARED_SECRET="test-secret",
        MODEL_EXTRACT="offline",
        MODEL_COMPOSE="offline",
    )
