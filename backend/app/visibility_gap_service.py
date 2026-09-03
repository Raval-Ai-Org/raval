"""
Visibility Gap Analysis and Existing Finding Linkage Engine (Task 10 Step 5).
Evaluates deterministic, evidence-backed AI visibility gaps from Step 4 observations
and links them to existing Raval findings/opportunities without duplicating issue models.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import re
from typing import Any, Sequence

from sqlalchemy.orm import Session

from .models import (
    AIGapFindingLink,
    AIResponse,
    AIVisibilityGap,
    AIVisibilityObservation,
    Finding,
    Query,
    QuerySet,
)
from .visibility_signal_service import VisibilitySignalService


# ==========================================
# Enumerations & Dataclasses
# ==========================================


class GapType(str, Enum):
    TARGET_ABSENT = "TARGET_ABSENT"
    MENTION_WITHOUT_CITATION = "MENTION_WITHOUT_CITATION"
    COMPETITOR_PRESENT_TARGET_ABSENT = "COMPETITOR_PRESENT_TARGET_ABSENT"
    TARGET_CITED_NOT_RELEVANT = "TARGET_CITED_NOT_RELEVANT"
    INCONSISTENT_VISIBILITY = "INCONSISTENT_VISIBILITY"


class GapSeverity(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    NOT_EVALUABLE = "NOT_EVALUABLE"


class LinkMatchType(str, Enum):
    EXACT_QUESTION = "EXACT_QUESTION"
    SAME_PAGE = "SAME_PAGE"
    SAME_TOPIC = "SAME_TOPIC"
    SAME_ENTITY = "SAME_ENTITY"
    SAME_CATEGORY = "SAME_CATEGORY"
    LEXICAL_MATCH = "LEXICAL_MATCH"


@dataclass
class GapFindingLinkInfo:
    finding_id: int
    match_type: LinkMatchType
    confidence: float
    reasons: list[str] = field(default_factory=list)
    finding_title: str | None = None
    finding_category: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "finding_id": self.finding_id,
            "match_type": self.match_type.value,
            "confidence": round(self.confidence, 2),
            "reasons": self.reasons,
            "finding_title": self.finding_title,
            "finding_category": self.finding_category,
        }


@dataclass
class DetectedGap:
    gap_type: GapType
    severity: GapSeverity
    reason: str
    evidence: dict[str, Any] = field(default_factory=dict)
    linked_findings: list[GapFindingLinkInfo] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "gap_type": self.gap_type.value,
            "severity": self.severity.value,
            "reason": self.reason,
            "evidence": self.evidence,
            "linked_findings": [f.to_dict() for f in self.linked_findings],
        }


# ==========================================
# Helper Functions
# ==========================================


def is_evaluable_response(response: AIResponse) -> bool:
    """
    Determines if an AI response is valid and evaluable.
    Provider failures (TIMEOUT, RATE_LIMITED, UNAVAILABLE, ERROR) or empty texts
    are strictly NOT evaluable and must never produce visibility gaps.
    """
    if not response or not response.response_text:
        return False
    status = (response.status or "SUCCESS").upper()
    if status in ("TIMEOUT", "RATE_LIMITED", "UNAVAILABLE", "ERROR"):
        return False
    return True


def calculate_gap_severity(
    gap_type: GapType,
    query: Query,
    observation: AIVisibilityObservation,
) -> GapSeverity:
    """
    Deterministically computes the severity/priority of a visibility gap.
    """
    priority = getattr(query, "priority", "MEDIUM") or "MEDIUM"
    intent = (query.intent or "INFORMATIONAL").upper()

    if gap_type == GapType.COMPETITOR_PRESENT_TARGET_ABSENT:
        # If competitor is present and query is high priority or high commercial intent -> HIGH
        if priority == "HIGH" or intent in ("COMMERCIAL", "COMPARISON"):
            return GapSeverity.HIGH
        return GapSeverity.MEDIUM

    if gap_type == GapType.TARGET_ABSENT:
        if priority == "HIGH":
            return GapSeverity.HIGH
        elif priority == "LOW":
            return GapSeverity.LOW
        return GapSeverity.MEDIUM

    if gap_type == GapType.MENTION_WITHOUT_CITATION:
        if intent in ("COMMERCIAL", "COMPARISON") or priority == "HIGH":
            return GapSeverity.HIGH
        return GapSeverity.MEDIUM

    if gap_type == GapType.TARGET_CITED_NOT_RELEVANT:
        return GapSeverity.LOW

    return GapSeverity.MEDIUM


def evaluate_response_gaps(
    observation: AIVisibilityObservation,
    response: AIResponse,
    query: Query,
) -> list[DetectedGap]:
    """
    Evaluates provider-independent AI visibility gaps from Step 4 observation.
    Returns empty list if response failed or if target presence has no gaps.
    """
    if not is_evaluable_response(response):
        return []

    gaps: list[DetectedGap] = []

    # Common evidence payload
    obs_id = getattr(observation, "id", None)
    target_mentioned = bool(getattr(observation, "target_mentioned", False))
    target_cited = bool(getattr(observation, "target_cited", False))
    first_party_cited = bool(getattr(observation, "first_party_cited", False))
    competitors_present = bool(getattr(observation, "competitors_present", False))
    raw_count = getattr(observation, "competitor_count", 0)
    competitor_count = int(raw_count) if raw_count is not None else 0
    obs_mention_pos = getattr(observation, "observable_mention_position", None)
    relevant_answer = str(getattr(observation, "relevant_answer", "UNKNOWN") or "UNKNOWN")


    base_evidence = {
        "response_id": response.id,
        "query_id": query.id,
        "query_text": query.query_text,
        "provider": response.provider,
        "model": response.model,
        "observation_id": obs_id,
        "target_mentioned": target_mentioned,
        "target_cited": target_cited,
        "first_party_cited": first_party_cited,
        "competitor_count": competitor_count,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Rule 1: Competitor Present + Target Absent
    if competitors_present and not target_mentioned and not target_cited:
        sev = calculate_gap_severity(GapType.COMPETITOR_PRESENT_TARGET_ABSENT, query, observation)
        comp_evidence = (
            getattr(observation, "competitor_signals_json", None)
            or [c.to_dict() if hasattr(c, "to_dict") else c for c in getattr(observation, "competitors", [])]
            or []
        )
        evidence = {
            **base_evidence,
            "competitor_signals": comp_evidence,
        }
        gaps.append(
            DetectedGap(
                gap_type=GapType.COMPETITOR_PRESENT_TARGET_ABSENT,
                severity=sev,
                reason=(
                    f"Configured competitors ({competitor_count} detected) appear in "
                    f"the generative answer while target brand is completely absent."
                ),
                evidence=evidence,
            )
        )
    # Rule 2: Target Absent (without competitor present)
    elif not target_mentioned and not target_cited:
        sev = calculate_gap_severity(GapType.TARGET_ABSENT, query, observation)
        gaps.append(
            DetectedGap(
                gap_type=GapType.TARGET_ABSENT,
                severity=sev,
                reason="Target brand and domain are absent from the captured AI provider response.",
                evidence=base_evidence,
            )
        )

    # Rule 3: Mention Without Citation (Target mentioned in text, but 0 target citations)
    if target_mentioned and not target_cited:
        sev = calculate_gap_severity(GapType.MENTION_WITHOUT_CITATION, query, observation)
        evidence = {
            **base_evidence,
            "observable_mention_position": obs_mention_pos,
        }
        gaps.append(
            DetectedGap(
                gap_type=GapType.MENTION_WITHOUT_CITATION,
                severity=sev,
                reason=(
                    "Target brand is mentioned in the answer text, but no authoritative link or "
                    "citation to the target domain was cited by the AI provider."
                ),
                evidence=evidence,
            )
        )

    # Rule 4: Target Cited but Irrelevant Answer
    if target_cited and relevant_answer == "IRRELEVANT":
        sev = calculate_gap_severity(GapType.TARGET_CITED_NOT_RELEVANT, query, observation)
        gaps.append(
            DetectedGap(
                gap_type=GapType.TARGET_CITED_NOT_RELEVANT,
                severity=sev,
                reason=(
                    "Target domain was cited, but the response content was classified as irrelevant "
                    "or mismatched to the monitored query intent."
                ),
                evidence=base_evidence,
            )
        )


    return gaps


def _tokenize_text(text: str) -> set[str]:
    """Tokenizes text into lowercase alphanumeric tokens."""
    if not text:
        return set()
    return set(re.findall(r"\b[a-z0-9]+\b", text.lower()))


def match_gaps_to_existing_findings(
    db: Session,
    gaps: list[DetectedGap],
    website_id: int,
    query: Query,
) -> list[DetectedGap]:
    """
    Deterministically links visibility gaps to existing Finding records.
    Does NOT create duplicate findings.
    """
    if not gaps:
        return gaps

    # Load existing findings for this website
    findings: list[Finding] = (
        db.query(Finding)
        .filter(Finding.website_id == website_id)
        .all()
    )

    if not findings:
        return gaps

    query_tokens = _tokenize_text(query.query_text)
    query_page_id = getattr(query, "page_id", None)
    query_topic = (getattr(query, "topic", "") or "").lower()

    for gap in gaps:
        links: list[GapFindingLinkInfo] = []

        for f in findings:
            confidence = 0.0
            reasons: list[str] = []
            match_types: list[LinkMatchType] = []

            f_cat = (f.category or "").lower()
            f_title = f.title or ""
            f_desc = f.description or ""
            f_tokens = _tokenize_text(f_title + " " + f_desc)

            # 1. Exact / High Question Match
            q_overlap = len(query_tokens & f_tokens) / max(1, len(query_tokens))
            if q_overlap >= 0.70:
                confidence = max(confidence, 0.90)
                match_types.append(LinkMatchType.EXACT_QUESTION)
                reasons.append(f"Query text matches finding with {int(q_overlap*100)}% token overlap")

            # 2. Same Page Match
            if query_page_id and f.page_id and query_page_id == f.page_id:
                confidence = max(confidence, 0.85)
                match_types.append(LinkMatchType.SAME_PAGE)
                reasons.append(f"Linked to same crawled page (page_id={f.page_id})")

            # 3. Same Topic Match
            if query_topic and (query_topic in f_title.lower() or query_topic in f_desc.lower()):
                confidence = max(confidence, 0.80)
                match_types.append(LinkMatchType.SAME_TOPIC)
                reasons.append(f"Matches query topic: '{query_topic}'")

            # 4. Category Alignment
            if gap.gap_type == GapType.MENTION_WITHOUT_CITATION and f_cat in ("authority", "citation", "trust", "citations"):
                confidence = max(confidence, 0.75)
                match_types.append(LinkMatchType.SAME_CATEGORY)
                reasons.append(f"Finding category '{f.category}' addresses authority and citation acquisition")
            elif gap.gap_type in (GapType.TARGET_ABSENT, GapType.COMPETITOR_PRESENT_TARGET_ABSENT) and f_cat in ("content", "question", "questions", "gap", "aeo"):
                confidence = max(confidence, 0.70)
                match_types.append(LinkMatchType.SAME_CATEGORY)
                reasons.append(f"Finding category '{f.category}' addresses missing content/question coverage")
            elif f_cat in ("seo", "technical", "crawlability", "indexing"):
                if query_page_id and f.page_id == query_page_id:
                    confidence = max(confidence, 0.80)
                    match_types.append(LinkMatchType.SAME_CATEGORY)
                    reasons.append(f"Technical finding affecting discoverability of target page")

            # 5. General Lexical Overlap
            if not match_types and q_overlap >= 0.40:
                confidence = max(confidence, 0.55)
                match_types.append(LinkMatchType.LEXICAL_MATCH)
                reasons.append(f"Lexical match with finding title ({int(q_overlap*100)}% token overlap)")

            # If a valid match occurred with confidence >= 0.50, record the link
            if confidence >= 0.50 and match_types:
                primary_match_type = match_types[0]
                links.append(
                    GapFindingLinkInfo(
                        finding_id=f.id,
                        match_type=primary_match_type,
                        confidence=confidence,
                        reasons=reasons,
                        finding_title=f.title,
                        finding_category=f.category,
                    )
                )

        # Sort links by confidence descending, take top 5
        links.sort(key=lambda x: x.confidence, reverse=True)
        gap.linked_findings = links[:5]

    return gaps


# ==========================================
# Service Layer
# ==========================================


class VisibilityGapService:
    """
    Service for evaluating, persisting, and querying visibility gaps and finding linkages.
    """

    @staticmethod
    def process_and_persist_gaps(
        db: Session,
        response_id: int,
    ) -> list[AIVisibilityGap]:
        """
        Evaluates visibility gaps for an AIResponse, matches them to existing findings,
        and idempotently persists them in the database.
        """
        resp = db.get(AIResponse, response_id)
        if not resp:
            raise ValueError(f"AIResponse with ID {response_id} not found")

        # Ensure Step 4 observation is available
        obs_record = db.query(AIVisibilityObservation).filter(AIVisibilityObservation.response_id == response_id).first()
        if not obs_record:
            VisibilitySignalService.process_and_persist_observation(db, response_id)
            obs_record = db.query(AIVisibilityObservation).filter(AIVisibilityObservation.response_id == response_id).first()

        obs_id = obs_record.id if obs_record else None

        query = db.get(Query, resp.query_id)
        if not query:
            raise ValueError(f"Query with ID {resp.query_id} not found")

        # Provider failure safeguard: If response failed, no gaps are created
        if not is_evaluable_response(resp):
            # Clean up any stale gaps for this response if it was re-executed with failure
            db.query(AIVisibilityGap).filter(AIVisibilityGap.response_id == response_id).delete(synchronize_session=False)
            db.commit()
            return []

        # 1. Evaluate gaps
        detected_gaps = evaluate_response_gaps(
            observation=obs_record,
            response=resp,
            query=query,
        )

        # 2. Match with existing findings
        detected_gaps = match_gaps_to_existing_findings(
            db=db,
            gaps=detected_gaps,
            website_id=resp.website_id,
            query=query,
        )

        # 3. Idempotently clear existing gaps for this response_id
        existing_gaps = db.query(AIVisibilityGap).filter(AIVisibilityGap.response_id == response_id).all()
        for eg in existing_gaps:
            db.delete(eg)
        db.flush()


        persisted_gaps: list[AIVisibilityGap] = []
        for d_gap in detected_gaps:
            gap_record = AIVisibilityGap(
                response_id=resp.id,
                observation_id=obs_id,
                query_id=query.id,
                query_set_id=resp.query_set_id,
                website_id=resp.website_id,
                gap_type=d_gap.gap_type.value,
                severity=d_gap.severity.value,
                reason=d_gap.reason,
                evidence_json=d_gap.evidence,
                created_at=datetime.now(timezone.utc),
            )

            db.add(gap_record)
            db.flush()

            # Persist finding links
            for link in d_gap.linked_findings:
                link_record = AIGapFindingLink(
                    gap_id=gap_record.id,
                    finding_id=link.finding_id,
                    match_type=link.match_type.value,
                    confidence=link.confidence,
                    reasons_json=link.reasons,
                    created_at=datetime.now(timezone.utc),
                )
                db.add(link_record)

            persisted_gaps.append(gap_record)

        db.commit()
        for g in persisted_gaps:
            db.refresh(g)

        return persisted_gaps

    @staticmethod
    def batch_process_query_set_gaps(
        db: Session,
        query_set_id: int,
    ) -> list[AIVisibilityGap]:
        """
        Evaluates and persists visibility gaps across all responses in a QuerySet.
        """
        qs = db.get(QuerySet, query_set_id)
        if not qs:
            raise ValueError(f"QuerySet with ID {query_set_id} not found")

        responses = (
            db.query(AIResponse)
            .filter(AIResponse.query_set_id == query_set_id)
            .all()
        )

        all_gaps: list[AIVisibilityGap] = []
        for resp in responses:
            gaps = VisibilityGapService.process_and_persist_gaps(db, resp.id)
            all_gaps.extend(gaps)

        return all_gaps

    @staticmethod
    def get_response_gaps(
        db: Session,
        response_id: int,
    ) -> list[AIVisibilityGap]:
        """Retrieves persisted visibility gaps for an AIResponse."""
        return (
            db.query(AIVisibilityGap)
            .filter(AIVisibilityGap.response_id == response_id)
            .all()
        )

    @staticmethod
    def list_gaps(
        db: Session,
        query_set_id: int | None = None,
        query_id: int | None = None,
        website_id: int | None = None,
        gap_type: str | None = None,
        severity: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AIVisibilityGap]:
        """Lists visibility gaps with optional filtering."""
        q = db.query(AIVisibilityGap)
        if query_set_id is not None:
            q = q.filter(AIVisibilityGap.query_set_id == query_set_id)
        if query_id is not None:
            q = q.filter(AIVisibilityGap.query_id == query_id)
        if website_id is not None:
            q = q.filter(AIVisibilityGap.website_id == website_id)
        if gap_type is not None:
            q = q.filter(AIVisibilityGap.gap_type == gap_type)
        if severity is not None:
            q = q.filter(AIVisibilityGap.severity == severity)

        return q.order_by(AIVisibilityGap.created_at.desc()).offset(offset).limit(limit).all()

    @staticmethod
    def get_gap_details(
        db: Session,
        gap_id: int,
    ) -> AIVisibilityGap | None:
        """Retrieves a single gap with loaded finding links."""
        return db.get(AIVisibilityGap, gap_id)

    @staticmethod
    def get_finding_linked_gaps(
        db: Session,
        finding_id: int,
    ) -> list[AIVisibilityGap]:
        """Retrieves all visibility gaps linked to a specific Finding."""
        links = (
            db.query(AIGapFindingLink)
            .filter(AIGapFindingLink.finding_id == finding_id)
            .all()
        )
        gap_ids = [l.gap_id for l in links]
        if not gap_ids:
            return []
        return (
            db.query(AIVisibilityGap)
            .filter(AIVisibilityGap.id.in_(gap_ids))
            .all()
        )
