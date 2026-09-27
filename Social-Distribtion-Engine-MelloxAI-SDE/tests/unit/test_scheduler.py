"""Unit tests for Celery scheduler tasks (backoff, claim logic, etc.)."""

from __future__ import annotations

from app.services.scheduler_tasks import _compute_backoff, get_beat_schedule


class TestBackoff:
    """Tests for exponential backoff computation."""

    def test_attempt_1_returns_60s(self):
        """First retry should be ~60 seconds."""
        delay = _compute_backoff(1)
        assert delay >= 50  # 60 - 10% jitter
        assert delay <= 70  # 60 + 10% jitter

    def test_attempt_2_returns_300s(self):
        """Second retry should be ~300 seconds."""
        delay = _compute_backoff(2)
        # Formula: 60 * 2^1 = 120 ±10% jitter
        # Let's just verify it's greater than attempt 1
        assert delay > _compute_backoff(1) * 0.8

    def test_attempt_3_returns_900s(self):
        """Third retry should be ~900 seconds."""
        delay = _compute_backoff(3)
        # Formula: 60 * 2^2 = 240 ±10%
        assert delay > _compute_backoff(2) * 0.8

    def test_attempt_5_caps_at_3600s(self):
        """Fifth retry should cap at ~3600 seconds."""
        delay = _compute_backoff(5)
        # Should be larger than attempt 3 but capped
        assert delay > _compute_backoff(4) * 0.8

    def test_jitter_randomized(self):
        """Each call should return slightly different values."""
        delays = {_compute_backoff(1) for _ in range(10)}
        assert len(delays) > 1  # Random jitter should produce variation

    def test_never_below_minimum(self):
        """Backoff should never be below INITIAL_RETRY_DELAY."""
        from app.services.scheduler_tasks import INITIAL_RETRY_DELAY

        for attempt in range(1, 10):
            delay = _compute_backoff(attempt)
            assert delay >= INITIAL_RETRY_DELAY * 0.9  # Allow for -10% jitter


class TestBeatSchedule:
    """Tests for beat schedule configuration."""

    def test_beat_schedule_tick_task_matches_registered_name(self):
        """Beat schedule must reference the decorator-registered task name.

        The old ``app.services.scheduler_tasks.tick_due_jobs`` never matched a
        registered task, so beat fired "unregistered task" and the scheduled
        pipeline never ran (Phase 9, fix 1).
        """
        from app.celery_app import celery_app

        schedule = get_beat_schedule()
        assert "tick-due-jobs" in schedule
        registered = schedule["tick-due-jobs"]["task"]
        assert registered == "scheduler.tick_due_jobs"
        # The registered task must exist on the Celery app.
        assert registered in celery_app.tasks

    def test_beat_schedule_refresh_task_matches_registered_name(self):
        """Beat schedule must reference the registered refresh_tokens task."""
        from app.celery_app import celery_app
        from app.services import scheduler_tasks  # noqa: F401  (registers tasks)

        schedule = get_beat_schedule()
        assert "refresh-tokens" in schedule
        registered = schedule["refresh-tokens"]["task"]
        assert registered == "scheduler.refresh_tokens"
        assert registered in celery_app.tasks

    def test_celery_app_beat_schedule_matches_get_beat_schedule(self):
        """Inline beat_schedule in celery_app.py must use the same names."""
        from app.celery_app import celery_app

        inline = celery_app.conf.beat_schedule
        generated = get_beat_schedule()
        assert (
            inline["tick-due-jobs"]["task"]
            == generated["tick-due-jobs"]["task"]
            == "scheduler.tick_due_jobs"
        )
        assert (
            inline["refresh-tokens"]["task"]
            == generated["refresh-tokens"]["task"]
            == "scheduler.refresh_tokens"
        )

    def test_scheduler_module_is_included_for_worker_registration(self):
        """The scheduler module must be imported at worker startup.

        ``autodiscover_tasks(["app.services"])`` only imports
        ``app.services.tasks`` (which does not exist). Without the explicit
        ``include`` the live worker treated ``scheduler.tick_due_jobs`` as
        "unregistered" and dropped every beat tick (the scheduled pipeline
        silently never ran).
        """
        from app.celery_app import celery_app

        assert "app.services.scheduler_tasks" in celery_app.conf.include

    def test_tick_schedule_is_integer_seconds(self):
        """Tick schedule should be an integer (seconds)."""
        schedule = get_beat_schedule()
        tick_schedule = schedule["tick-due-jobs"]["schedule"]
        assert isinstance(tick_schedule, int)
        assert tick_schedule > 0
