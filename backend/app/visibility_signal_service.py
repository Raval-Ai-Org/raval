"""
Visibility & Competitor Signal Engine (Task 10 Step 4).

Consumes normalized Step 3 mention and citation evidence to produce
deterministic, provider-independent AI visibility observations and
competitor presence signals with full auditability and false-positive safety.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .mention_citation_service import (
    COMMON_GENERIC_WORDS,
    MentionCitationService,
    extract_context_snippet,
    extract_domain_from_url,
)
from .models import (
    AICitation,
    AIMention,
    AIResponse,
    AIVisibilityObservation,
    Entity,
    Query,
    Website,
)

logger = logging.getLogger(__name__)


# ==========================================
# 1. Dataclasses & Structures
# ==========================================


@dataclass
class CompetitorConfig:
    """Configured competitor identity definition."""
    name: str
    domain: str | None = None
    aliases: list[str] = field(default_factory=list)
    entity_id: int | None = None


@dataclass
class CompetitorSignal:
    """Detected competitor mention or citation presence."""
    competitor_name: str
    domain: str | None = None
    entity_id: int | None = None
    mentioned: bool = False
    cited: bool = False
    mention_count: int = 0
    citation_count: int = 0
    first_mention_position: int | None = None
    first_citation_position: int | None = None
    evidence_snippets: list[str] = field(default_factory=list)
    confidence: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "competitor_name": self.competitor_name,
            "domain": self.domain,
            "entity_id": self.entity_id,
            "mentioned": self.mentioned,
            "cited": self.cited,
            "mention_count": self.mention_count,
            "citation_count": self.citation_count,
            "first_mention_position": self.first_mention_position,
            "first_citation_position": self.first_citation_position,
            "evidence_snippets": self.evidence_snippets,
            "confidence": self.confidence,
        }


@dataclass
class VisibilityObservation:
    """Consolidated provider-independent visibility observation for an AIResponse."""
    response_id: int
    query_id: int
    query_set_id: int
    website_id: int
    provider: str
    model: str
    target_mentioned: bool
    target_cited: bool
    first_party_cited: bool
    relevant_answer: str  # "RELEVANT", "IRRELEVANT", "UNKNOWN"
    observable_mention_position: int | None
    observable_citation_position: int | None
    confidence: float
    competitor_count: int
    competitors_present: bool
    competitors: list[CompetitorSignal] = field(default_factory=list)
    evidence_summary: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "response_id": self.response_id,
            "query_id": self.query_id,
            "query_set_id": self.query_set_id,
            "website_id": self.website_id,
            "provider": self.provider,
            "model": self.model,
            "target_mentioned": self.target_mentioned,
            "target_cited": self.target_cited,
            "first_party_cited": self.first_party_cited,
            "relevant_answer": self.relevant_answer,
            "observable_mention_position": self.observable_mention_position,
            "observable_citation_position": self.observable_citation_position,
            "confidence": self.confidence,
            "competitor_count": self.competitor_count,
            "competitors_present": self.competitors_present,
            "competitors": [c.to_dict() for c in self.competitors],
            "evidence_summary": self.evidence_summary,
        }


# ==========================================
# 2. Helper Functions
# ==========================================


def calculate_observable_positions(
    mentions: list[AIMention],
    citations: list[AICitation],
) -> tuple[int | None, int | None]:
    """
    Derives earliest observable mention character position and earliest
    citation 1-indexed order from Step 3 evidence.
    """
    mention_pos: int | None = None
    valid_starts = [m.start_pos for m in mentions if m.start_pos is not None]
    if valid_starts:
        mention_pos = min(valid_starts)

    citation_pos: int | None = None
    target_cites = [c.position for c in citations if c.is_target_domain and c.position is not None]
    if target_cites:
        citation_pos = min(target_cites)

    return mention_pos, citation_pos


def classify_answer_relevance(
    query_text: str,
    response_text: str,
    target_mentioned: bool,
    target_cited: bool,
    mentions: list[AIMention],
) -> str:
    """
    Deterministically evaluates whether the captured response is relevant
    to the target brand/entity in context of the query.
    Returns: 'RELEVANT', 'IRRELEVANT', or 'UNKNOWN'.
    """
    if not target_mentioned and not target_cited:
        return "IRRELEVANT"

    if not response_text or not response_text.strip():
        return "UNKNOWN"

    # If target is mentioned or cited in response text
    clean_resp = response_text.lower()
    clean_query = query_text.lower() if query_text else ""

    # Extract query keywords (>3 chars, non-stopwords)
    stopwords = {"what", "which", "when", "where", "how", "does", "with", "that", "this", "from", "the", "are", "for"}
    query_tokens = [w for w in re.findall(r"\b[a-z0-9-]+\b", clean_query) if w not in stopwords and len(w) >= 3]

    if not query_tokens:
        return "RELEVANT" if (target_mentioned or target_cited) else "UNKNOWN"

    # Check if response text answers query concepts
    matched_tokens = sum(1 for token in query_tokens if token in clean_resp)
    overlap_ratio = matched_tokens / max(1, len(query_tokens))

    if overlap_ratio >= 0.3:
        return "RELEVANT"
    elif overlap_ratio > 0:
        return "RELEVANT"
    else:
        return "UNKNOWN"


def detect_competitor_signals(
    response_text: str,
    citations: list[AICitation],
    competitors: list[CompetitorConfig],
) -> list[CompetitorSignal]:
    """
    Detects configured competitors within response text and non-target citations.
    Uses strict false-positive protections (word boundaries, common-word guards).
    """
    if not competitors:
        return []

    signals: list[CompetitorSignal] = []

    for comp in competitors:
        comp_name = comp.name.strip()
        if not comp_name or len(comp_name) < 2:
            continue

        is_generic = comp_name.lower() in COMMON_GENERIC_WORDS
        flags = 0 if is_generic else re.IGNORECASE
        pattern = re.compile(r"\b" + re.escape(comp_name) + r"\b", flags=flags)

        mention_matches = list(pattern.finditer(response_text)) if response_text else []
        mention_count = len(mention_matches)
        first_mention_pos = mention_matches[0].start() if mention_matches else None

        evidence_snippets: list[str] = []
        for m in mention_matches[:3]:
            s, e = m.span()
            evidence_snippets.append(extract_context_snippet(response_text, s, e))

        # Check aliases
        for alias in comp.aliases:
            alias_clean = alias.strip()
            if alias_clean and len(alias_clean) >= 2:
                alias_generic = alias_clean.lower() in COMMON_GENERIC_WORDS
                alias_flags = 0 if alias_generic else re.IGNORECASE
                alias_pattern = re.compile(r"\b" + re.escape(alias_clean) + r"\b", flags=alias_flags)
                for am in alias_pattern.finditer(response_text):
                    mention_count += 1
                    if first_mention_pos is None or am.start() < first_mention_pos:
                        first_mention_pos = am.start()
                    s, e = am.span()
                    if len(evidence_snippets) < 3:
                        evidence_snippets.append(extract_context_snippet(response_text, s, e))

        # Check citations
        comp_domain = comp.domain.strip().lower() if comp.domain else None
        cited_count = 0
        first_cite_pos: int | None = None

        for c in citations:
            if c.is_target_domain:
                continue
            cite_domain = extract_domain_from_url(c.url)
            is_comp_cite = False
            if comp_domain and cite_domain and (cite_domain == comp_domain or cite_domain.endswith("." + comp_domain)):
                is_comp_cite = True
            elif comp_name.lower() in cite_domain:
                is_comp_cite = True

            if is_comp_cite:
                cited_count += 1
                if first_cite_pos is None or c.position < first_cite_pos:
                    first_cite_pos = c.position
                if c.context_snippet and len(evidence_snippets) < 4:
                    evidence_snippets.append(f"Citation [{c.url}]: {c.context_snippet}")

        if mention_count > 0 or cited_count > 0:
            signals.append(
                CompetitorSignal(
                    competitor_name=comp_name,
                    domain=comp.domain,
                    entity_id=comp.entity_id,
                    mentioned=mention_count > 0,
                    cited=cited_count > 0,
                    mention_count=mention_count,
                    citation_count=cited_count,
                    first_mention_position=first_mention_pos,
                    first_citation_position=first_cite_pos,
                    evidence_snippets=evidence_snippets,
                    confidence=0.95 if is_generic else 1.0,
                )
            )

    return signals


# ==========================================
# 3. Service Layer
# ==========================================


class VisibilitySignalService:
    """
    Central service deriving visibility observations and competitor signals
    from Step 3 detection evidence and persisting them in `ai_visibility_observations`.
    """

    @classmethod
    def build_competitor_profiles(
        cls,
        db: Session,
        website_id: int,
        custom_competitors: list[dict[str, Any]] | None = None,
    ) -> list[CompetitorConfig]:
        """
        Builds configured competitor identities from database entities and custom input.
        """
        configs: list[CompetitorConfig] = []
        seen_names: set[str] = set()

        # 1. Load competitor entities from database
        stmt = select(Entity).where(
            Entity.website_id == website_id,
            Entity.entity_type.in_(["competitor", "competitor_brand", "competitor_product"]),
        )
        entities = list(db.scalars(stmt).all())

        for ent in entities:
            name = ent.name.strip()
            if name and name.lower() not in seen_names:
                domain = None
                aliases = []
                if isinstance(ent.properties, dict):
                    domain = ent.properties.get("domain")
                    raw_aliases = ent.properties.get("aliases", [])
                    if isinstance(raw_aliases, list):
                        aliases = [str(a) for a in raw_aliases]
                configs.append(
                    CompetitorConfig(
                        name=name,
                        domain=domain,
                        aliases=aliases,
                        entity_id=ent.id,
                    )
                )
                seen_names.add(name.lower())

        # 2. Add custom competitors from request if provided
        if custom_competitors:
            for cc in custom_competitors:
                if isinstance(cc, dict):
                    name = str(cc.get("name", "")).strip()
                    if name and name.lower() not in seen_names:
                        configs.append(
                            CompetitorConfig(
                                name=name,
                                domain=cc.get("domain"),
                                aliases=list(cc.get("aliases", [])),
                                entity_id=cc.get("entity_id"),
                            )
                        )
                        seen_names.add(name.lower())
                elif isinstance(cc, str):
                    name = cc.strip()
                    if name and name.lower() not in seen_names:
                        configs.append(CompetitorConfig(name=name))
                        seen_names.add(name.lower())

        return configs

    @classmethod
    def evaluate_visibility_observation(
        cls,
        response: AIResponse,
        mentions: list[AIMention],
        citations: list[AICitation],
        query: Query | None,
        competitors: list[CompetitorConfig],
    ) -> VisibilityObservation:
        """
        Pure evaluation logic constructing a VisibilityObservation from evidence.
        """
        target_mentioned = len(mentions) > 0
        target_cited = any(c.is_target_domain for c in citations)
        first_party_cited = target_cited

        mention_pos, citation_pos = calculate_observable_positions(mentions, citations)

        query_text = query.query_text if query else ""
        relevance = classify_answer_relevance(
            query_text=query_text,
            response_text=response.response_text,
            target_mentioned=target_mentioned,
            target_cited=target_cited,
            mentions=mentions,
        )

        competitor_signals = detect_competitor_signals(
            response_text=response.response_text,
            citations=citations,
            competitors=competitors,
        )

        # Calculate bounded confidence
        confidence = 1.0
        if target_mentioned:
            confidence = min(m.confidence for m in mentions)
        elif target_cited:
            confidence = min((c.confidence for c in citations if c.is_target_domain), default=1.0)

        # Assemble evidence summary for auditability
        evidence_summary = {
            "response_id": response.id,
            "query_id": response.query_id,
            "provider": response.provider,
            "model": response.model,
            "mention_ids": [m.id for m in mentions if m.id is not None],
            "target_citation_ids": [c.id for c in citations if c.is_target_domain and c.id is not None],
            "external_citation_count": sum(1 for c in citations if not c.is_target_domain),
            "relevance_basis": relevance,
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
        }

        return VisibilityObservation(
            response_id=response.id,
            query_id=response.query_id,
            query_set_id=response.query_set_id,
            website_id=response.website_id,
            provider=response.provider,
            model=response.model,
            target_mentioned=target_mentioned,
            target_cited=target_cited,
            first_party_cited=first_party_cited,
            relevant_answer=relevance,
            observable_mention_position=mention_pos,
            observable_citation_position=citation_pos,
            confidence=confidence,
            competitor_count=len(competitor_signals),
            competitors_present=len(competitor_signals) > 0,
            competitors=competitor_signals,
            evidence_summary=evidence_summary,
        )

    @classmethod
    def process_and_persist_observation(
        cls,
        db: Session,
        response_id: int,
        custom_competitors: list[dict[str, Any]] | None = None,
    ) -> VisibilityObservation:
        """
        Loads AIResponse, ensures Step 3 mention & citation detections are present,
        evaluates visibility and competitor signals, and persists AIVisibilityObservation.
        """
        response = db.get(AIResponse, response_id)
        if not response:
            raise ValueError(f"AIResponse with id {response_id} not found.")

        # Ensure mentions & citations exist; if not, run detection first
        mentions_stmt = select(AIMention).where(AIMention.response_id == response_id)
        mentions = list(db.scalars(mentions_stmt).all())

        citations_stmt = select(AICitation).where(AICitation.response_id == response_id)
        citations = list(db.scalars(citations_stmt).all())

        if not mentions and not citations and response.response_text:
            # Trigger detection
            MentionCitationService.process_and_persist_detection(db=db, response_id=response_id)
            mentions = list(db.scalars(mentions_stmt).all())
            citations = list(db.scalars(citations_stmt).all())

        query = db.get(Query, response.query_id)
        competitors = cls.build_competitor_profiles(
            db=db,
            website_id=response.website_id,
            custom_competitors=custom_competitors,
        )

        obs = cls.evaluate_visibility_observation(
            response=response,
            mentions=mentions,
            citations=citations,
            query=query,
            competitors=competitors,
        )

        # Upsert AIVisibilityObservation record
        existing = db.scalars(
            select(AIVisibilityObservation).where(AIVisibilityObservation.response_id == response_id)
        ).first()

        competitor_json = [c.to_dict() for c in obs.competitors]

        if existing:
            existing.target_mentioned = obs.target_mentioned
            existing.target_cited = obs.target_cited
            existing.first_party_cited = obs.first_party_cited
            existing.relevant_answer = obs.relevant_answer
            existing.observable_mention_position = obs.observable_mention_position
            existing.observable_citation_position = obs.observable_citation_position
            existing.confidence = obs.confidence
            existing.competitor_count = obs.competitor_count
            existing.competitors_present = obs.competitors_present
            existing.competitor_signals_json = competitor_json
            existing.evidence_summary_json = obs.evidence_summary
        else:
            db_obs = AIVisibilityObservation(
                response_id=response.id,
                query_id=response.query_id,
                query_set_id=response.query_set_id,
                website_id=response.website_id,
                provider=response.provider,
                model=response.model,
                target_mentioned=obs.target_mentioned,
                target_cited=obs.target_cited,
                first_party_cited=obs.first_party_cited,
                relevant_answer=obs.relevant_answer,
                observable_mention_position=obs.observable_mention_position,
                observable_citation_position=obs.observable_citation_position,
                confidence=obs.confidence,
                competitor_count=obs.competitor_count,
                competitors_present=obs.competitors_present,
                competitor_signals_json=competitor_json,
                evidence_summary_json=obs.evidence_summary,
                created_at=datetime.now(timezone.utc),
            )
            db.add(db_obs)

        db.commit()
        return obs

    @classmethod
    def batch_process_query_set_visibility(
        cls,
        db: Session,
        query_set_id: int,
        provider: str | None = None,
        custom_competitors: list[dict[str, Any]] | None = None,
    ) -> list[VisibilityObservation]:
        """
        Batch evaluates and persists visibility observations across all responses in a QuerySet.
        """
        stmt = select(AIResponse).where(AIResponse.query_set_id == query_set_id)
        if provider:
            stmt = stmt.where(AIResponse.provider == provider.lower().strip())
        responses = list(db.scalars(stmt).all())

        results: list[VisibilityObservation] = []
        for r in responses:
            try:
                obs = cls.process_and_persist_observation(
                    db=db,
                    response_id=r.id,
                    custom_competitors=custom_competitors,
                )
                results.append(obs)
            except Exception as exc:
                logger.error(f"Error evaluating visibility for response {r.id}: {exc}")

        return results

    @classmethod
    def get_visibility_observation(
        cls,
        db: Session,
        response_id: int,
    ) -> VisibilityObservation | None:
        """Retrieves an existing visibility observation by response ID."""
        record = db.scalars(
            select(AIVisibilityObservation).where(AIVisibilityObservation.response_id == response_id)
        ).first()
        if not record:
            return None

        competitors = []
        if isinstance(record.competitor_signals_json, list):
            for c in record.competitor_signals_json:
                if isinstance(c, dict):
                    competitors.append(
                        CompetitorSignal(
                            competitor_name=c.get("competitor_name", ""),
                            domain=c.get("domain"),
                            entity_id=c.get("entity_id"),
                            mentioned=bool(c.get("mentioned", False)),
                            cited=bool(c.get("cited", False)),
                            mention_count=int(c.get("mention_count", 0)),
                            citation_count=int(c.get("citation_count", 0)),
                            first_mention_position=c.get("first_mention_position"),
                            first_citation_position=c.get("first_citation_position"),
                            evidence_snippets=list(c.get("evidence_snippets", [])),
                            confidence=float(c.get("confidence", 1.0)),
                        )
                    )

        return VisibilityObservation(
            response_id=record.response_id,
            query_id=record.query_id,
            query_set_id=record.query_set_id,
            website_id=record.website_id,
            provider=record.provider,
            model=record.model,
            target_mentioned=record.target_mentioned,
            target_cited=record.target_cited,
            first_party_cited=record.first_party_cited,
            relevant_answer=record.relevant_answer or "UNKNOWN",
            observable_mention_position=record.observable_mention_position,
            observable_citation_position=record.observable_citation_position,
            confidence=record.confidence,
            competitor_count=record.competitor_count,
            competitors_present=record.competitors_present,
            competitors=competitors,
            evidence_summary=record.evidence_summary_json if isinstance(record.evidence_summary_json, dict) else {},
        )

    @classmethod
    def list_visibility_observations(
        cls,
        db: Session,
        website_id: int | None = None,
        query_set_id: int | None = None,
        query_id: int | None = None,
        provider: str | None = None,
        target_mentioned: bool | None = None,
        target_cited: bool | None = None,
        competitors_present: bool | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AIVisibilityObservation]:
        """Lists historical visibility observations with rich filtering."""
        stmt = select(AIVisibilityObservation)
        if website_id is not None:
            stmt = stmt.where(AIVisibilityObservation.website_id == website_id)
        if query_set_id is not None:
            stmt = stmt.where(AIVisibilityObservation.query_set_id == query_set_id)
        if query_id is not None:
            stmt = stmt.where(AIVisibilityObservation.query_id == query_id)
        if provider is not None:
            stmt = stmt.where(AIVisibilityObservation.provider == provider.lower().strip())
        if target_mentioned is not None:
            stmt = stmt.where(AIVisibilityObservation.target_mentioned.is_(target_mentioned))
        if target_cited is not None:
            stmt = stmt.where(AIVisibilityObservation.target_cited.is_(target_cited))
        if competitors_present is not None:
            stmt = stmt.where(AIVisibilityObservation.competitors_present.is_(competitors_present))

        stmt = stmt.order_by(AIVisibilityObservation.created_at.desc()).offset(offset).limit(limit)
        return list(db.scalars(stmt).all())

    @classmethod
    def get_competitor_signals(
        cls,
        db: Session,
        response_id: int,
    ) -> list[CompetitorSignal]:
        """Returns detected competitor signals for a specific response."""
        obs = cls.get_visibility_observation(db, response_id)
        if not obs:
            return []
        return obs.competitors
