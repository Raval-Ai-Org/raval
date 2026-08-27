"""Operations and monitoring API routes."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_db, verify_db_connection
from app.schemas import HealthResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["operations"])


@router.get("/healthz", response_model=HealthResponse)
async def health_check(db: AsyncSession = Depends(get_async_db)) -> dict[str, object]:  # noqa: ARG001
    """Check application health status (database, redis, workers)."""
    # 1. Check Database connection
    db_ok = await verify_db_connection()

    # 2. Check Redis connection
    redis_ok = False
    try:
        import redis

        from app.config import get_settings

        settings = get_settings()
        r = redis.Redis.from_url(settings.REDIS_URL, socket_timeout=2)
        r.ping()
        redis_ok = True
    except Exception as e:
        logger.error(f"Redis connection verification failed: {e}")

    # 3. Check Celery Workers via inspect ping
    workers_ok = True
    try:
        from app.celery_app import get_celery_app

        # Use Celery inspect to ping workers (timeout after 3s)
        inspect = get_celery_app().control.inspect(timeout=3)
        worker_stats = inspect.ping()

        if worker_stats is None:
            workers_ok = False
            logger.warning("No Celery workers responded to ping")
    except Exception as e:
        logger.warning(f"Celery worker check failed (workers may not be running): {e}")
        workers_ok = False

    overall_status = "healthy"
    if not db_ok or not redis_ok:
        overall_status = "unhealthy"
    elif not workers_ok:
        overall_status = "degraded"

    return {
        "status": overall_status,
        "timestamp": datetime.now(UTC),
        "services": {
            "database": db_ok,
            "redis": redis_ok,
            "workers": workers_ok,
        },
        "details": None
        if overall_status == "healthy"
        else "Some background service is degraded or offline",
    }
