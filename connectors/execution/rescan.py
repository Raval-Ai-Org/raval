"""
Targeted Rescan Engine (Task 11 Step 5).

Performs focused, single-resource rescans following an execution mutation.
Reuses:
- crawler PageFetcher (crawler.fetcher)
- PageExtractor (backend.app.page_extractor)
- BaseConnector.read_resource()

GUARANTEE:
Operates strictly on the affected target resource/page. Does NOT trigger
unrestricted full-site crawls.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlparse

from backend.app.page_extractor import ExtractionResult, extract_html
from connectors.base.interface import BaseConnector
from connectors.base.models import ResourceReference
from connectors.execution.models import ExecutionTarget, RescanTarget, TargetedRescanResult
from crawler.config import CrawlerConfig
from crawler.fetcher import PageFetcher

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _compute_content_hash(content: str | bytes | None) -> str | None:
    if content is None:
        return None
    data = content.encode("utf-8") if isinstance(content, str) else content
    return hashlib.sha256(data).hexdigest()


def _serialize_extraction_result(res: ExtractionResult) -> dict[str, Any]:
    """Serializes ExtractionResult dataclass into a JSON-serializable dictionary."""
    headings_data = [
        {"level": h.level, "text": h.text, "position": h.position, "empty": h.empty}
        for h in res.headings
    ]
    meta_descriptions_data = [
        {
            "text": d.text,
            "length": d.length,
            "position": d.position,
            "too_short": d.too_short,
            "too_long": d.too_long,
        }
        for d in res.meta_descriptions
    ]
    structured_data_list = [
        {
            "block_position": sd.block_position,
            "types": sd.types,
            "parsed_json": sd.parsed_json,
            "context": sd.context,
        }
        for sd in res.structured_data
    ]
    canonicals_data = [
        {"url": c.url, "position": c.position, "valid": c.valid, "self_reference": c.self_reference}
        for c in res.canonicals
    ]
    first_desc = meta_descriptions_data[0]["text"] if meta_descriptions_data else None
    first_canonical = canonicals_data[0]["url"] if canonicals_data else None
    first_schema = (
        structured_data_list[0].get("parsed_json")
        if (structured_data_list and structured_data_list[0].get("parsed_json"))
        else None
    )

    return {
        "html_available": res.html_available,
        "content_size_bytes": res.content_size_bytes,
        "clean_text_available": res.clean_text_available,
        "word_count": res.word_count,
        "title": res.title_text,
        "description": first_desc,
        "meta_description": first_desc,
        "canonical": first_canonical,
        "canonical_url": first_canonical,
        "schema": first_schema,
        "@context": first_schema.get("@context") if isinstance(first_schema, dict) else None,
        "@type": first_schema.get("@type") if isinstance(first_schema, dict) else None,
        "title_present": res.title_present,
        "title_text": res.title_text,
        "title_length": res.title_length,
        "title_empty": res.title_empty,
        "title_too_short": res.title_too_short,
        "title_too_long": res.title_too_long,
        "h1_count": res.h1_count,
        "missing_h1": res.missing_h1,
        "multiple_h1": res.multiple_h1,
        "headings": headings_data,
        "meta_description_present": res.meta_description_present,
        "meta_descriptions": meta_descriptions_data,
        "canonical_present": res.canonical_present,
        "canonicals": canonicals_data,
        "structured_data": structured_data_list,
        "image_count": res.image_count,
        "images_without_alt": res.images_without_alt,
        "detected_language": res.detected_language,
        "extraction_status": res.extraction_status,
    }


class TargetedRescanner:
    """
    Executes targeted, single-page or single-resource rescans post-mutation.
    """

    @classmethod
    def resolve_target_url(cls, target: ExecutionTarget) -> str | None:
        """
        Determines the public URL for a target resource if applicable.
        """
        res_id = target.resource.resource_id
        res_path = target.resource.path

        if res_id and (res_id.startswith("http://") or res_id.startswith("https://")):
            return res_id
        if res_path and (res_path.startswith("http://") or res_path.startswith("https://")):
            return res_path

        site_url = getattr(target.site_context, "site_url", None) or getattr(target.site_context, "base_url", None)
        if not site_url:
            return None

        # Build URL from path or resource ID
        path_component = res_path or res_id or "/"
        if not path_component.startswith("/"):
            path_component = f"/{path_component}"

        return urljoin(site_url, path_component)

    @classmethod
    def rescan_target(
        cls,
        target: ExecutionTarget,
        connector: BaseConnector | None = None,
        fetcher: PageFetcher | Any | None = None,
        custom_html: str | None = None,
        timeout_seconds: float = 10.0,
    ) -> TargetedRescanResult:
        """
        Fetches and extracts the affected target resource.
        Supports:
        - In-memory custom_html injection (for tests/dry runs)
        - Connector-based direct reading (read_resource)
        - HTTP-based targeted page fetch (PageFetcher)
        """
        resolved_url = cls.resolve_target_url(target)
        provider = getattr(target.site_context, "provider", "generic")
        rescan_target = RescanTarget(
            url=resolved_url,
            resource_id=target.resource.resource_id,
            resource_type=target.resource.resource_type.value if hasattr(target.resource.resource_type, "value") else str(target.resource.resource_type),
            provider=provider,
            metadata={"res_path": target.resource.path},
        )

        content: str | None = None
        status_code: int | None = None
        error_msg: str | None = None
        evidence: dict[str, Any] = {}

        # 1. Custom HTML provided
        if custom_html is not None:
            content = custom_html
            status_code = 200
            evidence["source"] = "custom_payload"

        # 2. Connector read_resource capability
        elif connector is not None:
            try:
                res_content = connector.read_resource(target.resource)
                if isinstance(res_content.content, str):
                    content = res_content.content
                elif isinstance(res_content.content, dict):
                    post_content = res_content.content.get("content") or res_content.content.get("rendered") or ""
                    title = res_content.content.get("title", "")
                    meta = res_content.content.get("meta", {})
                    content = f"<html><head><title>{title}</title></head><body><h1>{title}</h1>{post_content}</body></html>"
                    evidence["raw_metadata"] = meta
                status_code = 200
                evidence["source"] = f"connector_{provider}"
            except Exception as exc:
                logger.warning("Connector read_resource failed during rescan: %s", exc)
                error_msg = str(exc)

        # 3. HTTP Network Fetch via PageFetcher
        if content is None and resolved_url and not error_msg:
            try:
                active_fetcher = fetcher or PageFetcher(CrawlerConfig(timeout_seconds=timeout_seconds, retry_count=1))
                fetch_res = active_fetcher.fetch(resolved_url)
                status_code = fetch_res.status_code
                if fetch_res.success:
                    content = fetch_res.content
                    evidence["source"] = "http_fetch"
                else:
                    error_msg = fetch_res.error or f"HTTP {status_code}"
            except Exception as exc:
                logger.warning("HTTP fetch failed during targeted rescan: %s", exc)
                error_msg = str(exc)

        # 4. Extract Structured Features
        extraction_dict: dict[str, Any] | None = None
        if content is not None:
            try:
                raw_extracted = extract_html(
                    html_content=content,
                    page_url=resolved_url,
                )
                extraction_dict = _serialize_extraction_result(raw_extracted)
            except Exception as exc:
                logger.warning("Page extraction failed on rescanned content: %s", exc)
                extraction_dict = {"extraction_status": "error", "error": str(exc)}

        evidence["content_hash"] = _compute_content_hash(content)
        evidence["content_length"] = len(content) if content else 0
        evidence["status_code"] = status_code

        return TargetedRescanResult(
            target=rescan_target,
            status_code=status_code,
            content=content,
            extraction_result=extraction_dict,
            fetched_at=_utc_now(),
            evidence=evidence,
            error=error_msg,
        )
