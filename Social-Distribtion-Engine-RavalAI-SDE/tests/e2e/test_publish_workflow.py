"""End-to-end test for the publish workflow using SQLite.

This is a standalone test that doesn't depend on pytest-asyncio fixtures.
It creates the database tables, runs tests, and cleans up.
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

# Set test environment BEFORE any app imports
with tempfile.NamedTemporaryFile(suffix=".test.db", delete=False) as _db_file:
    _TEST_DB = _db_file.name
os.environ["ENV"] = "testing"
os.environ["LOG_LEVEL"] = "DEBUG"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["DATABASE_URL_SYNC"] = f"sqlite:///{_TEST_DB}"
os.environ["SDE_API_TOKEN"] = "test-token-min-16chars"
os.environ["SDE_SIGNING_SECRET"] = "test-signing-secret-32-bytes-long-req"
os.environ["FERNET_KEY"] = "CjDXFzZ5c5GzBo2kYN-GYlYDYfN9Z5c5GzBo2kYN-GY="

# Now import app modules (will use test env vars)
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
import contextlib

from fastapi.testclient import TestClient

from app.database import get_async_engine
from app.main import app
from app.models import Base

TOKEN = "Bearer test-token-min-16chars"
client = TestClient(app)


def setup_db():
    """Create all database tables."""
    engine = get_async_engine()

    async def _create():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_create())


def seed_data():
    """Seed test accounts into the database."""
    from cryptography.fernet import Fernet

    from app.database import get_async_session_maker
    from app.models import Account

    key = os.environ["FERNET_KEY"]
    cipher = Fernet(key.encode())
    dummy_token = cipher.encrypt(b"test_access_token")

    async def _seed():
        maker = get_async_session_maker()
        async with maker() as session:
            # Create test accounts for each platform
            for i, (acct_id, platform) in enumerate(
                [
                    ("acc-1", "dryrun"),
                    ("acc-2", "dryrun"),
                    ("acc-3", "dryrun"),
                    ("a1", "dryrun"),
                    ("a2", "dryrun"),
                    ("a3", "dryrun"),
                    ("a", "dryrun"),
                ]
            ):
                session.add(
                    Account(
                        id=acct_id,
                        workspace_id="workspace_001",
                        brand_id="brand_001",
                        platform=platform,
                        platform_account_id=f"platform_{i}",
                        platform_username=f"test_user_{acct_id}",
                        encrypted_access_token=dummy_token,
                        status="active",
                    )
                )
            await session.commit()

    asyncio.run(_seed())


def teardown_db():
    """Drop all tables and clean up."""
    try:
        engine = get_async_engine()

        async def _drop():
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
            await engine.dispose()

        asyncio.run(_drop())
    except Exception:
        pass
    with contextlib.suppress(OSError):
        os.unlink(_TEST_DB)


def run_tests():
    """Run all end-to-end tests."""
    results = []

    def check(name, ok, detail=""):
        status = "✓" if ok else "✗"
        print(f"  {status} {name} {detail}".strip())
        results.append(ok)

    print("=" * 50)
    print("E2E Tests - Publish Workflow")
    print("=" * 50)

    # 1. Health check
    r = client.get("/healthz")
    check("Health endpoint", r.status_code == 200)

    # 2. Immediate publish - happy path
    r = client.post(
        "/api/v1/publish",
        json={
            "idempotency_key": "e2e-001",
            "scheduled_at": None,
            "targets": [{"account_id": "acc-1", "content": {"text": "Hello world!"}}],
        },
        headers={"Authorization": TOKEN},
    )
    ok = r.status_code == 201
    data = r.json() if ok else {}
    check("Publish immediate", ok, f"({r.status_code})" if not ok else "")
    job_id = data.get("job_id", "")

    # 3. Job status
    r = client.get(f"/api/v1/jobs/{job_id}", headers={"Authorization": TOKEN})
    check("Get job status", r.status_code == 200 and r.json().get("status") == "published")

    # 4. Idempotency - same key = same job
    r2 = client.post(
        "/api/v1/publish",
        json={
            "idempotency_key": "e2e-001",
            "targets": [{"account_id": "acc-1", "content": {"text": "Hello world!"}}],
        },
        headers={"Authorization": TOKEN},
    )
    check("Idempotency", r2.status_code == 201 and r2.json().get("job_id") == job_id)

    # 5. List jobs
    r = client.get("/api/v1/jobs", headers={"Authorization": TOKEN})
    check("List jobs", r.status_code == 200 and len(r.json()) >= 1)

    # 6. Auth rejection (no token)
    r = client.post(
        "/api/v1/publish",
        json={
            "idempotency_key": "no-auth",
            "targets": [{"account_id": "a", "content": {"text": "x"}}],
        },
    )
    check("Auth rejection", r.status_code == 401)

    # 7. Validation rejection (empty targets)
    r = client.post(
        "/api/v1/publish",
        json={"idempotency_key": "bad", "targets": []},
        headers={"Authorization": TOKEN},
    )
    check("Validation rejection", r.status_code == 422)

    # 8. Rate limit injection (FORCE_429)
    r = client.post(
        "/api/v1/publish",
        json={
            "idempotency_key": "e2e-429",
            "targets": [{"account_id": "a", "content": {"text": "FORCE_429"}}],
        },
        headers={"Authorization": TOKEN},
    )
    t = r.json().get("targets", [{}])[0] if r.status_code == 201 else {}
    check("Rate limit injection", t.get("error_category") == "rate_limit")

    # 9. Auth error injection (FORCE_401)
    r = client.post(
        "/api/v1/publish",
        json={
            "idempotency_key": "e2e-401",
            "targets": [{"account_id": "a", "content": {"text": "FORCE_401"}}],
        },
        headers={"Authorization": TOKEN},
    )
    t = r.json().get("targets", [{}])[0] if r.status_code == 201 else {}
    check("Auth error injection", t.get("error_category") == "auth")

    # 10. Server error injection (FORCE_500)
    r = client.post(
        "/api/v1/publish",
        json={
            "idempotency_key": "e2e-500",
            "targets": [{"account_id": "a", "content": {"text": "FORCE_500"}}],
        },
        headers={"Authorization": TOKEN},
    )
    t = r.json().get("targets", [{}])[0] if r.status_code == 201 else {}
    check("Server error injection", t.get("error_category") == "transient")

    # 11. Schedule post
    future = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    r = client.post(
        "/api/v1/schedule",
        json={
            "idempotency_key": "e2e-sched",
            "scheduled_at": future,
            "targets": [{"account_id": "a", "content": {"text": "Future post"}}],
        },
        headers={"Authorization": TOKEN},
    )
    check("Schedule post", r.status_code == 201 and r.json().get("status") == "pending")
    sched_id = r.json().get("job_id", "")

    # 12. Cancel scheduled post
    r = client.delete(f"/api/v1/jobs/{sched_id}", headers={"Authorization": TOKEN})
    check("Cancel job", r.status_code == 204)

    # 13. Multi-target publish
    r = client.post(
        "/api/v1/publish",
        json={
            "idempotency_key": "e2e-multi",
            "targets": [
                {"account_id": "a1", "content": {"text": "Platform 1"}},
                {"account_id": "a2", "content": {"text": "Platform 2"}},
                {"account_id": "a3", "content": {"text": "Platform 3"}},
            ],
        },
        headers={"Authorization": TOKEN},
    )
    targets = r.json().get("targets", []) if r.status_code == 201 else []
    check("Multi-target publish", len(targets) == 3)

    # Summary
    passed = sum(results)
    total = len(results)
    print()
    print(f"Results: {passed}/{total} passed ({passed / total * 100:.0f}%)")
    if passed == total:
        print("✓ ALL TESTS PASSED")
    else:
        print(f"✗ {total - passed} TESTS FAILED")

    return passed == total


if __name__ == "__main__":
    try:
        setup_db()
        print("Database tables created")
        seed_data()
        print("Test accounts seeded")
        success = run_tests()
    finally:
        teardown_db()
        print("Database cleaned up")

    sys.exit(0 if success else 1)
