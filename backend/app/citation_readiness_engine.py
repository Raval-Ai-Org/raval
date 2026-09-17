"""
Citation-Readiness Engine (Day 8 - Phase B - Step 9 ONLY)

Synthesizes structural evidence across all foundational engines:
1. Trust Signals (Step 3)
2. Authority Signals (Step 4)
3. External Source Detection (Step 5)
4. Claim Support & Associations (Step 6)
5. Source Quality & Reachability (Step 7)
6. First-Party Transparency (Step 8)

Produces deterministic, structural citation-readiness indicators:
- Readiness tier (High, Moderate, Low)
- Positive structural signals & negative structural gaps
- Claim-to-source coverage ratios
- Verifiable primary source presence
- Transparent first-party attribution

Strict architectural rules:
- Structural readiness only: Does NOT promise or guarantee AI citations or search rankings.
- Does NOT assert factual truth of content.
- Reuses CitationReadinessContract and AuthorityCitationTrustResult from Step 2.
- Master envelope aggregator for the complete Authority, Citation & Trust Intelligence system.
"""

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .authority_citation_schemas import (
    AuthorityCitationTrustResult,
    CitationReadinessContract,
    ConfidenceLevel,
    ExternalSourceContract,
    SeverityLevel,
    SourceAssociationContract,
    SupportNeededClaimContract,
    TrustSignalContract,
)
from .schemas import FindingCreate, RecommendationCreate


class CitationReadinessResult(BaseModel):
    """
    Structured evaluation result produced by the Citation-Readiness Engine.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    page_id: int | None = Field(default=None, description="Page ID if analyzed from database")
    url: str | None = Field(default=None, description="URL of the analyzed page")
    citation_readiness: CitationReadinessContract = Field(..., description="Canonical structural citation readiness contract")
    findings: list[FindingCreate] = Field(default_factory=list, description="Actionable findings regarding citation readiness")
    recommendations: list[RecommendationCreate] = Field(default_factory=list, description="Actionable recommendations")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Evaluation metadata")


class CitationReadinessEngine:
    """
    Deterministic Citation-Readiness Engine (Step 9).
    Combines outputs from Steps 3–8 to evaluate overall structural readiness
    and generate the top-level AuthorityCitationTrustResult envelope.
    """

    def evaluate(
        self,
        trust_result: Any | None = None,
        authority_result: Any | None = None,
        source_result: Any | None = None,
        claim_support_result: Any | None = None,
        source_quality_result: Any | None = None,
        transparency_result: Any | None = None,
        page_url: str | None = None,
        page_id: int | None = None,
    ) -> CitationReadinessResult:
        """
        Main deterministic evaluation routine combining multi-engine evidence.
        """
        positive_signals: list[str] = []
        negative_signals: list[str] = []
        structural_indicators: dict[str, Any] = {}

        # 1. Source Metrics
        sources: list[Any] = getattr(source_result, "sources", []) if source_result else []
        total_sources = len(sources)
        citation_candidates = [s for s in sources if getattr(s, "is_citation_candidate", False)]
        has_verifiable_sources = len(citation_candidates) > 0

        if has_verifiable_sources:
            positive_signals.append(f"Identified {len(citation_candidates)} verifiable external source / citation candidate(s).")
        else:
            negative_signals.append("No verifiable external reference sources or citation candidates detected.")

        # 2. Source Quality
        high_quality_sources = getattr(source_quality_result, "high_quality_sources_count", 0) if source_quality_result else 0
        broken_sources = getattr(source_quality_result, "broken_or_inaccessible_sources_count", 0) if source_quality_result else 0
        weak_sources = getattr(source_quality_result, "weak_sources_count", 0) if source_quality_result else 0

        if high_quality_sources > 0:
            positive_signals.append(f"Detected {high_quality_sources} primary research, DOI, or institutional repository citation(s).")
        if broken_sources > 0:
            negative_signals.append(f"Contains {broken_sources} broken or inaccessible reference link(s).")
        if weak_sources >= 2:
            negative_signals.append(f"Contains {weak_sources} citation link(s) with weak or non-descriptive anchor text.")

        # 3. Claims & Support Coverage
        claims: list[Any] = getattr(claim_support_result, "claims", []) if claim_support_result else []
        total_claims = len(claims)
        supported_claims = getattr(claim_support_result, "supported_claims_count", 0) if claim_support_result else 0
        unsupported_claims = getattr(claim_support_result, "unsupported_claims_count", 0) if claim_support_result else 0

        coverage_ratio = (supported_claims / total_claims) if total_claims > 0 else 1.0

        if total_claims > 0 and supported_claims == total_claims:
            positive_signals.append("All detected empirical and support-needed claims are corroborated by external source links.")
        elif supported_claims > 0:
            positive_signals.append(f"Associated {supported_claims} of {total_claims} detected support-needed claim(s) with external citations.")
        elif total_claims > 0:
            negative_signals.append(f"Detected {total_claims} potentially support-needed claim(s) without associated external source citations.")

        # 4. Authority & Topical Substance
        is_shallow_depth = False
        if authority_result:
            auth_detected = getattr(authority_result, "detected_signals_count", 0)
            topical_depth_sig = next((s for s in getattr(authority_result, "topical_depth_signals", []) if s.signal_id == "authority_topical_depth"), None)
            if topical_depth_sig and topical_depth_sig.status in ("weak", "missing"):
                is_shallow_depth = True
                negative_signals.append("Content exhibits shallow topical depth or insufficient heading structure.")
            elif auth_detected >= 4:
                positive_signals.append("Content exhibits substantial topical depth and structured heading hierarchy.")
            elif getattr(authority_result, "missing_signals_count", 0) >= 3:
                negative_signals.append("Authority gaps: missing scholarly schema, credentials, or methodology attribution.")

        # 5. First-Party Transparency
        is_transparent = False
        if transparency_result:
            is_transparent = getattr(transparency_result, "is_transparent", False)
            if is_transparent:
                positive_signals.append("First-party organizational identity, author attribution, and direct contact channels verified.")
            else:
                negative_signals.append("First-party transparency gaps: missing author attribution, organization identity, or contact channels.")
        elif trust_result:
            trust_detected = getattr(trust_result, "detected_signals_count", 0)
            if trust_detected >= 3:
                positive_signals.append("First-party trust and identity signals detected.")

        # Determine Readiness Tier
        has_citation_candidates = len(citation_candidates) > 0 or has_verifiable_sources

        if (
            has_verifiable_sources
            and high_quality_sources >= 1
            and broken_sources == 0
            and (unsupported_claims == 0 or coverage_ratio >= 0.5)
        ):
            readiness_level = "high"
        elif has_verifiable_sources and broken_sources == 0:
            readiness_level = "moderate"
        elif has_citation_candidates and broken_sources == 0 and not is_shallow_depth:
            readiness_level = "moderate"
        elif total_sources > 0 and broken_sources == 0 and total_claims == 0 and not is_shallow_depth:
            readiness_level = "moderate"
        else:
            readiness_level = "low"

        structural_indicators = {
            "has_verifiable_sources": has_verifiable_sources,
            "total_external_sources": total_sources,
            "total_citation_candidates": len(citation_candidates),
            "high_quality_sources_count": high_quality_sources,
            "broken_sources_count": broken_sources,
            "total_claims_detected": total_claims,
            "supported_claims_count": supported_claims,
            "unsupported_claims_count": unsupported_claims,
            "claims_coverage_ratio": round(coverage_ratio, 2),
            "is_transparent": is_transparent,
        }

        contract = CitationReadinessContract(
            readiness_level=readiness_level,
            has_verifiable_sources=has_verifiable_sources,
            total_external_sources=total_sources,
            total_claims_detected=total_claims,
            supported_claims_count=supported_claims,
            unsupported_claims_count=unsupported_claims,
            positive_signals=positive_signals,
            negative_signals=negative_signals,
            structural_indicators=structural_indicators,
            evidence={
                "evaluated_at": datetime.now(timezone.utc).isoformat(),
                "indicators": structural_indicators,
            },
        )

        findings: list[FindingCreate] = []
        recommendations: list[RecommendationCreate] = []

        if readiness_level == "low":
            findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="low_structural_citation_readiness",
                    category="authority",
                    title="Low Structural Citation Readiness",
                    description="The content lacks verifiable external reference citations for empirical claims and exhibits transparency gaps.",
                    severity="high" if total_claims > 0 else "medium",
                    status="open",
                    evidence={"negative_signals": negative_signals},
                )
            )
            recommendations.append(
                RecommendationCreate(
                    title="Enhance Structural Citation Readiness and Source Backing",
                    description="Attach high-quality external primary sources or DOI links to empirical claims and complete first-party author disclosures.",
                    priority="high" if total_claims > 0 else "medium",
                    status="open",
                    action_type="enhance_citation_readiness",
                )
            )

        return CitationReadinessResult(
            page_id=page_id,
            url=page_url,
            citation_readiness=contract,
            findings=findings,
            recommendations=recommendations,
            metadata={
                "engine": "CitationReadinessEngine",
                "version": "1.0.0",
                "evaluated_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    def build_unified_result(
        self,
        page_url: str | None = None,
        page_id: int | None = None,
        scan_id: int | None = None,
        website_id: int | None = None,
        trust_result: Any | None = None,
        authority_result: Any | None = None,
        source_result: Any | None = None,
        claim_support_result: Any | None = None,
        source_quality_result: Any | None = None,
        transparency_result: Any | None = None,
    ) -> AuthorityCitationTrustResult:
        """
        Builds the unified, top-level AuthorityCitationTrustResult envelope synthesizing all engines.
        """
        eval_result = self.evaluate(
            trust_result=trust_result,
            authority_result=authority_result,
            source_result=source_result,
            claim_support_result=claim_support_result,
            source_quality_result=source_quality_result,
            transparency_result=transparency_result,
            page_url=page_url,
            page_id=page_id,
        )

        # Aggregate Trust Signals
        all_trust_signals: list[TrustSignalContract] = []
        if trust_result:
            all_trust_signals.extend(getattr(trust_result, "trust_signals", []))
        if transparency_result:
            all_trust_signals.extend(getattr(transparency_result, "transparency_signals", []))

        # Authority Signals
        auth_signals = getattr(authority_result, "authority_signals", []) if authority_result else []

        # Sources
        sources = getattr(source_result, "sources", []) if source_result else []

        # Claims & Associations
        claims = getattr(claim_support_result, "claims", []) if claim_support_result else []
        associations = getattr(claim_support_result, "source_associations", []) if claim_support_result else []

        # Collect and Deduplicate Findings
        all_findings: list[FindingCreate] = []
        seen_finding_types: set[str] = set()

        for res_obj in (trust_result, authority_result, source_result, claim_support_result, source_quality_result, transparency_result, eval_result):
            if res_obj:
                for f in getattr(res_obj, "findings", []):
                    ftype = getattr(f, "finding_type", None)
                    if ftype and ftype not in seen_finding_types:
                        all_findings.append(f)
                        seen_finding_types.add(ftype)

        # Collect and Deduplicate Recommendations
        all_recs: list[RecommendationCreate] = []
        seen_rec_actions: set[str] = set()

        for res_obj in (trust_result, authority_result, source_result, claim_support_result, source_quality_result, transparency_result, eval_result):
            if res_obj:
                for r in getattr(res_obj, "recommendations", []):
                    raction = getattr(r, "action_type", None)
                    if raction and raction not in seen_rec_actions:
                        all_recs.append(r)
                        seen_rec_actions.add(raction)

        return AuthorityCitationTrustResult(
            page_id=page_id,
            url=page_url,
            scan_id=scan_id,
            website_id=website_id,
            trust_signals=all_trust_signals,
            authority_signals=auth_signals,
            external_sources=sources,
            support_needed_claims=claims,
            source_associations=associations,
            citation_readiness=eval_result.citation_readiness,
            findings=all_findings,
            recommendations=all_recs,
            metadata={
                "system": "RavalAI-GEO-Intelligence",
                "pipeline": "AuthorityCitationTrustPipeline",
                "version": "1.0.0",
                "generated_at": datetime.now(timezone.utc).isoformat(),
            },
        )


def evaluate_citation_readiness(
    trust_result: Any | None = None,
    authority_result: Any | None = None,
    source_result: Any | None = None,
    claim_support_result: Any | None = None,
    source_quality_result: Any | None = None,
    transparency_result: Any | None = None,
    page_url: str | None = None,
    page_id: int | None = None,
) -> CitationReadinessResult:
    """
    Convenience function for CitationReadinessEngine evaluation.
    """
    engine = CitationReadinessEngine()
    return engine.evaluate(
        trust_result=trust_result,
        authority_result=authority_result,
        source_result=source_result,
        claim_support_result=claim_support_result,
        source_quality_result=source_quality_result,
        transparency_result=transparency_result,
        page_url=page_url,
        page_id=page_id,
    )
