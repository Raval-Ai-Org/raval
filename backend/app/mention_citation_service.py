"""
Mention & Citation Detection Engine (Task 10 Step 3).

Deterministically analyzes captured AI search responses to extract brand mentions,
configured aliases, domain mentions, product/entity mentions, and cited URLs.
Maps citations to known crawled pages, calculates conservative match confidence,
and preserves rich context snippets and audit evidence.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AICitation, AIMention, AIResponse, Entity, PageResult, Query, Website

logger = logging.getLogger(__name__)


# ==========================================
# 1. Enums & Data Structures
# ==========================================


class MentionType(str, Enum):
    EXACT_BRAND = "EXACT_BRAND"
    BRAND_ALIAS = "BRAND_ALIAS"
    DOMAIN_MATCH = "DOMAIN_MATCH"
    PRODUCT_ENTITY = "PRODUCT_ENTITY"


COMMON_GENERIC_WORDS = {
    "target", "apple", "box", "next", "meta", "alphabet", "amazon",
    "oracle", "square", "stripe", "block", "ring", "nest", "wave",
    "spark", "zoom", "slack", "notion", "linear", "click", "base",
}

TRACKING_QUERY_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "gclsrc", "dclid", "ref", "source", "mc_cid", "mc_eid",
}


@dataclass
class TargetIdentity:
    """Target brand and domain identities for matching."""
    website_id: int
    brand_name: str
    domain: str
    aliases: list[str] = field(default_factory=list)
    product_entities: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class DetectedMention:
    """A detected brand, alias, domain, or product mention."""
    matched_text: str
    match_type: MentionType
    normalized_text: str
    start_pos: int | None = None
    end_pos: int | None = None
    context_snippet: str = ""
    confidence: float = 1.0
    entity_id: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "matched_text": self.matched_text,
            "match_type": self.match_type.value,
            "normalized_text": self.normalized_text,
            "start_pos": self.start_pos,
            "end_pos": self.end_pos,
            "context_snippet": self.context_snippet,
            "confidence": self.confidence,
            "entity_id": self.entity_id,
        }


@dataclass
class DetectedCitation:
    """A detected cited URL with domain classification and page mapping."""
    url: str
    normalized_url: str
    domain: str
    is_target_domain: bool = False
    page_id: int | None = None
    position: int = 1
    context_snippet: str | None = None
    confidence: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "normalized_url": self.normalized_url,
            "domain": self.domain,
            "is_target_domain": self.is_target_domain,
            "page_id": self.page_id,
            "position": self.position,
            "context_snippet": self.context_snippet,
            "confidence": self.confidence,
        }


@dataclass
class DetectionResult:
    """Aggregated detection result for a single AIResponse."""
    response_id: int
    query_id: int
    website_id: int
    provider: str
    target_mentioned: bool
    target_cited: bool
    mentions_count: int
    citations_count: int
    target_citations_count: int
    mentions: list[DetectedMention] = field(default_factory=list)
    citations: list[DetectedCitation] = field(default_factory=list)


# ==========================================
# 2. URL Normalization & Helper Utilities
# ==========================================


def extract_domain_from_url(url: str) -> str:
    """
    Extracts canonical domain (lowercased, without www prefix or port).
    e.g. 'https://www.Raval.AI:443/docs' -> 'raval.ai'
    """
    if not url:
        return ""
    clean = url.strip()
    if not clean.startswith(("http://", "https://")):
        clean = "https://" + clean
    try:
        parsed = urlparse(clean)
        netloc = parsed.netloc.lower()
        if ":" in netloc:
            netloc = netloc.split(":")[0]
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc
    except Exception:
        return ""


def normalize_citation_url(url: str) -> str:
    """
    Standardizes a URL for comparison:
    - Lowercases scheme and netloc (stripping 'www.')
    - Strips tracking query parameters (utm_*, ref, etc.)
    - Removes fragments (#...)
    - Strips trailing slashes from path (except root '/')
    """
    if not url:
        return ""
    clean = url.strip()
    if not clean.startswith(("http://", "https://")):
        clean = "https://" + clean
    try:
        parsed = urlparse(clean)
        scheme = parsed.scheme.lower() or "https"
        netloc = parsed.netloc.lower()
        if ":" in netloc:
            netloc = netloc.split(":")[0]
        if netloc.startswith("www."):
            netloc = netloc[4:]

        path = parsed.path
        if path.endswith("/") and len(path) > 1:
            path = path.rstrip("/")

        # Filter out tracking query params
        q_params = []
        for k, v in parse_qsl(parsed.query):
            if k.lower() not in TRACKING_QUERY_PARAMS:
                q_params.append((k, v))
        new_query = urlencode(q_params)

        normalized = urlunparse((scheme, netloc, path, "", new_query, ""))
        return normalized
    except Exception:
        return url.strip()


def extract_context_snippet(text: str, start: int, end: int, window: int = 60) -> str:
    """Extracts a readable contextual snippet around character span [start, end]."""
    if not text:
        return ""
    s = max(0, start - window)
    e = min(len(text), end + window)
    prefix = "..." if s > 0 else ""
    suffix = "..." if e < len(text) else ""
    return prefix + text[s:e].strip() + suffix


def extract_urls_from_text(text: str) -> list[tuple[str, int, int]]:
    """
    Extracts all URLs and their character spans from text, supporting
    markdown links and plain HTTP/HTTPS/WWW URLs.
    """
    if not text:
        return []

    results: list[tuple[str, int, int]] = []
    seen_spans: set[tuple[int, int]] = set()

    # 1. Markdown links: [Title](https://...)
    md_pattern = re.compile(r"\[([^\]]+)\]\((https?://[^\s\)]+)\)")
    for match in md_pattern.finditer(text):
        url = match.group(2)
        start, end = match.span()
        results.append((url, start, end))
        seen_spans.add((start, end))

    # 2. Plain URLs: http:// or https://
    url_pattern = re.compile(r"(?i)\b(https?://[^\s\)\"'>]+)")
    for match in url_pattern.finditer(text):
        start, end = match.span()
        # Clean trailing punctuation
        raw_url = match.group(1).rstrip(".,;:!?)]")
        end = start + len(raw_url)
        if not any(s <= start and end <= e for s, e in seen_spans):
            results.append((raw_url, start, end))
            seen_spans.add((start, end))

    # 3. Plain www URLs: www.example.com
    www_pattern = re.compile(r"(?i)\b(www\.[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+[^\s\)\"'>]*)")
    for match in www_pattern.finditer(text):
        start, end = match.span()
        raw_url = match.group(1).rstrip(".,;:!?)]")
        end = start + len(raw_url)
        full_url = "https://" + raw_url
        if not any(s <= start and end <= e for s, e in seen_spans):
            results.append((full_url, start, end))
            seen_spans.add((start, end))

    return results


# ==========================================
# 3. Detection Engine Logic
# ==========================================


def detect_mentions(
    text: str,
    target: TargetIdentity,
) -> list[DetectedMention]:
    """
    Deterministically detects brand, alias, domain, and product/entity mentions
    in response text with false-positive protections.
    """
    if not text:
        return []

    mentions: list[DetectedMention] = []
    claimed_spans: list[tuple[int, int]] = []

    def is_overlapping(s: int, e: int) -> bool:
        return any(max(s, cs) < min(e, ce) for cs, ce in claimed_spans)

    # 1. Exact Brand Name Match
    brand = target.brand_name.strip() if target.brand_name else ""
    if brand and len(brand) >= 2:
        is_generic = brand.lower() in COMMON_GENERIC_WORDS
        pattern_str = r"\b" + re.escape(brand) + r"\b"
        flags = 0 if is_generic else re.IGNORECASE
        for m in re.finditer(pattern_str, text, flags=flags):
            s, e = m.span()
            if not is_overlapping(s, e):
                matched_val = m.group(0)
                mentions.append(
                    DetectedMention(
                        matched_text=matched_val,
                        match_type=MentionType.EXACT_BRAND,
                        normalized_text=brand,
                        start_pos=s,
                        end_pos=e,
                        context_snippet=extract_context_snippet(text, s, e),
                        confidence=1.0,
                    )
                )
                claimed_spans.append((s, e))

    # 2. Domain Mention in Text (e.g. "raval.ai")
    domain = target.domain.strip().lower() if target.domain else ""
    if domain and len(domain) >= 3:
        # Match domain appearing as a word/token
        domain_pattern = re.compile(r"(?i)(?:\b|https?://|www\.)" + re.escape(domain) + r"\b")
        for m in domain_pattern.finditer(text):
            s, e = m.span()
            if not is_overlapping(s, e):
                matched_val = m.group(0)
                mentions.append(
                    DetectedMention(
                        matched_text=matched_val,
                        match_type=MentionType.DOMAIN_MATCH,
                        normalized_text=domain,
                        start_pos=s,
                        end_pos=e,
                        context_snippet=extract_context_snippet(text, s, e),
                        confidence=1.0,
                    )
                )
                claimed_spans.append((s, e))

    # 3. Product & Entity Mentions
    for ent in target.product_entities:
        ent_name = ent.get("name", "").strip()
        ent_id = ent.get("entity_id")
        if ent_name and len(ent_name) >= 3:
            is_generic = ent_name.lower() in COMMON_GENERIC_WORDS
            flags = 0 if is_generic else re.IGNORECASE
            pattern_str = r"\b" + re.escape(ent_name) + r"\b"
            for m in re.finditer(pattern_str, text, flags=flags):
                s, e = m.span()
                if not is_overlapping(s, e):
                    matched_val = m.group(0)
                    mentions.append(
                        DetectedMention(
                            matched_text=matched_val,
                            match_type=MentionType.PRODUCT_ENTITY,
                            normalized_text=ent_name,
                            start_pos=s,
                            end_pos=e,
                            context_snippet=extract_context_snippet(text, s, e),
                            confidence=0.90,
                            entity_id=ent_id,
                        )
                    )
                    claimed_spans.append((s, e))

    # 4. Brand Aliases
    for alias in target.aliases:
        alias_clean = alias.strip()
        if alias_clean and len(alias_clean) >= 2:
            is_generic = alias_clean.lower() in COMMON_GENERIC_WORDS
            flags = 0 if is_generic else re.IGNORECASE
            pattern_str = r"\b" + re.escape(alias_clean) + r"\b"
            for m in re.finditer(pattern_str, text, flags=flags):
                s, e = m.span()
                if not is_overlapping(s, e):
                    matched_val = m.group(0)
                    mentions.append(
                        DetectedMention(
                            matched_text=matched_val,
                            match_type=MentionType.BRAND_ALIAS,
                            normalized_text=alias_clean,
                            start_pos=s,
                            end_pos=e,
                            context_snippet=extract_context_snippet(text, s, e),
                            confidence=0.95,
                        )
                    )
                    claimed_spans.append((s, e))

    # Sort mentions by start position
    mentions.sort(key=lambda x: x.start_pos if x.start_pos is not None else 0)
    return mentions


def detect_citations(
    text: str,
    target: TargetIdentity,
    metadata: dict[str, Any] | None = None,
    known_pages: list[PageResult] | None = None,
) -> list[DetectedCitation]:
    """
    Deterministically extracts and normalizes all citation URLs from response text
    and provider metadata (e.g. Perplexity citations).
    """
    raw_citations: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    position = 1

    # 1. Extract URLs from Response Text
    text_urls = extract_urls_from_text(text)
    for raw_url, start, end in text_urls:
        norm_url = normalize_citation_url(raw_url)
        if norm_url and norm_url not in seen_urls:
            raw_citations.append(
                {
                    "url": raw_url,
                    "normalized_url": norm_url,
                    "snippet": extract_context_snippet(text, start, end),
                    "position": position,
                }
            )
            seen_urls.add(norm_url)
            position += 1

    # 2. Extract URLs from Provider Metadata (e.g. citations array in Perplexity)
    if metadata and "citations" in metadata and isinstance(metadata["citations"], list):
        for c in metadata["citations"]:
            if isinstance(c, str) and c.startswith(("http://", "https://", "www.")):
                norm_url = normalize_citation_url(c)
                if norm_url and norm_url not in seen_urls:
                    raw_citations.append(
                        {
                            "url": c,
                            "normalized_url": norm_url,
                            "snippet": "Provider metadata citation list",
                            "position": position,
                        }
                    )
                    seen_urls.add(norm_url)
                    position += 1

    # Pre-index known pages by normalized URL
    page_map: dict[str, int] = {}
    if known_pages:
        for page in known_pages:
            if page.url:
                page_map[normalize_citation_url(page.url)] = page.id
            if page.final_url:
                page_map[normalize_citation_url(page.final_url)] = page.id

    target_domain = target.domain.strip().lower() if target.domain else ""
    results: list[DetectedCitation] = []

    for item in raw_citations:
        url_domain = extract_domain_from_url(item["url"])
        is_target = False
        if target_domain and url_domain:
            is_target = (url_domain == target_domain) or url_domain.endswith("." + target_domain)

        matched_page_id = page_map.get(item["normalized_url"])

        results.append(
            DetectedCitation(
                url=item["url"],
                normalized_url=item["normalized_url"],
                domain=url_domain,
                is_target_domain=is_target,
                page_id=matched_page_id,
                position=item["position"],
                context_snippet=item.get("snippet"),
                confidence=1.0,
            )
        )

    return results


# ==========================================
# 4. Service Layer
# ==========================================


class MentionCitationService:
    """
    Centralized service coordinating target identity resolution, mention extraction,
    citation extraction, and persistent database storage in `ai_mentions` and `ai_citations`.
    """

    @classmethod
    def build_target_identity(
        cls,
        db: Session,
        website_id: int,
        custom_aliases: list[str] | None = None,
    ) -> TargetIdentity:
        """Constructs target matching parameters from website and entity records."""
        website = db.get(Website, website_id)
        if not website:
            raise ValueError(f"Website with id {website_id} not found.")

        domain = extract_domain_from_url(website.url)
        aliases = list(custom_aliases or [])

        # Add natural brand variations if not present
        brand_name = website.name.strip()
        name_lower = brand_name.lower()

        for suffix in [" inc", " inc.", " llc", " corp", " corporation", " company", " co.", " ltd"]:
            if name_lower.endswith(suffix):
                short_name = brand_name[: -len(suffix)].strip()
                if short_name and short_name not in aliases and short_name.lower() != name_lower:
                    aliases.append(short_name)

        # Ingest product and brand entities (excluding competitor entities)
        product_entities = []
        entity_stmt = select(Entity).where(
            Entity.website_id == website_id,
            ~Entity.entity_type.in_(["competitor", "competitor_brand", "competitor_product"]),
        )
        entities = list(db.scalars(entity_stmt).all())
        for ent in entities:
            if ent.name and ent.name.strip() != brand_name:
                product_entities.append({"name": ent.name.strip(), "entity_id": ent.id})


        return TargetIdentity(
            website_id=website.id,
            brand_name=brand_name,
            domain=domain,
            aliases=aliases,
            product_entities=product_entities,
        )

    @classmethod
    def detect_mentions_and_citations(
        cls,
        response_text: str,
        target: TargetIdentity,
        metadata: dict[str, Any] | None = None,
        known_pages: list[PageResult] | None = None,
    ) -> tuple[list[DetectedMention], list[DetectedCitation]]:
        """Pure detection function parsing text against target identity."""
        mentions = detect_mentions(response_text, target)
        citations = detect_citations(response_text, target, metadata=metadata, known_pages=known_pages)
        return mentions, citations

    @classmethod
    def process_and_persist_detection(
        cls,
        db: Session,
        response_id: int,
        custom_aliases: list[str] | None = None,
    ) -> DetectionResult:
        """
        Loads an AIResponse, executes mention & citation detection,
        persists AIMention and AICitation records, and returns DetectionResult.
        """
        response = db.get(AIResponse, response_id)
        if not response:
            raise ValueError(f"AIResponse with id {response_id} not found.")

        target = cls.build_target_identity(
            db=db,
            website_id=response.website_id,
            custom_aliases=custom_aliases,
        )

        # Load known pages for website
        page_stmt = (
            select(PageResult)
            .join(PageResult.scan)
            .where(PageResult.scan.has(website_id=response.website_id))
        )
        known_pages = list(db.scalars(page_stmt).all())

        mentions, citations = cls.detect_mentions_and_citations(
            response_text=response.response_text,
            target=target,
            metadata=response.metadata_json if isinstance(response.metadata_json, dict) else None,
            known_pages=known_pages,
        )

        # Delete existing mentions/citations for this response to ensure idempotency
        del_mentions = select(AIMention).where(AIMention.response_id == response_id)
        for m in db.scalars(del_mentions).all():
            db.delete(m)

        del_citations = select(AICitation).where(AICitation.response_id == response_id)
        for c in db.scalars(del_citations).all():
            db.delete(c)

        db.flush()

        # Persist AIMention records
        for m in mentions:
            db_mention = AIMention(
                response_id=response.id,
                website_id=response.website_id,
                query_id=response.query_id,
                entity_id=m.entity_id,
                matched_text=m.matched_text,
                match_type=m.match_type.value,
                normalized_text=m.normalized_text,
                start_pos=m.start_pos,
                end_pos=m.end_pos,
                context_snippet=m.context_snippet,
                confidence=m.confidence,
                created_at=datetime.now(timezone.utc),
            )
            db.add(db_mention)

        # Persist AICitation records
        for c in citations:
            db_citation = AICitation(
                response_id=response.id,
                website_id=response.website_id,
                query_id=response.query_id,
                page_id=c.page_id,
                url=c.url,
                normalized_url=c.normalized_url,
                domain=c.domain,
                is_target_domain=c.is_target_domain,
                position=c.position,
                context_snippet=c.context_snippet,
                confidence=c.confidence,
                created_at=datetime.now(timezone.utc),
            )
            db.add(db_citation)

        db.commit()

        target_cited_count = sum(1 for c in citations if c.is_target_domain)
        return DetectionResult(
            response_id=response.id,
            query_id=response.query_id,
            website_id=response.website_id,
            provider=response.provider,
            target_mentioned=len(mentions) > 0,
            target_cited=target_cited_count > 0,
            mentions_count=len(mentions),
            citations_count=len(citations),
            target_citations_count=target_cited_count,
            mentions=mentions,
            citations=citations,
        )

    @classmethod
    def batch_process_query_set_detections(
        cls,
        db: Session,
        query_set_id: int,
        provider: str | None = None,
    ) -> list[DetectionResult]:
        """Runs mention & citation detection on all responses associated with a QuerySet."""
        stmt = select(AIResponse).where(AIResponse.query_set_id == query_set_id)
        if provider:
            stmt = stmt.where(AIResponse.provider == provider.lower().strip())
        responses = list(db.scalars(stmt).all())

        results: list[DetectionResult] = []
        for r in responses:
            try:
                res = cls.process_and_persist_detection(db=db, response_id=r.id)
                results.append(res)
            except Exception as exc:
                logger.error(f"Error processing detection for response {r.id}: {exc}")

        return results

    @classmethod
    def get_response_detection(
        cls,
        db: Session,
        response_id: int,
    ) -> DetectionResult | None:
        """Retrieves persisted mentions and citations for an AIResponse."""
        response = db.get(AIResponse, response_id)
        if not response:
            return None

        mentions_stmt = (
            select(AIMention)
            .where(AIMention.response_id == response_id)
            .order_by(AIMention.start_pos.asc())
        )
        db_mentions = list(db.scalars(mentions_stmt).all())

        citations_stmt = (
            select(AICitation)
            .where(AICitation.response_id == response_id)
            .order_by(AICitation.position.asc())
        )
        db_citations = list(db.scalars(citations_stmt).all())

        mentions = [
            DetectedMention(
                matched_text=m.matched_text,
                match_type=MentionType(m.match_type),
                normalized_text=m.normalized_text,
                start_pos=m.start_pos,
                end_pos=m.end_pos,
                context_snippet=m.context_snippet or "",
                confidence=m.confidence,
                entity_id=m.entity_id,
            )
            for m in db_mentions
        ]

        citations = [
            DetectedCitation(
                url=c.url,
                normalized_url=c.normalized_url,
                domain=c.domain,
                is_target_domain=c.is_target_domain,
                page_id=c.page_id,
                position=c.position,
                context_snippet=c.context_snippet,
                confidence=c.confidence,
            )
            for c in db_citations
        ]

        target_cited_count = sum(1 for c in citations if c.is_target_domain)
        return DetectionResult(
            response_id=response.id,
            query_id=response.query_id,
            website_id=response.website_id,
            provider=response.provider,
            target_mentioned=len(mentions) > 0,
            target_cited=target_cited_count > 0,
            mentions_count=len(mentions),
            citations_count=len(citations),
            target_citations_count=target_cited_count,
            mentions=mentions,
            citations=citations,
        )

    @classmethod
    def list_mentions(
        cls,
        db: Session,
        website_id: int | None = None,
        response_id: int | None = None,
        match_type: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AIMention]:
        """Lists historical AIMention records with optional filters."""
        stmt = select(AIMention)
        if website_id is not None:
            stmt = stmt.where(AIMention.website_id == website_id)
        if response_id is not None:
            stmt = stmt.where(AIMention.response_id == response_id)
        if match_type is not None:
            stmt = stmt.where(AIMention.match_type == match_type.upper().strip())
        stmt = stmt.order_by(AIMention.created_at.desc()).offset(offset).limit(limit)
        return list(db.scalars(stmt).all())

    @classmethod
    def list_citations(
        cls,
        db: Session,
        website_id: int | None = None,
        response_id: int | None = None,
        target_only: bool | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AICitation]:
        """Lists historical AICitation records with optional filters."""
        stmt = select(AICitation)
        if website_id is not None:
            stmt = stmt.where(AICitation.website_id == website_id)
        if response_id is not None:
            stmt = stmt.where(AICitation.response_id == response_id)
        if target_only is True:
            stmt = stmt.where(AICitation.is_target_domain.is_(True))
        elif target_only is False:
            stmt = stmt.where(AICitation.is_target_domain.is_(False))
        stmt = stmt.order_by(AICitation.created_at.desc()).offset(offset).limit(limit)
        return list(db.scalars(stmt).all())
