"""
Deterministic Scoring & Traceability Engine (Task 8 - Steps 8.4 & 8.5)

Provides a centralized, auditable 0-100 scoring engine that converts applicable
normalized and aggregated intelligence signals across Task 5-7 into category scores
and an overall score, with full end-to-end traceability linking:

SCORE -> CATEGORY -> RULE -> SIGNAL -> EVIDENCE -> FINDING

Strict Architectural Invariants:
1. DETERMINISTIC & BOUNDED:
   - All scores are strictly numeric, clamped to [0.0, 100.0], reproducible, and order-independent.
2. STATUS SEMANTICS:
   - PASS: 100% credit (0 penalty).
   - WARNING: 50% partial credit (defined warning factor).
   - FAIL: 0% credit (full penalty).
   - N/A: Excluded from evaluation (0 penalty).
   - UNKNOWN: Insufficient data -> excluded from denominator (0 failure penalty).
3. DUPLICATE PENALTY PREVENTION:
   - The same underlying issue/rule cannot reduce the score multiple times.
4. FULL TRACEABILITY & AUDITABILITY:
   - Every contribution/deduction preserves rule_id, category, originating UnifiedSignal,
     evidence, confidence, source module, finding associations, and point impact.
5. NON-MUTATING & PURE:
   - Input objects and collections are never modified.
"""

from copy import deepcopy
from datetime import datetime, timezone
from enum import Enum
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .applicability_engine import (
    ApplicabilityContext,
    ApplicabilityEngine,
    ApplicabilityStatus,
    evaluate_applicability,
)
from .signal_aggregator import (
    AggregatedSignalCollection,
    SignalAggregator,
    aggregate_signals,
)
from .unified_signal import (
    ApplicabilityType,
    UnifiedSignal,
    UnifiedSignalBatch,
    UnifiedSignalNormalizer,
)


class ScoringCategory(str, Enum):
    """Canonical 5 scoring categories for Raval AI Search Intelligence."""
    TRUST_TRANSPARENCY = "trust_transparency"
    AUTHORITY_CITATIONS = "authority_citations"
    CONTENT_QUALITY = "content_quality"
    CONTENT_STRUCTURE = "content_structure"
    SEMANTIC_READINESS = "semantic_readiness"


# Default Category Names & Weights (Sum = 1.0 / 100%)
DEFAULT_CATEGORY_WEIGHTS: dict[str, float] = {
    ScoringCategory.TRUST_TRANSPARENCY.value: 0.20,
    ScoringCategory.AUTHORITY_CITATIONS.value: 0.25,
    ScoringCategory.CONTENT_QUALITY.value: 0.25,
    ScoringCategory.CONTENT_STRUCTURE.value: 0.15,
    ScoringCategory.SEMANTIC_READINESS.value: 0.15,
}

CATEGORY_NORMALIZED_WEIGHTS = DEFAULT_CATEGORY_WEIGHTS


CATEGORY_DISPLAY_NAMES: dict[str, str] = {
    ScoringCategory.TRUST_TRANSPARENCY.value: "Trust & Transparency",
    ScoringCategory.AUTHORITY_CITATIONS.value: "Authority & Citations",
    ScoringCategory.CONTENT_QUALITY.value: "Content Quality & Gaps",
    ScoringCategory.CONTENT_STRUCTURE.value: "Content & DOM Structure",
    ScoringCategory.SEMANTIC_READINESS.value: "Semantic Coverage & Readiness",
}


class ScoringConfig(BaseModel):
    """
    Centralized Scoring Configuration.
    Defines category weights, status credit ratios, warning factors, and rule-level weights.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    category_weights: dict[str, float] = Field(
        default_factory=lambda: deepcopy(DEFAULT_CATEGORY_WEIGHTS),
        description="Weights for each scoring category (must be positive, will be normalized to 1.0)",
    )
    pass_credit_ratio: float = Field(
        default=1.0,
        description="Credit ratio awarded for PASS status (default 1.0 = 100%)",
    )
    warning_credit_ratio: float = Field(
        default=0.5,
        description="Partial credit ratio awarded for WARNING status (default 0.5 = 50%)",
    )
    fail_credit_ratio: float = Field(
        default=0.0,
        description="Credit ratio awarded for FAIL status (default 0.0 = 0%)",
    )
    default_rule_weight: float = Field(
        default=1.0,
        description="Default weight assigned to individual rules",
    )
    rule_weights: dict[str, float] = Field(
        default_factory=dict,
        description="Custom rule-specific weight overrides (rule_id -> weight)",
    )
    neutral_category_score: float = Field(
        default=100.0,
        description="Baseline score assigned to a category when 0 active rules are evaluated",
    )


class ScoreContribution(BaseModel):
    """
    Complete Traceability Unit (Step 8.5).
    Captures every contribution or deduction linking:
    SCORE -> CATEGORY -> RULE -> SIGNAL -> EVIDENCE -> FINDING
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    rule_id: str = Field(..., description="Stable rule identifier")
    category: str = Field(..., description="Canonical scoring category")
    source_module: str = Field(..., description="Originating engine name")
    status: str = Field(..., description="Evaluated status (pass, fail, warning, n/a, unknown)")
    applicability: str = Field(..., description="Applicability status (applicable, not_applicable, conditional)")
    confidence: str = Field(default="high", description="Confidence level (high, medium, low)")
    value: Any | None = Field(default=None, description="Observed signal value")
    evidence: Any | None = Field(default=None, description="Traceable supporting evidence")
    weight: float = Field(default=1.0, description="Effective rule weight")
    credit_ratio: float = Field(default=1.0, description="Credit ratio achieved (0.0 to 1.0)")
    category_point_impact: float = Field(default=0.0, description="Percentage point contribution or deduction in category")
    overall_point_impact: float = Field(default=0.0, description="Percentage point contribution or deduction in overall score")
    is_penalized: bool = Field(default=False, description="Whether this rule incurred a penalty (FAIL or WARNING)")
    is_skipped: bool = Field(default=False, description="Whether this rule was excluded from scoring")
    skip_reason: str | None = Field(default=None, description="Reason for exclusion (not_applicable, insufficient_data, duplicate_prevention)")
    rationale: str = Field(default="", description="Explainable reason for the score contribution or exclusion")

    @field_validator("confidence", mode="before")
    @classmethod
    def _coerce_confidence(cls, v: Any) -> str:
        if isinstance(v, (int, float)):
            if v >= 0.8:
                return "high"
            elif v >= 0.5:
                return "medium"
            else:
                return "low"
        return str(v) if v is not None else "high"
    
    # Finding Association Link (Step 8.5)
    finding_id: str | None = Field(default=None, description="Associated finding ID if applicable")
    finding_type: str | None = Field(default=None, description="Associated finding type or code (e.g. R-STR-01)")
    finding_severity: str | None = Field(default=None, description="Associated finding severity (critical, high, medium, low)")
    
    # Originating Signal
    originating_signal: UnifiedSignal | None = Field(default=None, description="Clean copy of the originating UnifiedSignal")


class CategoryScoreResult(BaseModel):
    """Score breakdown for a specific category."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    category: str = Field(..., description="Canonical category key")
    name: str = Field(..., description="Display name of category")
    weight: float = Field(..., description="Category weight in overall score")
    score: float = Field(..., description="Calculated category score (0.0 to 100.0)")
    total_signals: int = Field(default=0, description="Total signals evaluated in category")
    passed_count: int = Field(default=0, description="Count of passed rules")
    failed_count: int = Field(default=0, description="Count of failed rules")
    warning_count: int = Field(default=0, description="Count of warning rules")
    na_count: int = Field(default=0, description="Count of N/A rules")
    unknown_count: int = Field(default=0, description="Count of UNKNOWN / missing data rules")
    contributions: list[ScoreContribution] = Field(default_factory=list, description="List of all score contributions in category")


class DeterministicScoreResult(BaseModel):
    """
    Final Output Envelope for Deterministic Scoring & Traceability (Steps 8.4 & 8.5).
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    overall_score: float = Field(..., description="Calculated overall score (0.0 to 100.0)")
    status: str = Field(..., description="Overall health tier (optimal, adequate, needs_improvement, deficient)")
    total_signals_evaluated: int = Field(default=0, description="Total raw signals evaluated")
    total_rules_applicable: int = Field(default=0, description="Total applicable rules evaluated")
    total_penalties_applied: int = Field(default=0, description="Total penalty deductions applied")
    total_duplicates_prevented: int = Field(default=0, description="Total duplicate penalties prevented")
    category_scores: dict[str, CategoryScoreResult] = Field(default_factory=dict, description="Category score breakdowns")
    traceability_chain: list[ScoreContribution] = Field(default_factory=list, description="Full audit trail of all score contributions")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Scoring execution metadata")

    def get_contributions_by_category(self, category: str) -> list[ScoreContribution]:
        """Retrieve all score contributions for a specific category."""
        target = category.strip().lower()
        return [c for c in self.traceability_chain if c.category.strip().lower() == target]

    def get_contributions_by_rule(self, rule_id: str) -> list[ScoreContribution]:
        """Retrieve all score contributions for a specific rule_id."""
        target = rule_id.strip().lower()
        return [c for c in self.traceability_chain if c.rule_id.strip().lower() == target]

    def get_penalized_contributions(self) -> list[ScoreContribution]:
        """Retrieve all contributions that incurred a penalty (FAIL or WARNING)."""
        return [c for c in self.traceability_chain if c.is_penalized and not c.is_skipped]

    def get_skipped_contributions(self) -> list[ScoreContribution]:
        """Retrieve all contributions that were skipped (N/A, UNKNOWN, or duplicate protection)."""
        return [c for c in self.traceability_chain if c.is_skipped]

    def get_finding_associations(self) -> list[dict[str, Any]]:
        """Retrieve all finding associations linked to score contributions."""
        associations = []
        for c in self.traceability_chain:
            if c.finding_id or c.finding_type:
                associations.append({
                    "rule_id": c.rule_id,
                    "category": c.category,
                    "finding_id": c.finding_id,
                    "finding_type": c.finding_type,
                    "finding_severity": c.finding_severity,
                    "status": c.status,
                    "is_penalized": c.is_penalized,
                })
        return associations

    def to_dict(self) -> dict[str, Any]:
        """Serialize complete score result to a dictionary."""
        return self.model_dump()


class DeterministicScoringEngine:
    """
    Deterministic Scoring & Traceability Engine (Steps 8.4 & 8.5).
    """

    def __init__(
        self,
        config: ScoringConfig | None = None,
        aggregator: SignalAggregator | None = None,
        applicability_engine: ApplicabilityEngine | None = None,
        normalizer: UnifiedSignalNormalizer | None = None,
    ):
        self.config = config or ScoringConfig()
        self.aggregator = aggregator or SignalAggregator()
        self.applicability_engine = applicability_engine or ApplicabilityEngine()
        self.normalizer = normalizer or UnifiedSignalNormalizer()

    def score(
        self,
        signals: Any,
        context: ApplicabilityContext | dict[str, Any] | None = None,
        config: ScoringConfig | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> DeterministicScoreResult:
        """
        Universal entry point to calculate deterministic 0-100 scores and traceability.
        Accepts list of UnifiedSignals, AggregatedSignalCollection, or raw Task 5-7 results.
        """
        active_config = config or self.config

        # 1. Normalize all inputs into a flat list of UnifiedSignal objects
        raw_signals: list[UnifiedSignal] = []
        prior_duplicate_count = 0

        if isinstance(signals, AggregatedSignalCollection):
            raw_signals = [s.model_copy(deep=True) for s in signals.signals]
            prior_duplicate_count = signals.duplicate_count or 0
        elif isinstance(signals, UnifiedSignalBatch):
            raw_signals = [s.model_copy(deep=True) for s in signals.signals]
        elif isinstance(signals, (list, tuple, set)):
            for item in signals:
                if item is None:
                    continue
                if isinstance(item, UnifiedSignal):
                    raw_signals.append(item.model_copy(deep=True))
                elif isinstance(item, (AggregatedSignalCollection, UnifiedSignalBatch)):
                    raw_signals.extend([s.model_copy(deep=True) for s in item.signals])
                    if isinstance(item, AggregatedSignalCollection):
                        prior_duplicate_count += (item.duplicate_count or 0)
                else:
                    normalized = self.normalizer.normalize(item)
                    raw_signals.extend(normalized)
        elif isinstance(signals, UnifiedSignal):
            raw_signals = [signals.model_copy(deep=True)]
        elif signals is not None:
            normalized = self.normalizer.normalize(signals)
            raw_signals.extend(normalized)

        # 2. Evaluate contextual applicability on each signal
        evaluated_signals: list[UnifiedSignal] = []
        for s in raw_signals:
            evaluated_signals.append(
                self.applicability_engine.evaluate_signal(s, context=context)
            )

        # 3. Categorize signals into canonical scoring categories
        categorized_signals: dict[str, list[UnifiedSignal]] = {
            cat.value: [] for cat in ScoringCategory
        }

        for sig in evaluated_signals:
            cat_key = self.map_signal_to_category(sig)
            categorized_signals[cat_key].append(sig.model_copy(deep=True))

        # 4. Normalize category weights across active categories
        raw_weights = active_config.category_weights
        total_configured_weight = sum(raw_weights.get(cat.value, 0.0) for cat in ScoringCategory)
        if total_configured_weight <= 0:
            total_configured_weight = 1.0

        normalized_weights: dict[str, float] = {
            cat.value: raw_weights.get(cat.value, 0.0) / total_configured_weight
            for cat in ScoringCategory
        }

        # 5. Calculate scores per category with duplicate penalty protection and full traceability
        category_results: dict[str, CategoryScoreResult] = {}
        all_contributions: list[ScoreContribution] = []
        seen_identity_keys: set[str] = set()
        total_penalties_applied = 0
        total_duplicates_prevented = prior_duplicate_count
        total_rules_applicable = 0

        for cat in ScoringCategory:
            cat_key = cat.value
            cat_signals = categorized_signals[cat_key]
            cat_weight = normalized_weights[cat_key]

            cat_contributions: list[ScoreContribution] = []
            active_weights_sum = 0.0
            active_credits_sum = 0.0

            passed_count = 0
            failed_count = 0
            warning_count = 0
            na_count = 0
            unknown_count = 0

            for sig in cat_signals:
                identity_key = self.aggregator.get_deduplication_key(sig)
                is_duplicate = identity_key in seen_identity_keys

                rule_id = sig.rule_id
                status = (sig.status or "").strip().lower()
                applicability = (sig.applicability or "applicable").strip().lower()
                rule_weight = active_config.rule_weights.get(rule_id, active_config.default_rule_weight)

                # Extract finding association if present
                finding_id, finding_type, finding_severity = self._extract_finding_info(sig)

                # Handle Duplicate Protection
                if is_duplicate:
                    total_duplicates_prevented += 1
                    contrib = ScoreContribution(
                        rule_id=rule_id,
                        category=cat_key,
                        source_module=sig.source_module,
                        status=status,
                        applicability=applicability,
                        confidence=sig.confidence,
                        value=deepcopy(sig.value),
                        evidence=deepcopy(sig.evidence),
                        weight=rule_weight,
                        credit_ratio=1.0,
                        category_point_impact=0.0,
                        overall_point_impact=0.0,
                        is_penalized=False,
                        is_skipped=True,
                        skip_reason="duplicate_prevention",
                        rationale="Duplicate signal excluded from scoring to prevent multiple penalties on the same issue.",
                        finding_id=finding_id,
                        finding_type=finding_type,
                        finding_severity=finding_severity,
                        originating_signal=sig.model_copy(deep=True),
                    )
                    cat_contributions.append(contrib)
                    all_contributions.append(contrib)
                    continue

                # Record newly seen identity key
                seen_identity_keys.add(identity_key)

                # Handle N/A
                if status == ApplicabilityStatus.NA.value or applicability == ApplicabilityType.NOT_APPLICABLE.value:
                    na_count += 1
                    contrib = ScoreContribution(
                        rule_id=rule_id,
                        category=cat_key,
                        source_module=sig.source_module,
                        status=ApplicabilityStatus.NA.value,
                        applicability=ApplicabilityType.NOT_APPLICABLE.value,
                        confidence=sig.confidence,
                        value=deepcopy(sig.value),
                        evidence=deepcopy(sig.evidence),
                        weight=rule_weight,
                        credit_ratio=1.0,
                        category_point_impact=0.0,
                        overall_point_impact=0.0,
                        is_penalized=False,
                        is_skipped=True,
                        skip_reason="not_applicable",
                        rationale="Rule is not applicable to the current page context; excluded with zero penalty.",
                        finding_id=finding_id,
                        finding_type=finding_type,
                        finding_severity=finding_severity,
                        originating_signal=sig.model_copy(deep=True),
                    )
                    cat_contributions.append(contrib)
                    all_contributions.append(contrib)
                    continue

                # Handle UNKNOWN / Insufficient Data
                if status == ApplicabilityStatus.UNKNOWN.value:
                    unknown_count += 1
                    contrib = ScoreContribution(
                        rule_id=rule_id,
                        category=cat_key,
                        source_module=sig.source_module,
                        status=ApplicabilityStatus.UNKNOWN.value,
                        applicability=applicability,
                        confidence=sig.confidence,
                        value=deepcopy(sig.value),
                        evidence=deepcopy(sig.evidence),
                        weight=rule_weight,
                        credit_ratio=1.0,
                        category_point_impact=0.0,
                        overall_point_impact=0.0,
                        is_penalized=False,
                        is_skipped=True,
                        skip_reason="insufficient_data",
                        rationale="Insufficient source data to evaluate rule; excluded from denominator without failure penalty.",
                        finding_id=finding_id,
                        finding_type=finding_type,
                        finding_severity=finding_severity,
                        originating_signal=sig.model_copy(deep=True),
                    )
                    cat_contributions.append(contrib)
                    all_contributions.append(contrib)
                    continue

                # Active Evaluated Signals: PASS, WARNING, FAIL
                total_rules_applicable += 1

                if status == ApplicabilityStatus.PASS.value or status in ("passed", "verified", "detected", "supported", "optimal", "strong"):
                    passed_count += 1
                    credit_ratio = active_config.pass_credit_ratio
                    is_penalized = False
                    rationale = f"Rule passed with verified evidence ('{status}'). Full credit awarded."
                elif status == ApplicabilityStatus.WARNING.value or status in ("warn", "warning", "partial", "moderate", "adequate", "caution", "weak"):
                    warning_count += 1
                    credit_ratio = active_config.warning_credit_ratio
                    is_penalized = True
                    total_penalties_applied += 1
                    rationale = f"Rule indicates cautionary condition ('{status}'). Partial credit ({int(credit_ratio * 100)}%) awarded."
                else:  # FAIL
                    failed_count += 1
                    credit_ratio = active_config.fail_credit_ratio
                    is_penalized = True
                    total_penalties_applied += 1
                    rationale = f"Rule failed due to defect or missing requirement ('{status}'). Full deduction applied."

                active_weights_sum += rule_weight
                active_credits_sum += (rule_weight * credit_ratio)

                contrib = ScoreContribution(
                    rule_id=rule_id,
                    category=cat_key,
                    source_module=sig.source_module,
                    status=status,
                    applicability=applicability,
                    confidence=sig.confidence,
                    value=deepcopy(sig.value),
                    evidence=deepcopy(sig.evidence),
                    weight=rule_weight,
                    credit_ratio=credit_ratio,
                    category_point_impact=0.0,  # Will be calculated below
                    overall_point_impact=0.0,   # Will be calculated below
                    is_penalized=is_penalized,
                    is_skipped=False,
                    skip_reason=None,
                    rationale=rationale,
                    finding_id=finding_id,
                    finding_type=finding_type,
                    finding_severity=finding_severity,
                    originating_signal=sig.model_copy(deep=True),
                )
                cat_contributions.append(contrib)
                all_contributions.append(contrib)

            # Calculate Category Score
            if active_weights_sum > 0:
                raw_cat_score = (active_credits_sum / active_weights_sum) * 100.0
                cat_score = round(min(100.0, max(0.0, raw_cat_score)), 2)
            else:
                cat_score = active_config.neutral_category_score

            # Calculate point impacts for active contributions in this category
            if active_weights_sum > 0:
                for c in cat_contributions:
                    if not c.is_skipped:
                        # Impact on category: (credit_ratio - 1.0) * (weight / active_weights_sum) * 100
                        # Positive for credit, negative for penalty relative to perfect score
                        point_delta = (c.credit_ratio - 1.0) * (c.weight / active_weights_sum) * 100.0
                        c.category_point_impact = round(point_delta, 2)
                        c.overall_point_impact = round(point_delta * cat_weight, 2)

            category_results[cat_key] = CategoryScoreResult(
                category=cat_key,
                name=CATEGORY_DISPLAY_NAMES.get(cat_key, cat_key),
                weight=round(cat_weight, 4),
                score=cat_score,
                total_signals=len(cat_signals),
                passed_count=passed_count,
                failed_count=failed_count,
                warning_count=warning_count,
                na_count=na_count,
                unknown_count=unknown_count,
                contributions=cat_contributions,
            )

        # 6. Calculate Weighted Overall Score
        weighted_score_sum = 0.0
        for cat in ScoringCategory:
            cat_key = cat.value
            cat_result = category_results[cat_key]
            weighted_score_sum += (cat_result.score * cat_result.weight)

        final_overall_score = round(min(100.0, max(0.0, weighted_score_sum)), 2)

        # Determine overall status tier
        if final_overall_score >= 80.0:
            overall_status = "optimal"
        elif final_overall_score >= 65.0:
            overall_status = "adequate"
        elif final_overall_score >= 50.0:
            overall_status = "needs_improvement"
        else:
            overall_status = "deficient"

        exec_metadata = deepcopy(metadata) if metadata else {}
        exec_metadata["scored_at"] = datetime.now(timezone.utc).isoformat()
        exec_metadata["scoring_version"] = "8.4_8.5"

        return DeterministicScoreResult(
            overall_score=final_overall_score,
            status=overall_status,
            total_signals_evaluated=len(evaluated_signals),
            total_rules_applicable=total_rules_applicable,
            total_penalties_applied=total_penalties_applied,
            total_duplicates_prevented=total_duplicates_prevented,
            category_scores=category_results,
            traceability_chain=all_contributions,
            metadata=exec_metadata,
        )

    def map_signal_to_category(self, signal: UnifiedSignal) -> str:
        """
        Deterministically maps a UnifiedSignal to one of the 5 canonical ScoringCategory values.
        """
        cat = (signal.category or "").strip().lower()
        mod = (signal.source_module or "").strip().lower()
        rule = (signal.rule_id or "").strip().lower()

        # 1. Trust & Transparency
        if cat in ("trust", "transparency", "business_identity", "contact", "authorship", "expertise", "legal_privacy") or \
           mod in ("trust_engine", "transparency_engine") or \
           any(rule.startswith(prefix) for prefix in ("trust_", "transparency_")):
            return ScoringCategory.TRUST_TRANSPARENCY.value

        # 2. Authority & Citations
        if cat in ("authority", "citation_readiness", "claims", "external_sources", "source_quality", "source_associations") or \
           mod in ("authority_engine", "source_engine", "claim_support_engine", "source_quality_engine", "citation_readiness_engine") or \
           any(rule.startswith(prefix) for prefix in ("authority_", "citation_", "source_", "claim_")):
            return ScoringCategory.AUTHORITY_CITATIONS.value

        # 3. Content Quality & Gaps
        if cat in ("quality_evidence", "content_checks", "content_gaps", "content_intelligence", "quality") or \
           mod in ("quality_analyzer", "content_gap_analyzer", "content_quality_checks", "content_intelligence") or \
           any(rule.startswith(prefix) for prefix in ("quality_", "content_gap_", "quality_check_")):
            return ScoringCategory.CONTENT_QUALITY.value

        # 4. Content Structure & DOM
        if cat in ("structure", "dom", "headings", "html_integrity") or \
           mod in ("content_structure_analyzer", "page_extractor") or \
           rule.startswith("r-str-") or rule.startswith("content_structure_") or \
           any(t in rule for t in ("heading", "h1", "h2", "h3", "title", "meta_desc")):
            return ScoringCategory.CONTENT_STRUCTURE.value

        # 5. Semantic Readiness & Topical Depth
        if cat in ("semantic_coverage", "topic", "search_intent", "questions", "answers", "readiness") or \
           mod in ("topic_analyzer", "intent_analyzer", "question_analyzer", "answer_analyzer", "readiness_analyzer", "semantic_coverage_analyzer") or \
           any(rule.startswith(prefix) for prefix in ("content_topic_", "content_intent_", "content_question_", "content_answer_", "content_readiness_", "content_semantic_")):
            return ScoringCategory.SEMANTIC_READINESS.value

        # Default fallback
        return ScoringCategory.CONTENT_QUALITY.value

    @staticmethod
    def _extract_finding_info(signal: UnifiedSignal) -> tuple[str | None, str | None, str | None]:
        """
        Extracts finding_id, finding_type, and finding_severity from signal metadata/evidence if present.
        """
        finding_id = None
        finding_type = None
        finding_severity = signal.severity

        if isinstance(signal.metadata, dict):
            finding_id = signal.metadata.get("finding_id") or signal.metadata.get("id")
            finding_type = signal.metadata.get("finding_type") or signal.metadata.get("type")
            if not finding_severity:
                finding_severity = signal.metadata.get("severity")

        if not finding_type and signal.rule_id.startswith("R-"):
            finding_type = signal.rule_id

        return str(finding_id) if finding_id else None, str(finding_type) if finding_type else None, str(finding_severity) if finding_severity else None


# Global singleton instance & convenience function
_DEFAULT_SCORING_ENGINE = DeterministicScoringEngine()


def calculate_deterministic_score(
    signals: Any,
    context: ApplicabilityContext | dict[str, Any] | None = None,
    config: ScoringConfig | None = None,
    metadata: dict[str, Any] | None = None,
) -> DeterministicScoreResult:
    """Convenience function to calculate deterministic score and traceability."""
    return _DEFAULT_SCORING_ENGINE.score(
        signals=signals,
        context=context,
        config=config,
        metadata=metadata,
    )
