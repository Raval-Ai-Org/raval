"""
Unified Signal Normalization Contract & Adapters (Task 8 - Step 8.2)

Defines one consistent, deterministic, explainable normalized signal format
representing intelligence signals produced across existing Task 5-7 modules:
- Content Intelligence (Task 5)
- Opportunities & Fix Validation (Task 6)
- Authority, Citation & Trust Engines (Task 7)

Strict Architectural Invariants:
1. EVIDENCE != CONCLUSION: Preserves original evidence without turning evidence into unsupported claims.
2. DETERMINISTIC & EXPLAINABLE: Every signal preserves its original value, state, confidence, and source.
3. NON-DESTRUCTIVE: Normalization does not mutate original input objects.
4. INDEPENDENT USABILITY: Existing Task 5-7 modules remain unchanged and independently usable.
"""

from copy import deepcopy
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ApplicabilityType(str, Enum):
    """
    Standard applicability semantics for normalized signals.
    """
    APPLICABLE = "applicable"
    NOT_APPLICABLE = "not_applicable"
    CONDITIONAL = "conditional"
    INFORMATIONAL = "informational"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            val_lower = value.lower().strip()
            for member in cls:
                if member.value == val_lower:
                    return member
                # Handle common aliases
                if val_lower in ("na", "n/a", "not applicable", "inapplicable"):
                    return cls.NOT_APPLICABLE
                if val_lower in ("app", "active", "valid"):
                    return cls.APPLICABLE
                if val_lower in ("info", "diagnostic", "telemetry"):
                    return cls.INFORMATIONAL
                if val_lower in ("depends", "dependent", "contextual"):
                    return cls.CONDITIONAL
        return cls.APPLICABLE


class UnifiedSignal(BaseModel):
    """
    Canonical Normalized Signal Contract for Raval AI Search Intelligence (Task 8, Step 8.2).

    Every normalized signal supports:
    - rule_id: Stable identifier for the underlying rule/signal
    - status: Preserved or deterministically mapped state
    - value: Observed signal value (JSON-compatible: bool, int, float, str, list, dict, None)
    - evidence: Traceable evidence supporting the signal
    - confidence: Confidence level (high, medium, low) or explicit documented fallback
    - source_module: Identify originating module/engine
    - applicability: Represent whether/how the signal applies to the analyzed object
    """
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        validate_assignment=True,
        extra="allow",
    )

    rule_id: str = Field(
        ...,
        description="Stable identifier for the underlying rule or signal (e.g. trust_author_credentials_present, R-STR-01, quality_empty_content)",
    )
    status: str = Field(
        ...,
        description="Preserved or deterministically mapped signal state (e.g. detected, missing, pass, fail, warn, verified, partial, open, supported, unsupported)",
    )
    value: Any | None = Field(
        default=None,
        description="Observed signal value (boolean, numeric, string, structured dict/list, or None)",
    )
    evidence: dict[str, Any] | list[Any] | str | int | float | bool | None = Field(
        default=None,
        description="Traceable evidence supporting the signal. Preserved without conversion into unsupported conclusions.",
    )
    confidence: str = Field(
        default="high",
        description="Confidence level of detection (e.g. high, medium, low, or explicit documented fallback)",
    )
    source_module: str = Field(
        ...,
        description="Originating module or engine name (e.g. trust_engine, authority_engine, content_intelligence, source_quality_engine)",
    )
    applicability: str = Field(
        default="applicable",
        description="Applicability status (applicable, not_applicable, conditional, informational)",
    )

    # Optional auxiliary fields for enhanced traceability and explainability
    title: str | None = Field(
        default=None,
        description="Optional human-readable title describing the signal",
    )
    description: str | None = Field(
        default=None,
        description="Optional detailed explanation of what the signal represents",
    )
    category: str | None = Field(
        default=None,
        description="Optional classification category (e.g. trust, authority, structure, quality, content_gap)",
    )
    severity: str | None = Field(
        default=None,
        description="Optional severity level (critical, high, medium, low, info) if derived from finding or rule",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Execution and normalization metadata",
    )

    @field_validator("rule_id")
    @classmethod
    def validate_rule_id(cls, v: str) -> str:
        if not v or not str(v).strip():
            raise ValueError("rule_id cannot be empty")
        return str(v).strip()

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v is None or not str(v).strip():
            return "unknown"
        return str(v).strip().lower()

    @field_validator("confidence", mode="before")
    @classmethod
    def validate_confidence(cls, v: Any) -> str:
        if v is None:
            return "high"
        if hasattr(v, "value"):
            return str(v.value).lower()
        if isinstance(v, (int, float)):
            if v >= 0.70:
                return "high"
            elif v >= 0.40:
                return "medium"
            else:
                return "low"
        str_val = str(v).strip().lower()
        if str_val in ("high", "medium", "low"):
            return str_val
        return "high"

    @field_validator("applicability", mode="before")
    @classmethod
    def validate_applicability(cls, v: Any) -> str:
        if v is None:
            return "applicable"
        if hasattr(v, "value"):
            return str(v.value).lower()
        str_val = str(v).strip().lower()
        try:
            return ApplicabilityType(str_val).value
        except Exception:
            return "applicable"


class UnifiedSignalBatch(BaseModel):
    """
    Container for a collection of normalized signals with aggregate summary and metadata.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    total_signals: int = Field(default=0, description="Total normalized signals in batch")
    signals: list[UnifiedSignal] = Field(default_factory=list, description="List of normalized UnifiedSignal instances")
    source_modules: list[str] = Field(default_factory=list, description="List of unique source modules represented")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Batch execution metadata")

    @classmethod
    def from_signals(cls, signals: list[UnifiedSignal], metadata: dict[str, Any] | None = None) -> "UnifiedSignalBatch":
        modules = sorted(list({s.source_module for s in signals if s.source_module}))
        return cls(
            total_signals=len(signals),
            signals=signals,
            source_modules=modules,
            metadata=metadata or {
                "normalized_at": datetime.now(timezone.utc).isoformat(),
            },
        )


class UnifiedSignalNormalizer:
    """
    Unified Signal Normalizer & Adapter Engine (Step 8.2).

    Converts signals, findings, contracts, and analysis results produced by Task 5-7
    modules into standardized `UnifiedSignal` objects without modifying the original source objects.
    """

    def normalize(self, source_obj: Any, source_module: str | None = None, **kwargs) -> list[UnifiedSignal]:
        """
        Universal entry point to normalize any supported Task 5-7 signal object, contract,
        dataclass, dictionary, or analysis result.
        """
        if source_obj is None:
            return []

        # If already a UnifiedSignal, return a clean deep copy
        if isinstance(source_obj, UnifiedSignal):
            return [source_obj.model_copy(deep=True)]

        # If already a list/tuple of objects, normalize each item
        if isinstance(source_obj, (list, tuple, set)):
            results: list[UnifiedSignal] = []
            for item in source_obj:
                results.extend(self.normalize(item, source_module=source_module, **kwargs))
            return results

        # 1. Task 7 Authority & Trust Signals
        type_name = type(source_obj).__name__

        if type_name == "TrustSignalContract":
            return [self.normalize_trust_signal(source_obj, source_module=source_module)]
        if type_name == "AuthoritySignalContract":
            return [self.normalize_authority_signal(source_obj, source_module=source_module)]
        if type_name == "ExternalSourceContract":
            return [self.normalize_external_source(source_obj, source_module=source_module)]
        if type_name in ("SupportNeededClaimContract", "PotentiallySupportNeededClaimContract"):
            return [self.normalize_claim(source_obj, source_module=source_module)]
        if type_name == "SourceAssociationContract":
            return [self.normalize_source_association(source_obj, source_module=source_module)]
        if type_name == "SourceQualityAssessment":
            return [self.normalize_source_quality_assessment(source_obj, source_module=source_module)]
        if type_name == "CitationReadinessContract":
            return self.normalize_citation_readiness_contract(source_obj, source_module=source_module)

        # 2. Task 7 Engine Aggregate Results
        if type_name == "TrustSignalResult":
            return self.normalize_trust_result(source_obj)
        if type_name == "AuthoritySignalResult":
            return self.normalize_authority_result(source_obj)
        if type_name in ("ExternalSourceResult", "SourceResult"):
            return self.normalize_source_result(source_obj)
        if type_name == "ClaimSupportResult":
            return self.normalize_claim_support_result(source_obj)
        if type_name == "SourceQualityResult":
            return self.normalize_source_quality_result(source_obj)
        if type_name == "FirstPartyTransparencyResult":
            return self.normalize_transparency_result(source_obj)
        if type_name in ("CitationReadinessResult", "AuthorityCitationTrustResult"):
            return self.normalize_authority_citation_trust_result(source_obj)

        # 3. Task 5 Content Intelligence Dataclasses
        if type_name == "ContentIntelligenceSummary":
            return self.normalize_content_intelligence_summary(source_obj)
        if type_name == "QualityAnalysisEvidence":
            return self.normalize_quality_evidence(source_obj)
        if type_name == "TopicAnalysisEvidence":
            return self.normalize_topic_evidence(source_obj)
        if type_name == "EntityAnalysisEvidence":
            return self.normalize_entity_evidence(source_obj)
        if type_name == "QuestionAnalysisEvidence":
            return self.normalize_question_evidence(source_obj)
        if type_name == "AnswerAnalysisEvidence":
            return self.normalize_answer_evidence(source_obj)
        if type_name == "AnswerReadinessEvidence":
            return self.normalize_readiness_evidence(source_obj)
        if type_name == "ContentGapEvidence":
            return self.normalize_gap_evidence(source_obj)
        if type_name == "ContentGapItem":
            return [self.normalize_gap_item(source_obj)]
        if type_name == "IntentAnalysisEvidence":
            return self.normalize_intent_evidence(source_obj)
        if type_name == "SemanticCoverageEvidence":
            return self.normalize_semantic_coverage_evidence(source_obj)
        if type_name == "ContentStructureEvidence":
            return self.normalize_content_structure_evidence(source_obj)
        if type_name == "ContentQualityChecksResult":
            return self.normalize_quality_checks_result(source_obj)
        if type_name == "QualityCheckItem":
            return [self.normalize_quality_check_item(source_obj)]

        # 4. Finding & Recommendation Models
        if type_name in ("FindingCreate", "FindingResponse", "Finding"):
            return [self.normalize_finding(source_obj, source_module=source_module)]

        # 5. Dict Handling
        if isinstance(source_obj, dict):
            return self._normalize_dict(source_obj, source_module=source_module)

        # 6. Fallback generic inspection for custom objects
        if hasattr(source_obj, "__dict__") or is_dataclass(source_obj):
            as_dict = asdict(source_obj) if is_dataclass(source_obj) else dict(source_obj.__dict__)
            return self._normalize_dict(as_dict, source_module=source_module or type_name.lower())

        raise ValueError(f"Unsupported signal type for normalization: {type(source_obj)}")

    # -------------------------------------------------------------------------
    # Task 7 Adapters: Authority, Citation, Trust, Claims, Sources
    # -------------------------------------------------------------------------

    def normalize_trust_signal(self, signal: Any, source_module: str | None = None) -> UnifiedSignal:
        """Normalize TrustSignalContract."""
        sig_dict = signal.model_dump() if hasattr(signal, "model_dump") else (signal if isinstance(signal, dict) else dict(signal))
        
        signal_id = sig_dict.get("signal_id") or sig_dict.get("rule_id") or "trust_signal_unknown"
        status = sig_dict.get("status") or "detected"
        value = sig_dict.get("value")
        if value is None:
            value = status in ("detected", "verified", "pass")
        
        conf = sig_dict.get("confidence")
        conf_str = conf.value if hasattr(conf, "value") else str(conf) if conf else "high"
        
        evidence = deepcopy(sig_dict.get("evidence"))
        
        return UnifiedSignal(
            rule_id=signal_id,
            status=status,
            value=value,
            evidence=evidence,
            confidence=conf_str,
            source_module=source_module or "trust_engine",
            applicability="applicable",
            title=sig_dict.get("title") or f"Trust Signal: {signal_id}",
            description=sig_dict.get("description"),
            category=sig_dict.get("category") or "trust",
            metadata={"originating_type": "TrustSignalContract"},
        )

    def normalize_authority_signal(self, signal: Any, source_module: str | None = None) -> UnifiedSignal:
        """Normalize AuthoritySignalContract."""
        sig_dict = signal.model_dump() if hasattr(signal, "model_dump") else (signal if isinstance(signal, dict) else dict(signal))
        
        signal_id = sig_dict.get("signal_id") or sig_dict.get("rule_id") or "authority_signal_unknown"
        status = sig_dict.get("status") or "detected"
        value = sig_dict.get("value")
        if value is None:
            value = status in ("detected", "verified", "strong", "pass")

        conf = sig_dict.get("confidence")
        conf_str = conf.value if hasattr(conf, "value") else str(conf) if conf else "high"

        evidence = deepcopy(sig_dict.get("evidence"))

        return UnifiedSignal(
            rule_id=signal_id,
            status=status,
            value=value,
            evidence=evidence,
            confidence=conf_str,
            source_module=source_module or "authority_engine",
            applicability="applicable",
            title=sig_dict.get("title") or f"Authority Signal: {signal_id}",
            description=sig_dict.get("description"),
            category=sig_dict.get("category") or "authority",
            metadata={"originating_type": "AuthoritySignalContract"},
        )

    def normalize_external_source(self, source: Any, source_module: str | None = None) -> UnifiedSignal:
        """Normalize ExternalSourceContract."""
        src_dict = source.model_dump() if hasattr(source, "model_dump") else (source if isinstance(source, dict) else dict(source))
        
        url = src_dict.get("url", "")
        domain = src_dict.get("domain")
        is_candidate = src_dict.get("is_citation_candidate", False)
        status = src_dict.get("availability_status") or ("citation_candidate" if is_candidate else "external_source")
        
        evidence = deepcopy(src_dict.get("evidence")) or {
            "url": url,
            "domain": domain,
            "anchor_text": src_dict.get("anchor_text"),
            "context_text": src_dict.get("context_text"),
            "link_type": src_dict.get("link_type"),
            "rel_attributes": src_dict.get("rel_attributes"),
            "status_code": src_dict.get("status_code"),
            "is_accessible": src_dict.get("is_accessible"),
        }

        return UnifiedSignal(
            rule_id="source_external_link_detected",
            status=status,
            value={"url": url, "domain": domain, "is_citation_candidate": is_candidate},
            evidence=evidence,
            confidence="high",
            source_module=source_module or "source_engine",
            applicability="applicable",
            title=f"External Source: {domain or url}",
            description=f"External link detected to domain '{domain}'",
            category="external_sources",
            metadata={"originating_type": "ExternalSourceContract"},
        )

    def normalize_claim(self, claim: Any, source_module: str | None = None) -> UnifiedSignal:
        """Normalize SupportNeededClaimContract."""
        claim_dict = claim.model_dump() if hasattr(claim, "model_dump") else (claim if isinstance(claim, dict) else dict(claim))
        
        claim_type = claim_dict.get("claim_type", "factual_assertion")
        claim_id = claim_dict.get("claim_id") or f"claim_{claim_type}"
        has_src = claim_dict.get("has_associated_source", False)
        status = "supported" if has_src else "unsupported"
        
        conf = claim_dict.get("confidence")
        conf_str = conf.value if hasattr(conf, "value") else str(conf) if conf else "medium"
        
        evidence = deepcopy(claim_dict.get("evidence")) or {
            "claim_text": claim_dict.get("claim_text"),
            "claim_type": claim_type,
            "location": claim_dict.get("location"),
            "reason": claim_dict.get("reason"),
            "associated_source_urls": claim_dict.get("associated_source_urls", []),
        }

        return UnifiedSignal(
            rule_id=f"claim_support_{claim_type}",
            status=status,
            value=claim_dict.get("claim_text"),
            evidence=evidence,
            confidence=conf_str,
            source_module=source_module or "claim_support_engine",
            applicability="applicable",
            title=f"Support-Needed Claim ({claim_type})",
            description=claim_dict.get("reason"),
            category="claims",
            metadata={"claim_id": claim_id, "originating_type": "SupportNeededClaimContract"},
        )

    def normalize_source_association(self, association: Any, source_module: str | None = None) -> UnifiedSignal:
        """Normalize SourceAssociationContract."""
        assoc_dict = association.model_dump() if hasattr(association, "model_dump") else (association if isinstance(association, dict) else dict(association))
        
        assoc_type = assoc_dict.get("association_type", "in_text_link")
        assoc_id = assoc_dict.get("association_id") or f"association_{assoc_type}"
        
        conf = assoc_dict.get("confidence")
        conf_str = conf.value if hasattr(conf, "value") else str(conf) if conf else "medium"
        
        evidence = deepcopy(assoc_dict.get("evidence")) or {
            "source_url": assoc_dict.get("source_url"),
            "source_domain": assoc_dict.get("source_domain"),
            "claim_id": assoc_dict.get("claim_id"),
            "claim_text": assoc_dict.get("claim_text"),
            "content_region": assoc_dict.get("content_region"),
            "context_text": assoc_dict.get("context_text"),
            "explanation": assoc_dict.get("explanation"),
        }

        return UnifiedSignal(
            rule_id=f"source_association_{assoc_type}",
            status="associated",
            value={
                "source_url": assoc_dict.get("source_url"),
                "source_domain": assoc_dict.get("source_domain"),
                "association_type": assoc_type,
            },
            evidence=evidence,
            confidence=conf_str,
            source_module=source_module or "claim_support_engine",
            applicability="applicable",
            title=f"Source Association: {assoc_dict.get('source_domain') or assoc_dict.get('source_url')}",
            description=assoc_dict.get("explanation"),
            category="source_associations",
            metadata={"association_id": assoc_id, "originating_type": "SourceAssociationContract"},
        )

    def normalize_source_quality_assessment(self, assessment: Any, source_module: str | None = None) -> UnifiedSignal:
        """Normalize SourceQualityAssessment."""
        sq_dict = assessment.model_dump() if hasattr(assessment, "model_dump") else (assessment if isinstance(assessment, dict) else dict(assessment))
        
        url = sq_dict.get("url", "")
        tier = sq_dict.get("quality_tier", "adequate")
        
        evidence = deepcopy(sq_dict.get("evidence")) or {
            "url": url,
            "domain": sq_dict.get("domain"),
            "anchor_text": sq_dict.get("anchor_text"),
            "anchor_quality": sq_dict.get("anchor_quality"),
            "is_primary_source": sq_dict.get("is_primary_source"),
            "primary_source_type": sq_dict.get("primary_source_type"),
            "is_accessible": sq_dict.get("is_accessible"),
            "rel_assessment": sq_dict.get("rel_assessment"),
            "issues": sq_dict.get("issues", []),
        }

        return UnifiedSignal(
            rule_id="source_quality_assessment",
            status=tier,
            value={
                "quality_tier": tier,
                "is_primary_source": sq_dict.get("is_primary_source", False),
                "is_accessible": sq_dict.get("is_accessible", True),
                "anchor_quality": sq_dict.get("anchor_quality", "descriptive"),
            },
            evidence=evidence,
            confidence="high",
            source_module=source_module or "source_quality_engine",
            applicability="applicable",
            title=f"Source Quality Assessment: {sq_dict.get('domain') or url}",
            description=f"Source evaluated as quality tier '{tier}' with anchor '{sq_dict.get('anchor_quality')}'",
            category="source_quality",
            metadata={"originating_type": "SourceQualityAssessment"},
        )

    def normalize_citation_readiness_contract(self, readiness: Any, source_module: str | None = None) -> list[UnifiedSignal]:
        """Normalize CitationReadinessContract into unified signals."""
        r_dict = readiness.model_dump() if hasattr(readiness, "model_dump") else (readiness if isinstance(readiness, dict) else dict(readiness))
        
        signals: list[UnifiedSignal] = []
        mod = source_module or "citation_readiness_engine"
        
        # 1. Overall structural readiness level
        signals.append(UnifiedSignal(
            rule_id="citation_readiness_level",
            status=r_dict.get("readiness_level", "low"),
            value=r_dict.get("readiness_level", "low"),
            evidence={
                "positive_signals": deepcopy(r_dict.get("positive_signals", [])),
                "negative_signals": deepcopy(r_dict.get("negative_signals", [])),
                "structural_indicators": deepcopy(r_dict.get("structural_indicators", {})),
            },
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Structural Citation Readiness Level",
            description=f"Overall structural citation readiness evaluated as '{r_dict.get('readiness_level', 'low')}'",
            category="citation_readiness",
        ))

        # 2. Verifiable sources presence
        has_verifiable = r_dict.get("has_verifiable_sources", False)
        signals.append(UnifiedSignal(
            rule_id="citation_has_verifiable_sources",
            status="detected" if has_verifiable else "missing",
            value=has_verifiable,
            evidence={
                "total_external_sources": r_dict.get("total_external_sources", 0),
            },
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Verifiable Reference Sources Presence",
            description="Presence of verifiable external citation candidate sources",
            category="citation_readiness",
        ))

        # 3. Claims support coverage
        total_claims = r_dict.get("total_claims_detected", 0)
        supported_claims = r_dict.get("supported_claims_count", 0)
        unsupported_claims = r_dict.get("unsupported_claims_count", 0)
        
        claims_applicable = "applicable" if total_claims > 0 else "not_applicable"
        claims_status = "covered" if total_claims > 0 and unsupported_claims == 0 else ("partial" if supported_claims > 0 else "unsupported" if total_claims > 0 else "none_detected")
        
        signals.append(UnifiedSignal(
            rule_id="citation_claim_support_coverage",
            status=claims_status,
            value={
                "total_claims": total_claims,
                "supported_claims": supported_claims,
                "unsupported_claims": unsupported_claims,
                "coverage_ratio": round(supported_claims / total_claims, 2) if total_claims > 0 else 1.0,
            },
            evidence={
                "total_claims_detected": total_claims,
                "supported_claims_count": supported_claims,
                "unsupported_claims_count": unsupported_claims,
            },
            confidence="high",
            source_module=mod,
            applicability=claims_applicable,
            title="Claim Citation Support Coverage",
            description="Coverage ratio of potentially support-needed claims backed by external citations",
            category="citation_readiness",
        ))

        return signals

    # -------------------------------------------------------------------------
    # Task 7 Engine Aggregate Result Adapters
    # -------------------------------------------------------------------------

    def normalize_trust_result(self, result: Any) -> list[UnifiedSignal]:
        """Normalize TrustSignalResult into list of UnifiedSignals."""
        signals: list[UnifiedSignal] = []
        raw_signals = getattr(result, "trust_signals", [])
        for sig in raw_signals:
            signals.append(self.normalize_trust_signal(sig, source_module="trust_engine"))
        
        # Also normalize findings if present
        findings = getattr(result, "findings", [])
        for f in findings:
            signals.append(self.normalize_finding(f, source_module="trust_engine"))
        return signals

    def normalize_authority_result(self, result: Any) -> list[UnifiedSignal]:
        """Normalize AuthoritySignalResult into list of UnifiedSignals."""
        signals: list[UnifiedSignal] = []
        raw_signals = getattr(result, "authority_signals", [])
        for sig in raw_signals:
            signals.append(self.normalize_authority_signal(sig, source_module="authority_engine"))
        
        findings = getattr(result, "findings", [])
        for f in findings:
            signals.append(self.normalize_finding(f, source_module="authority_engine"))
        return signals

    def normalize_source_result(self, result: Any) -> list[UnifiedSignal]:
        """Normalize SourceResult from source_engine."""
        signals: list[UnifiedSignal] = []
        sources = getattr(result, "sources", [])
        for src in sources:
            signals.append(self.normalize_external_source(src, source_module="source_engine"))
        
        findings = getattr(result, "findings", [])
        for f in findings:
            signals.append(self.normalize_finding(f, source_module="source_engine"))
        return signals

    def normalize_claim_support_result(self, result: Any) -> list[UnifiedSignal]:
        """Normalize ClaimSupportResult."""
        signals: list[UnifiedSignal] = []
        claims = getattr(result, "claims", [])
        for cl in claims:
            signals.append(self.normalize_claim(cl, source_module="claim_support_engine"))
        
        associations = getattr(result, "source_associations", []) or getattr(result, "associations", [])
        for assoc in associations:
            signals.append(self.normalize_source_association(assoc, source_module="claim_support_engine"))
        
        findings = getattr(result, "findings", [])
        for f in findings:
            signals.append(self.normalize_finding(f, source_module="claim_support_engine"))
        return signals

    def normalize_source_quality_result(self, result: Any) -> list[UnifiedSignal]:
        """Normalize SourceQualityResult."""
        signals: list[UnifiedSignal] = []
        assessments = getattr(result, "assessments", [])
        for sq in assessments:
            signals.append(self.normalize_source_quality_assessment(sq, source_module="source_quality_engine"))
        
        findings = getattr(result, "findings", [])
        for f in findings:
            signals.append(self.normalize_finding(f, source_module="source_quality_engine"))
        return signals

    def normalize_transparency_result(self, result: Any) -> list[UnifiedSignal]:
        """Normalize FirstPartyTransparencyResult."""
        signals: list[UnifiedSignal] = []
        raw_signals = (
            getattr(result, "transparency_signals", []) or
            getattr(result, "signals", []) or
            getattr(result, "trust_signals", [])
        )
        for sig in raw_signals:
            signals.append(self.normalize_trust_signal(sig, source_module="transparency_engine"))
        
        findings = getattr(result, "findings", [])
        for f in findings:
            signals.append(self.normalize_finding(f, source_module="transparency_engine"))
        return signals

    def normalize_authority_citation_trust_result(self, result: Any) -> list[UnifiedSignal]:
        """Normalize top-level AuthorityCitationTrustResult or CitationReadinessResult."""
        signals: list[UnifiedSignal] = []
        
        # 1. Trust signals
        for sig in getattr(result, "trust_signals", []):
            signals.append(self.normalize_trust_signal(sig, source_module="trust_engine"))
        
        # 2. Authority signals
        for sig in getattr(result, "authority_signals", []):
            signals.append(self.normalize_authority_signal(sig, source_module="authority_engine"))
        
        # 3. External sources
        for src in getattr(result, "external_sources", []):
            signals.append(self.normalize_external_source(src, source_module="source_engine"))
        
        # 4. Support needed claims
        for cl in getattr(result, "support_needed_claims", []):
            signals.append(self.normalize_claim(cl, source_module="claim_support_engine"))
        
        # 5. Source associations
        for assoc in getattr(result, "source_associations", []):
            signals.append(self.normalize_source_association(assoc, source_module="claim_support_engine"))
        
        # 6. Citation readiness
        cit_ready = getattr(result, "citation_readiness", None)
        if cit_ready:
            signals.extend(self.normalize_citation_readiness_contract(cit_ready, source_module="citation_readiness_engine"))
        
        # 7. Findings
        for f in getattr(result, "findings", []):
            signals.append(self.normalize_finding(f, source_module="citation_readiness_engine"))
        
        return signals

    # -------------------------------------------------------------------------
    # Task 5 Adapters: Content Intelligence & Sub-Analyzers
    # -------------------------------------------------------------------------

    def normalize_content_intelligence_summary(self, summary: Any) -> list[UnifiedSignal]:
        """Normalize ContentIntelligenceSummary into comprehensive unified signals."""
        s_dict = summary.to_dict() if hasattr(summary, "to_dict") else (asdict(summary) if is_dataclass(summary) else dict(summary))
        signals: list[UnifiedSignal] = []
        mod = "content_intelligence_analyzer"

        # 1. Word Count
        wc = s_dict.get("word_count", 0)
        signals.append(UnifiedSignal(
            rule_id="content_word_count",
            status="adequate" if wc >= 150 else ("thin" if wc >= 50 else "deficient"),
            value=wc,
            evidence={"word_count": wc, "reading_time_minutes": s_dict.get("reading_time_minutes", 0.0)},
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Content Word Count",
            description=f"Observed total word count of {wc} words",
            category="structure",
        ))

        # 2. Primary Topic
        pt = s_dict.get("primary_topic")
        signals.append(UnifiedSignal(
            rule_id="content_primary_topic",
            status="detected" if pt else "missing",
            value=pt,
            evidence={"primary_topic": pt},
            confidence="high" if pt else "low",
            source_module=mod,
            applicability="applicable",
            title="Primary Topic Extraction",
            description=f"Primary extracted topic: '{pt}'",
            category="topic",
        ))

        # 3. Primary Intent
        pi = s_dict.get("primary_intent", "informational")
        iconf = s_dict.get("intent_confidence", 1.0)
        signals.append(UnifiedSignal(
            rule_id="content_search_intent",
            status="detected",
            value=pi,
            evidence={"primary_intent": pi, "intent_confidence": iconf},
            confidence=self._confidence_from_numeric(iconf),
            source_module=mod,
            applicability="applicable",
            title="Search Intent Classification",
            description=f"Classified primary search intent: '{pi}'",
            category="search_intent",
        ))

        # 4. Answer Readiness Score
        ars = s_dict.get("answer_readiness_score", 0.0)
        arl = s_dict.get("answer_readiness_level", "low")
        signals.append(UnifiedSignal(
            rule_id="content_answer_readiness",
            status=arl,
            value=ars,
            evidence={"readiness_score": ars, "readiness_level": arl},
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Answer Readiness Score",
            description=f"Deterministic answer readiness score of {ars} ({arl})",
            category="readiness",
        ))

        # 5. Evidence Quality Score
        eqs = s_dict.get("evidence_quality_score", 0.0)
        eq_str = s_dict.get("evidence_strength", "weak")
        signals.append(UnifiedSignal(
            rule_id="content_evidence_quality",
            status=eq_str,
            value=eqs,
            evidence={"evidence_quality_score": eqs, "evidence_strength": eq_str},
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Evidence & Quality Score",
            description=f"Quality evidence score of {eqs} ({eq_str})",
            category="quality_evidence",
        ))

        # 6. Semantic Coverage Score
        scs = s_dict.get("semantic_coverage_score", 0.0)
        scb = s_dict.get("semantic_breadth_level", "narrow")
        signals.append(UnifiedSignal(
            rule_id="content_semantic_coverage",
            status=scb,
            value=scs,
            evidence={"semantic_coverage_score": scs, "breadth_level": scb},
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Semantic Coverage Score",
            description=f"Semantic coverage score of {scs} ({scb})",
            category="semantic_coverage",
        ))

        # 7. Overall Content Score
        ocs = s_dict.get("overall_content_score", 0.0)
        cstatus = s_dict.get("content_status", "deficient")
        signals.append(UnifiedSignal(
            rule_id="content_overall_score",
            status=cstatus,
            value=ocs,
            evidence={
                "overall_content_score": ocs,
                "content_status": cstatus,
                "key_strengths": s_dict.get("key_strengths", []),
                "critical_issues": s_dict.get("critical_issues", []),
            },
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Overall Content Score",
            description=f"Composite content score of {ocs} ({cstatus})",
            category="content_intelligence",
        ))

        # 8. Questions and Answers
        tq = s_dict.get("total_questions", 0)
        aq = s_dict.get("answered_questions", 0)
        uq = s_dict.get("unanswered_questions", 0)
        signals.append(UnifiedSignal(
            rule_id="content_question_answer_counts",
            status="unanswered_present" if uq > 0 else ("all_answered" if tq > 0 else "no_questions"),
            value={"total_questions": tq, "answered_questions": aq, "unanswered_questions": uq},
            evidence={"total": tq, "answered": aq, "unanswered": uq},
            confidence="high",
            source_module=mod,
            applicability="applicable" if tq > 0 else "not_applicable",
            title="Question & Answer Statistics",
            description=f"Observed {tq} question(s) with {uq} unanswered",
            category="questions",
        ))

        # 9. Findings
        findings = s_dict.get("findings", [])
        for f in findings:
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_quality_evidence(self, quality: Any) -> list[UnifiedSignal]:
        """Normalize QualityAnalysisEvidence."""
        q_dict = quality.to_dict() if hasattr(quality, "to_dict") else (asdict(quality) if is_dataclass(quality) else dict(quality))
        signals: list[UnifiedSignal] = []
        mod = "quality_analyzer"

        # 1. Quality score
        signals.append(UnifiedSignal(
            rule_id="quality_evidence_score",
            status=q_dict.get("evidence_strength", "weak"),
            value=q_dict.get("quality_score", 0.0),
            evidence={
                "quality_score": q_dict.get("quality_score", 0.0),
                "evidence_strength": q_dict.get("evidence_strength", "weak"),
                "has_quantitative_evidence": q_dict.get("has_quantitative_evidence", False),
                "data_points_count": q_dict.get("data_points_count", 0),
                "citations_count": q_dict.get("citations_count", 0),
                "attributions_count": q_dict.get("attributions_count", 0),
                "unsupported_claims_count": q_dict.get("unsupported_claims_count", 0),
            },
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Quality Evidence Score",
            category="quality_evidence",
        ))

        # 2. Data points
        dp_count = q_dict.get("data_points_count", 0)
        signals.append(UnifiedSignal(
            rule_id="quality_quantitative_data_points",
            status="detected" if dp_count > 0 else "missing",
            value=dp_count,
            evidence={"data_points": deepcopy(q_dict.get("data_points", []))},
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Quantitative Data Points",
            category="quality_evidence",
        ))

        # 3. Unsupported superlative claims
        usc_count = q_dict.get("unsupported_claims_count", 0)
        signals.append(UnifiedSignal(
            rule_id="quality_unsupported_superlative_claims",
            status="detected" if usc_count > 0 else "none_detected",
            value=usc_count,
            evidence={"unsupported_claims": deepcopy(q_dict.get("unsupported_claims", []))},
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Unsupported Superlative Claims Count",
            category="quality_evidence",
        ))

        # Findings
        for f in q_dict.get("findings", []):
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_topic_evidence(self, topic: Any) -> list[UnifiedSignal]:
        """Normalize TopicAnalysisEvidence."""
        t_dict = topic.to_dict() if hasattr(topic, "to_dict") else (asdict(topic) if is_dataclass(topic) else dict(topic))
        signals: list[UnifiedSignal] = []
        mod = "topic_analyzer"

        pt = t_dict.get("primary_topic")
        signals.append(UnifiedSignal(
            rule_id="topic_primary_topic",
            status="detected" if pt else "missing",
            value=pt,
            evidence={
                "primary_topic": pt,
                "primary_topic_confidence": t_dict.get("primary_topic_confidence", 0.0),
                "supporting_topics": deepcopy(t_dict.get("supporting_topics", [])),
                "primary_topic_in_title": t_dict.get("primary_topic_in_title", False),
                "primary_topic_in_h1": t_dict.get("primary_topic_in_h1", False),
            },
            confidence=self._confidence_from_numeric(t_dict.get("primary_topic_confidence", 1.0)),
            source_module=mod,
            applicability="applicable",
            title="Primary Topic Signal",
            category="topic",
        ))

        ld = t_dict.get("lexical_diversity", 0.0)
        signals.append(UnifiedSignal(
            rule_id="topic_lexical_diversity",
            status="adequate" if ld >= 0.35 else "low",
            value=ld,
            evidence={"lexical_diversity": ld, "semantic_depth": t_dict.get("semantic_depth", "shallow")},
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Lexical Diversity",
            category="topic",
        ))

        for f in t_dict.get("findings", []):
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_entity_evidence(self, entity: Any) -> list[UnifiedSignal]:
        """Normalize EntityAnalysisEvidence."""
        e_dict = entity.to_dict() if hasattr(entity, "to_dict") else (asdict(entity) if is_dataclass(entity) else dict(entity))
        signals: list[UnifiedSignal] = []
        mod = "entity_analyzer"

        ec = e_dict.get("entity_count", 0)
        signals.append(UnifiedSignal(
            rule_id="entity_grounding_count",
            status="detected" if ec > 0 else "missing",
            value=ec,
            evidence={
                "entity_count": ec,
                "has_organization_entity": e_dict.get("has_organization_entity", False),
                "entities": deepcopy(e_dict.get("entities", [])[:10]),
            },
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Entity Grounding Count",
            category="entities",
        ))

        for f in e_dict.get("findings", []):
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_question_evidence(self, q_ev: Any) -> list[UnifiedSignal]:
        """Normalize QuestionAnalysisEvidence."""
        q_dict = q_ev.to_dict() if hasattr(q_ev, "to_dict") else (asdict(q_ev) if is_dataclass(q_ev) else dict(q_ev))
        signals: list[UnifiedSignal] = []
        mod = "question_analyzer"

        qc = q_dict.get("question_count", 0)
        signals.append(UnifiedSignal(
            rule_id="questions_detected_count",
            status="detected" if qc > 0 else "none_detected",
            value=qc,
            evidence={
                "question_count": qc,
                "faq_schema_present": q_dict.get("faq_schema_present", False),
                "questions": deepcopy(q_dict.get("questions", [])),
            },
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Questions Detected Count",
            category="questions",
        ))

        for f in q_dict.get("findings", []):
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_answer_evidence(self, ans_ev: Any) -> list[UnifiedSignal]:
        """Normalize AnswerAnalysisEvidence."""
        a_dict = ans_ev.to_dict() if hasattr(ans_ev, "to_dict") else (asdict(ans_ev) if is_dataclass(ans_ev) else dict(ans_ev))
        signals: list[UnifiedSignal] = []
        mod = "answer_analyzer"

        tq = a_dict.get("total_questions", 0)
        uq = a_dict.get("unanswered_questions", 0)
        signals.append(UnifiedSignal(
            rule_id="answer_resolution_status",
            status="unanswered_present" if uq > 0 else ("all_resolved" if tq > 0 else "no_questions"),
            value={"total": tq, "answered": a_dict.get("answered_questions", 0), "unanswered": uq},
            evidence={
                "direct_answers_count": a_dict.get("direct_answers_count", 0),
                "answers": deepcopy(a_dict.get("answers", [])),
            },
            confidence="high",
            source_module=mod,
            applicability="applicable" if tq > 0 else "not_applicable",
            title="Answer Resolution Status",
            category="answers",
        ))

        for f in a_dict.get("findings", []):
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_readiness_evidence(self, r_ev: Any) -> list[UnifiedSignal]:
        """Normalize AnswerReadinessEvidence."""
        r_dict = r_ev.to_dict() if hasattr(r_ev, "to_dict") else (asdict(r_ev) if is_dataclass(r_ev) else dict(r_ev))
        signals: list[UnifiedSignal] = []
        mod = "readiness_analyzer"

        score = r_dict.get("readiness_score", 0.0)
        level = r_dict.get("readiness_level", "low")
        signals.append(UnifiedSignal(
            rule_id="answer_readiness_score",
            status=level,
            value=score,
            evidence={
                "readiness_score": score,
                "readiness_level": level,
                "component_scores": deepcopy(r_dict.get("component_scores", {})),
                "positive_signals": deepcopy(r_dict.get("positive_signals", [])),
                "negative_signals": deepcopy(r_dict.get("negative_signals", [])),
            },
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Answer Readiness Assessment",
            category="readiness",
        ))

        for f in r_dict.get("findings", []):
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_gap_evidence(self, gap_ev: Any) -> list[UnifiedSignal]:
        """Normalize ContentGapEvidence."""
        g_dict = gap_ev.to_dict() if hasattr(gap_ev, "to_dict") else (asdict(gap_ev) if is_dataclass(gap_ev) else dict(gap_ev))
        signals: list[UnifiedSignal] = []
        mod = "content_gap_analyzer"

        tg = g_dict.get("total_gaps", 0)
        signals.append(UnifiedSignal(
            rule_id="content_gaps_total",
            status="gaps_present" if tg > 0 else "no_gaps",
            value=tg,
            evidence={
                "total_gaps": tg,
                "unanswered_question_gaps_count": g_dict.get("unanswered_question_gaps_count", 0),
                "structural_gaps_count": g_dict.get("structural_gaps_count", 0),
                "topical_gaps_count": g_dict.get("topical_gaps_count", 0),
                "entity_gaps_count": g_dict.get("entity_gaps_count", 0),
                "schema_gaps_count": g_dict.get("schema_gaps_count", 0),
            },
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Total Content Gaps Count",
            category="content_gaps",
        ))

        for g in g_dict.get("gaps", []):
            signals.append(self.normalize_gap_item(g))

        for f in g_dict.get("findings", []):
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_gap_item(self, gap: Any) -> UnifiedSignal:
        """Normalize an individual ContentGapItem."""
        g_dict = asdict(gap) if is_dataclass(gap) else (gap if isinstance(gap, dict) else dict(gap))
        gt = g_dict.get("gap_type", "general")
        return UnifiedSignal(
            rule_id=f"content_gap_{gt}",
            status="detected",
            value=g_dict.get("missing_element"),
            evidence=deepcopy(g_dict.get("evidence")) or {
                "missing_element": g_dict.get("missing_element"),
                "why_it_matters": g_dict.get("why_it_matters"),
                "recommended_action": g_dict.get("recommended_action"),
            },
            confidence="high",
            source_module="content_gap_analyzer",
            applicability="applicable",
            title=g_dict.get("title") or f"Content Gap: {gt}",
            description=g_dict.get("why_it_matters"),
            category="content_gaps",
            severity=g_dict.get("severity", "medium"),
            metadata={"originating_type": "ContentGapItem"},
        )

    def normalize_intent_evidence(self, intent_ev: Any) -> list[UnifiedSignal]:
        """Normalize IntentAnalysisEvidence."""
        i_dict = intent_ev.to_dict() if hasattr(intent_ev, "to_dict") else (asdict(intent_ev) if is_dataclass(intent_ev) else dict(intent_ev))
        signals: list[UnifiedSignal] = []
        mod = "intent_analyzer"

        pi = i_dict.get("primary_intent", "informational")
        conf = i_dict.get("confidence", 1.0)
        signals.append(UnifiedSignal(
            rule_id="search_intent_primary",
            status="detected",
            value=pi,
            evidence={
                "primary_intent": pi,
                "confidence": conf,
                "intent_scores": deepcopy(i_dict.get("intent_scores", {})),
                "is_mixed_intent": i_dict.get("is_mixed_intent", False),
            },
            confidence=self._confidence_from_numeric(conf),
            source_module=mod,
            applicability="applicable",
            title="Search Intent Primary Signal",
            category="search_intent",
        ))

        for f in i_dict.get("findings", []):
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_semantic_coverage_evidence(self, cov_ev: Any) -> list[UnifiedSignal]:
        """Normalize SemanticCoverageEvidence."""
        c_dict = cov_ev.to_dict() if hasattr(cov_ev, "to_dict") else (asdict(cov_ev) if is_dataclass(cov_ev) else dict(cov_ev))
        signals: list[UnifiedSignal] = []
        mod = "semantic_coverage_analyzer"

        score = c_dict.get("semantic_coverage_score", 0.0)
        breadth = c_dict.get("breadth_level", "narrow")
        signals.append(UnifiedSignal(
            rule_id="semantic_coverage_score",
            status=breadth,
            value=score,
            evidence={
                "coverage_score": score,
                "breadth_level": breadth,
                "covered_concepts": deepcopy(c_dict.get("covered_concepts", [])),
                "missing_concepts": deepcopy(c_dict.get("missing_concepts", [])),
            },
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Semantic Coverage Assessment",
            category="semantic_coverage",
        ))

        for f in c_dict.get("findings", []):
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_content_structure_evidence(self, struct_ev: Any) -> list[UnifiedSignal]:
        """Normalize ContentStructureEvidence."""
        s_dict = struct_ev.to_dict() if hasattr(struct_ev, "to_dict") else (asdict(struct_ev) if is_dataclass(struct_ev) else dict(struct_ev))
        signals: list[UnifiedSignal] = []
        mod = "content_structure_analyzer"

        has_h1 = s_dict.get("has_h1", False)
        valid_hier = s_dict.get("heading_hierarchy_valid", True)
        signals.append(UnifiedSignal(
            rule_id="content_heading_structure",
            status="pass" if has_h1 and valid_hier else "fail",
            value={"has_h1": has_h1, "heading_hierarchy_valid": valid_hier, "h1_count": s_dict.get("h1_count", 0)},
            evidence={
                "h1_count": s_dict.get("h1_count", 0),
                "heading_hierarchy_valid": valid_hier,
                "section_count": s_dict.get("section_count", 0),
            },
            confidence="high",
            source_module=mod,
            applicability="applicable",
            title="Heading Structure Validation",
            category="structure",
        ))

        for f in s_dict.get("findings", []):
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_quality_checks_result(self, checks_res: Any) -> list[UnifiedSignal]:
        """Normalize ContentQualityChecksResult."""
        c_dict = checks_res.to_dict() if hasattr(checks_res, "to_dict") else (asdict(checks_res) if is_dataclass(checks_res) else dict(checks_res))
        signals: list[UnifiedSignal] = []
        mod = "content_quality_checks"

        for check in c_dict.get("checks", []):
            signals.append(self.normalize_quality_check_item(check, source_module=mod))

        for f in c_dict.get("findings", []):
            signals.append(self.normalize_finding(f, source_module=mod))

        return signals

    def normalize_quality_check_item(self, check: Any, source_module: str | None = None) -> UnifiedSignal:
        """Normalize QualityCheckItem."""
        chk_dict = asdict(check) if is_dataclass(check) else (check if isinstance(check, dict) else dict(check))
        cname = chk_dict.get("check_name", "unknown_check")
        status = chk_dict.get("status", "pass")
        return UnifiedSignal(
            rule_id=f"quality_check_{cname}",
            status=status,
            value=status == "pass",
            evidence=deepcopy(chk_dict.get("evidence")),
            confidence="high",
            source_module=source_module or "content_quality_checks",
            applicability="applicable",
            title=chk_dict.get("title") or f"Quality Check: {cname}",
            description=chk_dict.get("description"),
            category="content_checks",
            metadata={"originating_type": "QualityCheckItem"},
        )

    # -------------------------------------------------------------------------
    # Finding & General Dictionary Normalization
    # -------------------------------------------------------------------------

    def normalize_finding(self, finding: Any, source_module: str | None = None) -> UnifiedSignal:
        """Normalize a FindingCreate, FindingResponse, Finding OR finding dict."""
        if hasattr(finding, "model_dump"):
            f_dict = finding.model_dump()
        elif hasattr(finding, "__table__"):
            f_dict = {col.name: getattr(finding, col.name) for col in finding.__table__.columns}
            if hasattr(finding, "evidence") and f_dict.get("evidence") is None:
                f_dict["evidence"] = getattr(finding, "evidence", None)
        elif isinstance(finding, dict):
            f_dict = finding
        elif hasattr(finding, "__dict__"):
            f_dict = {k: v for k, v in finding.__dict__.items() if not k.startswith("_")}
        else:
            try:
                f_dict = dict(finding)
            except Exception:
                f_dict = {}

        ftype = f_dict.get("finding_type") or f_dict.get("type") or "finding_unknown"
        status = str(f_dict.get("status") or "open")

        category = f_dict.get("category") or "findings"
        severity = f_dict.get("severity") or "medium"
        title = f_dict.get("title") or f"Finding: {ftype}"
        description = f_dict.get("description") or ""
        evidence = deepcopy(f_dict.get("evidence"))
        finding_id = str(f_dict.get("id")) if f_dict.get("id") is not None else None

        return UnifiedSignal(
            rule_id=str(ftype),
            status=str(status),
            value={"title": title, "severity": severity},
            evidence=evidence,
            confidence="high",
            source_module=source_module or f_dict.get("source_module") or f"finding_{category}",
            applicability="applicable",
            title=title,
            description=description,
            category=category,
            severity=severity,
            metadata={"originating_type": "Finding", "finding_id": finding_id},
        )

    def _normalize_dict(self, d: dict[str, Any], source_module: str | None = None) -> list[UnifiedSignal]:
        """Normalize an arbitrary dictionary safely."""
        # Check if dict looks like a pre-existing UnifiedSignal
        if "rule_id" in d and "status" in d:
            rule_id = str(d["rule_id"])
            status = str(d["status"])
            value = d.get("value")
            evidence = deepcopy(d.get("evidence"))
            confidence = d.get("confidence", "high")
            mod = source_module or d.get("source_module", "unknown_module")
            applicability = d.get("applicability", "applicable")
            return [
                UnifiedSignal(
                    rule_id=rule_id,
                    status=status,
                    value=value,
                    evidence=evidence,
                    confidence=confidence,
                    source_module=mod,
                    applicability=applicability,
                    title=d.get("title"),
                    description=d.get("description"),
                    category=d.get("category"),
                    severity=d.get("severity"),
                    metadata=deepcopy(d.get("metadata", {})),
                )
            ]

        # Check if dict represents a signal_id
        if "signal_id" in d:
            return [self.normalize_trust_signal(d, source_module=source_module)]

        # Check if dict represents a finding
        if "finding_type" in d or ("type" in d and "title" in d and ("severity" in d or "description" in d)):
            return [self.normalize_finding(d, source_module=source_module)]

        # Check if dict represents an external source
        if "url" in d and ("domain" in d or "is_citation_candidate" in d or "availability_status" in d):
            return [self.normalize_external_source(d, source_module=source_module)]

        # Check if dict represents a claim
        if "claim_text" in d and ("claim_type" in d or "reason" in d):
            return [self.normalize_claim(d, source_module=source_module)]

        # Check if dict represents a quality check
        if "check_name" in d and "status" in d:
            return [self.normalize_quality_check_item(d, source_module=source_module)]

        # Generic key-value signal normalization fallback
        signals: list[UnifiedSignal] = []
        for k, v in d.items():
            if k.startswith("_"):
                continue
            signals.append(UnifiedSignal(
                rule_id=str(k),
                status="observed" if v is not None else "null",
                value=deepcopy(v),
                evidence={"raw_key": k, "raw_value": deepcopy(v)},
                confidence="high",
                source_module=source_module or "generic_telemetry",
                applicability="informational",
                title=f"Telemetry: {k}",
            ))
        return signals

    # -------------------------------------------------------------------------
    # Batch Normalization Helper
    # -------------------------------------------------------------------------

    def normalize_batch(self, items: list[Any], metadata: dict[str, Any] | None = None) -> UnifiedSignalBatch:
        """
        Normalize a heterogeneous batch of signal objects into a UnifiedSignalBatch.
        """
        signals: list[UnifiedSignal] = []
        for item in items:
            signals.extend(self.normalize(item))
        return UnifiedSignalBatch.from_signals(signals, metadata=metadata)

    # -------------------------------------------------------------------------
    # Utility Helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _confidence_from_numeric(conf: float | int | None) -> str:
        if conf is None:
            return "high"
        try:
            val = float(conf)
            if val >= 0.70:
                return "high"
            elif val >= 0.40:
                return "medium"
            else:
                return "low"
        except (ValueError, TypeError):
            return "high"


# Global singleton instance & convenience functions
_DEFAULT_NORMALIZER = UnifiedSignalNormalizer()


def normalize_signal(source_obj: Any, source_module: str | None = None, **kwargs) -> list[UnifiedSignal]:
    """Convenience function to normalize any signal object or contract."""
    return _DEFAULT_NORMALIZER.normalize(source_obj, source_module=source_module, **kwargs)


def normalize_signals(items: list[Any], metadata: dict[str, Any] | None = None) -> UnifiedSignalBatch:
    """Convenience function to normalize a collection of signal objects into a UnifiedSignalBatch."""
    return _DEFAULT_NORMALIZER.normalize_batch(items, metadata=metadata)


# Canonical Alias
UniversalSignalNormalizer = UnifiedSignalNormalizer

