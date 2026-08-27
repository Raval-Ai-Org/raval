"""Database connection pool configuration.

Engines are initialized lazily to allow environment variable overrides
before creation (critical for testing with alternative database URLs).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator, Generator
from contextlib import asynccontextmanager, contextmanager
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


# Engine singletons (None until first use)
_async_engine: AsyncEngine | None = None
_sync_engine: Engine | None = None


def get_async_engine() -> AsyncEngine:
    """Get or create the async engine."""
    global _async_engine
    if _async_engine is None:
        settings = get_settings()
        is_sqlite = "sqlite" in (settings.DATABASE_URL or "")
        kw: dict[str, Any] = {
            "echo": settings.ENV == "development" and settings.LOG_LEVEL == "DEBUG"
        }
        if is_sqlite:
            # Test/dev SQLite concurrency (T067): the eager Celery worker opens
            # its OWN sync session against the same file while the async session
            # is open. Without WAL + busy_timeout SQLite raises SQLITE_BUSY
            # ("database is locked") — an order-dependent full-suite failure.
            kw["connect_args"] = {"timeout": 30}
        else:
            kw.update(
                {
                    "pool_size": settings.DB_POOL_SIZE,
                    "max_overflow": settings.DB_MAX_OVERFLOW,
                    "pool_recycle": settings.DB_POOL_RECYCLE,
                    "pool_pre_ping": settings.DB_POOL_PRE_PING,
                }
            )
        assert settings.DATABASE_URL is not None, "DATABASE_URL must be configured"
        _async_engine = create_async_engine(settings.DATABASE_URL, **kw)
    return _async_engine


def get_sync_engine() -> Engine:
    """Get or create the sync engine."""
    global _sync_engine
    if _sync_engine is None:
        settings = get_settings()
        is_sqlite = "sqlite" in (settings.DATABASE_URL_SYNC or "")
        kw: dict[str, Any] = {
            "echo": settings.ENV == "development" and settings.LOG_LEVEL == "DEBUG"
        }
        if is_sqlite:
            # Same WAL + busy_timeout as the async engine (T067) so the eager
            # worker's sync session can write while the async session is open.
            kw["connect_args"] = {"timeout": 30}
        else:
            kw.update(
                {
                    "pool_size": settings.DB_POOL_SIZE,
                    "max_overflow": settings.DB_MAX_OVERFLOW,
                    "pool_recycle": settings.DB_POOL_RECYCLE,
                    "pool_pre_ping": settings.DB_POOL_PRE_PING,
                }
            )
        assert settings.DATABASE_URL_SYNC is not None, "DATABASE_URL_SYNC must be configured"
        _sync_engine = create_engine(settings.DATABASE_URL_SYNC, **kw)
    return _sync_engine


def get_async_session_maker() -> async_sessionmaker[AsyncSession]:
    """Get or create the async session maker."""
    return async_sessionmaker(
        get_async_engine(),
        expire_on_commit=False,
    )


def get_sync_session_maker() -> sessionmaker[Session]:
    """Get or create the sync session maker."""
    return sessionmaker(
        bind=get_sync_engine(),
        expire_on_commit=False,
    )


async def get_async_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency injection generator for FastAPI endpoints."""
    maker = get_async_session_maker()
    async with maker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@asynccontextmanager
async def async_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Context manager for programmatic async database interactions."""
    maker = get_async_session_maker()
    async with maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@contextmanager
def sync_db_session() -> Generator[Session, None, None]:
    """Context manager for programmatic sync database interactions (Celery workers)."""
    maker = get_sync_session_maker()
    session = maker()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


async def verify_db_connection() -> bool:
    """Verify that the database can be reached (used in health check)."""
    try:
        from sqlalchemy import text

        maker = get_async_session_maker()
        async with maker() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.error(f"Database connection verification failed: {e}")
        return False
