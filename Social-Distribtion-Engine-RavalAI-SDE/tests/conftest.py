"""Pytest configuration and shared fixtures.

IMPORTANT: Environment variables MUST be set at module level (before any
app imports) so that lazy-initialized engines use the test database URL.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Generator

# Configure asyncio for tests
pytest_plugins = ("pytest_asyncio",)

# ─── Set test environment variables at MODULE LEVEL ──────────────────────
# These are set BEFORE any app code is imported, so lazy engines in
# app.database will use the test SQLite database, not the .env settings.
with tempfile.NamedTemporaryFile(suffix=".test.db", delete=False) as _db_file:
    _TEST_DB_FILE = _db_file.name
_TEST_DB_URL = f"sqlite+aiosqlite:///{_TEST_DB_FILE}"
_TEST_DB_URL_SYNC = f"sqlite:///{_TEST_DB_FILE}"

os.environ["ENV"] = "testing"
os.environ["LOG_LEVEL"] = "DEBUG"
os.environ["DATABASE_URL"] = _TEST_DB_URL
os.environ["DATABASE_URL_SYNC"] = _TEST_DB_URL_SYNC
os.environ["POSTGRES_PASSWORD"] = "test-postgres-password"
os.environ["REDIS_URL"] = "redis://localhost:6379/1"
os.environ["SDE_API_TOKEN"] = "test-token-min-16chars"
os.environ["SDE_SIGNING_SECRET"] = "test-signing-secret-32-bytes-long-req"
os.environ["FERNET_KEY"] = "CjDXFzZ5c5GzBo2kYN-GYlYDYfN9Z5c5GzBo2kYN-GY="


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create an instance of the default event loop for each test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session", autouse=True)
async def setup_db() -> AsyncGenerator[object, None]:
    """Create all tables in the test database (SQLite file) once per session."""
    # Use the global app engine (now points to test SQLite)
    from app.database import get_async_engine
    from app.models import Base

    engine = get_async_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    # Clean up tables after session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    with contextlib.suppress(OSError):
        os.unlink(_TEST_DB_FILE)


@pytest.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Create async database session for tests using the global test engine."""
    from app.database import get_async_session_maker

    maker = get_async_session_maker()
    async with maker() as session:
        yield session
        await session.rollback()


@pytest.fixture
async def db(db_session: AsyncSession) -> AsyncGenerator[AsyncSession, None]:
    """Alias for ``db_session`` matching the ``db`` fixture name tests request.

    Integration tests (``tests/integration/*``) were written against a ``db``
    fixture that the conftest did not provide; this alias keeps them working
    against the shared test SQLite database.
    """
    return db_session


@pytest.fixture
async def seed_test_accounts() -> AsyncGenerator[None, None]:
    """Seed the dryrun accounts integration tests publish against.

    ``tests/integration/test_publish_flow.py`` and ``test_idempotency.py``
    target ``test-account-1..3`` (platform ``dryrun``, default workspace).
    This fixture guarantees they exist in the shared test SQLite database.
    """
    from app.database import get_async_session_maker
    from app.models import Account
    from app.security import encrypt_token

    maker = get_async_session_maker()
    async with maker() as session:
        existing = set((await session.execute(select(Account.id))).scalars().all())
        now = datetime.now(UTC)
        for i in (1, 2, 3):
            acct_id = f"test-account-{i}"
            if acct_id in existing:
                continue
            session.add(
                Account(
                    id=acct_id,
                    workspace_id="workspace_001",
                    brand_id="brand_001",
                    platform="dryrun",
                    platform_account_id=f"platform-{i}",
                    platform_username=f"test_user_{i}",
                    encrypted_access_token=encrypt_token(f"test-token-{i}"),
                    status="active",
                    created_at=now,
                    updated_at=now,
                )
            )
        await session.commit()
    return


@pytest.fixture
async def async_client() -> AsyncGenerator[object, None]:
    """Create an async HTTP client for testing API endpoints.

    Uses the global app with test database. Database dependency is
    NOT overridden — the global get_db() will use the test SQLite database
    because env vars were set at module level before any import.
    """
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def mock_httpx_client() -> object:
    """Provide respx for mocking httpx requests."""
    try:
        import respx

        with respx.mock:
            yield respx
    except ImportError:
        pytest.skip("respx not installed")


@pytest.fixture(scope="session")
def celery_config() -> dict[str, object]:
    """Configure Celery for testing."""
    return {
        "broker_url": "redis://localhost:6379/1",
        "result_backend": "redis://localhost:6379/1",
        "task_always_eager": True,
        "task_eager_propagates": True,
        "worker_prefetch_multiplier": 1,
        "worker_max_tasks_per_child": 1,
    }


@pytest.fixture(scope="session", autouse=True)
def _no_broker_dispatch():
    """Stub the broker dispatch so the suite runs with NO Redis broker.

    Queue-first (T067): ``publish()`` dispatches each target via
    ``process_target.delay()``. In the test environment there is no broker or
    worker, so ``.delay()`` would try to connect to Redis (the compose host
    ``redis`` is unresolvable here) and hang/fail. Stubbing it to a no-op keeps
    publish() fast and deterministic; tests that need to observe the worker's
    output drive it explicitly via ``process_target.apply()`` (which always
    runs in-process and returns an EagerResult).

    This also removes the eager-mode ordering hazard: because ``.delay()`` is a
    no-op, the worker body never runs inline inside an async HTTP handler
    (where its internal ``asyncio.run()`` cannot execute).
    """
    from app.services import scheduler_tasks

    original = scheduler_tasks.process_target.delay
    scheduler_tasks.process_target.delay = lambda *args, **kwargs: None  # type: ignore[assignment]
    yield
    scheduler_tasks.process_target.delay = original  # type: ignore[assignment]
