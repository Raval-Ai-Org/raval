"""Main FastAPI application factory."""

from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import accounts, admin, jobs, ops, publish, webhooks_cfg
from app.config import get_settings
from app.schemas import ErrorResponse

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Awaitable, Callable

    from starlette.responses import Response

settings = get_settings()

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:  # noqa: ARG001
    """Lifespan context manager for startup and shutdown events."""
    logger.info("Initializing RavalAI Social Distribution Engine (SDE)")
    # Startup tasks:
    # 1. Warm DB pool, write warning if connection fails
    try:
        from app.database import verify_db_connection

        db_ok = await verify_db_connection()
        if not db_ok:
            logger.critical("Database is not reachable on startup!")
    except Exception:
        logger.exception("Error checking database on startup")

    # 2. Register platform adapters (same set the Celery worker uses)
    try:
        from app.adapters import register_default_adapters

        register_default_adapters()
        logger.info("Registered adapters: dryrun, twitter, linkedin, facebook")
    except Exception:
        logger.exception("Error registering adapters on startup")

    yield

    # Shutdown tasks:
    logger.info("Shutting down RavalAI Social Distribution Engine")
    try:
        from app.database import get_async_engine

        engine = get_async_engine()
        await engine.dispose()
    except Exception:
        logger.exception("Error disposing database engine on shutdown")


app = FastAPI(
    title="RavalAI Social Distribution Engine",
    description="Backend engine for scheduling and publishing posts to multi platforms.",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
)

# CORS — restricted to RavalAI origins (hardening; the browser never calls the
# SDR directly — RavalAI proxies server-side — so no wildcard is needed).
# Configurable via CORS_ORIGINS (comma-separated); default covers dev + prod.
# allow_credentials=False is correct for a Bearer-token API (no cookies).
_cors_origins = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "https://raval.it.com,http://localhost:3000").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Standard Request ID middleware
@app.middleware("http")
async def add_request_id(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# === Error Handlers ===


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    """Handle model / query parameters validation errors and return structured format."""
    request_id = getattr(request.state, "request_id", None)
    logger.error(f"Validation error for request {request_id}: {exc}")

    # Standard error detail construction
    errors = exc.errors()
    detail_msg = "Validation failed: " + "; ".join(
        f"{' -> '.join(str(loc) for loc in err['loc'])}: {err['msg']}" for err in errors
    )

    error_response = ErrorResponse(
        error_code="VALIDATION_ERROR",
        detail=detail_msg,
        request_id=request_id,
        timestamp=datetime.now(UTC),
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=jsonable_encoder(error_response),
    )


@app.exception_handler(Exception)
async def generic_exception_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    """Catch-all handler for unhandled exceptions."""
    request_id = getattr(request.state, "request_id", None)
    logger.exception(f"Unhandled error for request {request_id}: {exc}")

    error_response = ErrorResponse(
        error_code="INTERNAL_SERVER_ERROR",
        detail="An unexpected error occurred. Please contact support.",
        request_id=request_id,
        timestamp=datetime.now(UTC),
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=jsonable_encoder(error_response),
    )


# === Route Registration ===
# Ops/health endpoint under root, not versioned as standard practice
app.include_router(ops.router)
app.include_router(publish.router)
app.include_router(jobs.router)
app.include_router(webhooks_cfg.router)
app.include_router(accounts.router)
app.include_router(admin.router)
