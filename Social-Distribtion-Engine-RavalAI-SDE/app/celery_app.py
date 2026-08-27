"""Celery application configuration and initialization.

Implements queue-first architecture: all external API calls go through
Celery tasks rather than HTTP request handlers. This ensures durability,
retry capability, and decoupling of API and worker concerns.

Configuration:
- Broker: Redis (URL from settings)
- Result backend: Redis (URL from settings)
- Task serialization: JSON
- Acks late: True (task not marked done until worker confirms)
- Prefetch count: 1 (one task at a time per worker)
- Task soft time limit: 120s
- Task hard time limit: 180s
"""

from __future__ import annotations

from celery import Celery

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "raval_sde",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

# Celery configuration
celery_app.conf.update(
    # Task serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    # Worker behavior
    task_acks_late=True,  # Don't ack until task completes
    worker_prefetch_multiplier=1,  # One task at a time
    # Time limits
    task_soft_time_limit=120,  # 120 seconds soft limit
    task_time_limit=180,  # 180 seconds hard limit
    # Result expiration
    result_expires=3600 * 24 * 7,  # Keep results for 7 days
    # Task routing (default to the same queue)
    task_default_queue="sde.default",
    task_queues=None,  # Will be populated when tasks are registered
    # Guarantee the scheduler tasks are imported at worker/beat startup.
    # autodiscover_tasks(["app.services"]) only imports "app.services.tasks"
    # (which does not exist), so without this include the worker treated
    # scheduler.tick_due_jobs as "unregistered" and silently dropped it.
    include=["app.services.scheduler_tasks"],
    # Beat schedule (populated below after import)
    # beat_schedule=None,  # Set by get_beat_schedule()
    # Visibility timeout for Redis (2 hours)
    broker_transport_options={"visibility_timeout": 7200},
    # Maximum retries for broker connection
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=10,
)

# Auto-discover tasks from registered modules
celery_app.autodiscover_tasks(["app.services"])

# Register platform adapters so Celery workers can publish to real platforms.
# The worker does not run the FastAPI lifespan, which is where adapters were
# registered before — without this the worker silently fell back to DryRun.
try:
    from app.adapters import register_default_adapters

    register_default_adapters()
except Exception:  # pragma: no cover - import errors surface at worker startup
    pass

# Configure beat schedule inline (avoid circular import with scheduler_tasks)
# NOTE: task names MUST match the decorator-registered names
# (`scheduler.tick_due_jobs`, `scheduler.refresh_tokens`). The earlier
# `app.services.scheduler_tasks.*` names never matched a registered task, so
# beat fired "Received unregistered task" and the scheduled pipeline never ran.
beat_schedule = {
    "tick-due-jobs": {
        "task": "scheduler.tick_due_jobs",
        "schedule": float(settings.BEAT_INTERVAL_SECONDS),
        "options": {"expires": float(settings.BEAT_INTERVAL_SECONDS) * 2},
    },
    "refresh-tokens": {
        "task": "scheduler.refresh_tokens",
        "schedule": 24 * 3600.0,
        "options": {"expires": 3600.0},
    },
}

celery_app.conf.beat_schedule = beat_schedule


def get_celery_app() -> Celery:  # type: ignore[no-any-unimported]
    """Get the configured Celery application instance.

    Returns:
        Configured Celery app for creating tasks or starting workers.

    """
    return celery_app
