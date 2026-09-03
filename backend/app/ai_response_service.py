"""
AI Search Response Service (Task 10 Step 2).

Coordinates query validation, provider resolution, request building,
adapter execution, response normalization, latency/token usage tracking,
and persistent database storage in `ai_responses`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AIResponse, Query, QuerySet, Website

from .provider_adapter import (
    ALLOWED_PROVIDERS,
    BaseProviderAdapter,
    DEFAULT_TIMEOUT_SECONDS,
    ProviderRequest,
    ProviderResponse,
    ResponseStatus,
    provider_registry,
)


logger = logging.getLogger(__name__)


class AIResponseService:
    """
    Centralized service executing queries against AI search providers,
    normalizing responses, and persisting auditable response evidence.
    """

    @classmethod
    def execute_query_response(
        cls,
        db: Session,
        query_id: int,
        provider: str = "mock",
        model: str | None = None,
        timeout_seconds: float | None = None,
    ) -> AIResponse:
        """
        Executes a single Query against the specified AI provider and saves
        the normalized response evidence in the database.
        """
        provider_clean = (provider or "mock").lower().strip()
        if provider_clean not in ALLOWED_PROVIDERS:
            raise ValueError(
                f"Unsupported provider '{provider}'. Allowed providers: {sorted(ALLOWED_PROVIDERS)}"
            )

        query = db.get(Query, query_id)
        if not query:
            raise ValueError(f"Query with id {query_id} not found.")

        adapter: BaseProviderAdapter = provider_registry.get(provider_clean)

        req = ProviderRequest(
            query_id=query.id,
            query_text=query.query_text,
            query_set_id=query.query_set_id,
            website_id=query.website_id,
            provider=provider_clean,
            model=model,
            request_timestamp=datetime.now(timezone.utc),
            timeout_seconds=timeout_seconds or DEFAULT_TIMEOUT_SECONDS,
            metadata={
                "query_intent": query.intent,
                "generation_source": query.generation_source,
                "topic": query.topic,
                "entity_name": query.entity_name,
            },
        )

        resp: ProviderResponse = adapter.execute_query(req)

        # Merge metadata with result_id
        meta = dict(resp.metadata_json or {})
        meta["result_id"] = resp.result_id
        if query.topic:
            meta["topic"] = query.topic
        if query.entity_name:
            meta["entity_name"] = query.entity_name

        ai_response = AIResponse(
            query_id=query.id,
            query_set_id=query.query_set_id,
            website_id=query.website_id,
            provider=resp.provider,
            model=resp.model,
            model_version=resp.model_version,
            status=resp.status.value,
            response_text=resp.response_text or "",
            latency_ms=resp.latency_ms,
            error_type=resp.error_type,
            error_message=resp.error_message,
            input_tokens=resp.usage.input_tokens if resp.usage else None,
            output_tokens=resp.usage.output_tokens if resp.usage else None,
            total_tokens=resp.usage.total_tokens if resp.usage else None,
            request_timestamp=resp.request_timestamp,
            response_timestamp=resp.response_timestamp,
            metadata_json=meta,
        )

        db.add(ai_response)
        db.commit()
        db.refresh(ai_response)
        return ai_response

    @classmethod
    def batch_execute_query_set_responses(
        cls,
        db: Session,
        query_set_id: int,
        provider: str = "mock",
        model: str | None = None,
        active_only: bool = True,
        timeout_seconds: float | None = None,
    ) -> list[AIResponse]:
        """
        Executes all queries in a QuerySet against the specified AI provider
        and persists individual response records.
        """
        provider_clean = (provider or "mock").lower().strip()
        if provider_clean not in ALLOWED_PROVIDERS:
            raise ValueError(
                f"Unsupported provider '{provider}'. Allowed providers: {sorted(ALLOWED_PROVIDERS)}"
            )

        query_set = db.get(QuerySet, query_set_id)
        if not query_set:
            raise ValueError(f"QuerySet with id {query_set_id} not found.")

        query_stmt = select(Query).where(Query.query_set_id == query_set_id)
        if active_only:
            query_stmt = query_stmt.where(Query.active.is_(True))
        queries = list(db.scalars(query_stmt).all())

        results: list[AIResponse] = []
        for q in queries:
            try:
                resp = cls.execute_query_response(
                    db=db,
                    query_id=q.id,
                    provider=provider_clean,
                    model=model,
                    timeout_seconds=timeout_seconds,
                )
                results.append(resp)
            except Exception as exc:
                logger.error(f"Error executing query {q.id} on provider {provider_clean}: {exc}")

        return results

    @classmethod
    def get_response(cls, db: Session, response_id: int) -> AIResponse | None:
        """Retrieves a single AIResponse record by ID."""
        return db.get(AIResponse, response_id)

    @classmethod
    def list_responses(
        cls,
        db: Session,
        website_id: int | None = None,
        query_set_id: int | None = None,
        query_id: int | None = None,
        provider: str | None = None,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AIResponse]:
        """Lists historical AIResponse records with optional filtering."""
        stmt = select(AIResponse)
        if website_id is not None:
            stmt = stmt.where(AIResponse.website_id == website_id)
        if query_set_id is not None:
            stmt = stmt.where(AIResponse.query_set_id == query_set_id)
        if query_id is not None:
            stmt = stmt.where(AIResponse.query_id == query_id)
        if provider is not None:
            stmt = stmt.where(AIResponse.provider == provider.lower().strip())
        if status is not None:
            stmt = stmt.where(AIResponse.status == status.upper().strip())

        stmt = stmt.order_by(AIResponse.created_at.desc()).offset(offset).limit(limit)
        return list(db.scalars(stmt).all())

    @classmethod
    def list_available_providers(cls) -> list[dict[str, Any]]:
        """Lists registered providers and their configuration readiness status."""
        return provider_registry.list_providers()
