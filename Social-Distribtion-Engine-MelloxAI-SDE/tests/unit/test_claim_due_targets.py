"""Regression tests for the beat-tick claim and per-target ownership.

Two defects these pin down:

* The tick claimed EVERY pending target, so a post scheduled for next week was
  published on the next 30-second tick, and an immediate publish was claimed by
  the tick while its own worker task was already publishing it (double post).
* ``process_target`` had no status guard: a redelivered or duplicate dispatch
  re-published an already-published target.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.database import get_sync_session_maker
from app.models import Account, DeliveryLog, Post, PostTarget
from app.security import encrypt_token
from app.services.scheduler_tasks import (
    LOST_DISPATCH_GRACE,
    claim_due_targets,
    claim_target_for_processing,
)

NOW = datetime(2030, 1, 1, 12, 0, tzinfo=UTC)


def _seed(
    session,
    *,
    workspace: str,
    scheduled_at: datetime | None,
    status: str = "pending",
    created_at: datetime = NOW,
    next_attempt_at: datetime | None = None,
) -> str:
    account_id = f"acct-{uuid.uuid4()}"
    session.add(
        Account(
            id=account_id,
            workspace_id=workspace,
            brand_id="brand",
            platform="dryrun",
            platform_account_id="p",
            platform_username="u",
            encrypted_access_token=encrypt_token("t"),
            status="active",
            created_at=NOW,
            updated_at=NOW,
        )
    )
    post_id = str(uuid.uuid4())
    session.add(
        Post(
            id=post_id,
            workspace_id=workspace,
            brand_id="brand",
            idempotency_key=f"idem-{post_id}",
            status="pending",
            scheduled_at=scheduled_at,
            created_at=created_at,
            updated_at=created_at,
        )
    )
    target_id = str(uuid.uuid4())
    session.add(
        PostTarget(
            id=target_id,
            post_id=post_id,
            account_id=account_id,
            status=status,
            content={"text": "hi"},
            attempts=0,
            max_attempts=5,
            next_attempt_at=next_attempt_at,
            created_at=created_at,
            updated_at=created_at,
        )
    )
    session.commit()
    return target_id


@pytest.fixture
def session():
    maker = get_sync_session_maker()
    with maker() as s:
        # Isolate from targets other tests left pending in the shared DB.
        s.query(PostTarget).filter(PostTarget.status.in_(("pending", "retrying"))).update(
            {"status": "cancelled"}, synchronize_session=False
        )
        s.commit()
        yield s


def test_future_scheduled_target_is_not_claimed(session):
    future = _seed(session, workspace="ws-a", scheduled_at=NOW + timedelta(days=7))
    claimed = claim_due_targets(session, NOW, 100)
    session.commit()
    assert future not in claimed
    assert session.get(PostTarget, future).status == "pending"


def test_due_scheduled_target_is_claimed_with_workspace_on_the_log(session):
    due = _seed(session, workspace="ws-due", scheduled_at=NOW - timedelta(minutes=1))
    claimed = claim_due_targets(session, NOW, 100)
    session.commit()
    assert claimed == [due]
    target = session.get(PostTarget, due)
    assert target.status == "publishing"
    assert target.attempts == 1
    log = session.execute(
        select(DeliveryLog).where(DeliveryLog.post_target_id == due)
    ).scalar_one()
    assert log.workspace_id == "ws-due"  # was "" before


def test_fresh_immediate_publish_is_left_to_its_own_dispatch(session):
    fresh = _seed(session, workspace="ws-a", scheduled_at=None, created_at=NOW - timedelta(seconds=10))
    assert fresh not in claim_due_targets(session, NOW, 100)


def test_lost_immediate_dispatch_is_recovered_after_the_grace_period(session):
    lost = _seed(
        session,
        workspace="ws-a",
        scheduled_at=None,
        created_at=NOW - LOST_DISPATCH_GRACE - timedelta(seconds=1),
    )
    assert lost in claim_due_targets(session, NOW, 100)


def test_retrying_target_is_claimed_only_when_its_backoff_elapsed(session):
    waiting = _seed(
        session,
        workspace="ws-a",
        scheduled_at=None,
        status="retrying",
        next_attempt_at=NOW + timedelta(minutes=5),
    )
    ready = _seed(
        session,
        workspace="ws-a",
        scheduled_at=None,
        status="retrying",
        next_attempt_at=NOW - timedelta(seconds=1),
    )
    claimed = claim_due_targets(session, NOW, 100)
    assert ready in claimed
    assert waiting not in claimed


def test_terminal_target_is_never_processed_again(session):
    done = _seed(session, workspace="ws-a", scheduled_at=None, status="published")
    assert claim_target_for_processing(session, done, NOW) is False
    assert session.get(PostTarget, done).attempts == 0


def test_immediate_dispatch_takes_ownership_once(session):
    target = _seed(session, workspace="ws-a", scheduled_at=None)
    assert claim_target_for_processing(session, target, NOW) is True
    session.expire_all()
    assert session.get(PostTarget, target).status == "publishing"
    # A second dispatch of the same target (tick/redelivery) still proceeds on
    # `publishing`, but a finished one does not.
    session.get(PostTarget, target).status = "published"
    session.commit()
    assert claim_target_for_processing(session, target, NOW) is False
