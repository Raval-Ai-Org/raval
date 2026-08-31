"""
Priority & Recommendation Engine (Task 8 - Step 8.6)

Implements centralized, deterministic priority determination and evidence-backed
recommendation generation.

Converts score contributions and findings into:
- Priorities: Critical, High, Medium, Low, Info
- Recommendations: Classified into Quick Win (low effort / fast impact) vs Deep Fix (architectural / content expansion)

Strict Architectural Invariants:
1. DETERMINISTIC PRIORITY ASSIGNMENT:
   - Priority is computed multi-factorially based on score deduction impact, rule category,
     underlying severity, and evidence confidence.
2. EVIDENCE-BACKED & TRACEABLE:
   - Every recommendation links to rule_id, category, priority, evidence, and score impact.
3. STRICT STATUS RESPECT:
   - PASS findings do not generate negative recommendations.
   - N/A rules do not receive actionable priority or recommendations.
   - UNKNOWN / missing data is preserved as UNKNOWN and does not receive failure priority.
4. DUPLICATE PROTECTION & IDEMPOTENCY:
   - Duplicate findings / duplicate signals never produce duplicate recommendations.
"""

from copy import deepcopy
from datetime import datetime, timezone
from enum import Enum
import hashlib
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .scoring_engine import (
    DeterministicScoreResult,
    ScoreContribution,
    ScoringCategory,
)


class FindingPriority(str, Enum):
    """Canonical priority levels for findings and recommendations."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            val_lower = value.lower().strip()
            for member in cls:
                if member.value == val_lower:
                    return member
            if val_lower in ("crit", "urgent", "p0"):
                return cls.CRITICAL
            if val_lower in ("major", "p1", "high_priority"):
                return cls.HIGH
            if val_lower in ("moderate", "p2", "normal"):
                return cls.MEDIUM
            if val_lower in ("minor", "p3", "trivial"):
                return cls.LOW
            if val_lower in ("informational", "p4", "diagnostic"):
                return cls.INFO
        return cls.MEDIUM


class RecommendationClassification(str, Enum):
    """Classification of remediation effort and scope."""
    QUICK_WIN = "quick_win"
    DEEP_FIX = "deep_fix"


class PrioritizedRecommendation(BaseModel):
    """
    Evidence-backed, prioritized recommendation model.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    recommendation_id: str = Field(..., description="Deterministic unique recommendation identifier")
    finding_id: str | None = Field(default=None, description="Associated finding ID if applicable")
    rule_id: str = Field(..., description="Underlying rule identifier")
    category: str = Field(..., description="Canonical category (trust_transparency, authority_citations, etc.)")
    priority: str = Field(..., description="Priority tier (critical, high, medium, low, info)")
    classification: str = Field(..., description="Classification (quick_win, deep_fix)")
    title: str = Field(..., description="Concise, actionable recommendation title")
    explanation: str = Field(..., description="Why this recommendation is necessary based on observed evidence")
    recommended_action: str = Field(..., description="Concrete steps to implement the remediation")
    expected_impact: str | None = Field(default=None, description="Qualitative benefit of fixing the issue")
    score_impact: float = Field(default=0.0, description="Potential score points recovered upon fix")
    evidence: Any | None = Field(default=None, description="Preserved supporting evidence")
    status: str = Field(default="open", description="Recommendation status (open, resolved, in_progress, dismissed)")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Traceability and execution metadata")


# Rule to remediation knowledge base
RULE_REMEDIATION_MAP: dict[str, dict[str, Any]] = {
    # 1. Structure & DOM Rules (mostly Quick Wins)
    "r-str-01": {
        "title": "Add Single Primary H1 Heading",
        "action": "Ensure the document contains exactly one semantic <h1> element reflecting the primary topic.",
        "expected_benefit": "Clarifies content hierarchy for search crawlers and AI answer extractors.",
        "classification": RecommendationClassification.QUICK_WIN,
    },
    "missing_title": {
        "title": "Add Unique Descriptive Title Tag",
        "action": "Add a unique <title> tag between 50-60 characters incorporating primary keywords.",
        "expected_benefit": "Improves organic CTR, snippet display, and search indexing relevance.",
        "classification": RecommendationClassification.QUICK_WIN,
    },
    "missing_meta_description": {
        "title": "Add Compelling Meta Description",
        "action": "Author a high-CTR meta description between 120-160 characters summarizing the page.",
        "expected_benefit": "Increases organic click-through rates and snippet relevance.",
        "classification": RecommendationClassification.QUICK_WIN,
    },
    "content_heading_structure": {
        "title": "Repair Heading Hierarchy",
        "action": "Ensure headings ascend smoothly (H1 -> H2 -> H3) without skipping levels.",
        "expected_benefit": "Optimizes content parsing for LLM snippet extraction and web accessibility.",
        "classification": RecommendationClassification.QUICK_WIN,
    },

    # 2. Trust & Transparency Rules
    "trust_author_credentials_present": {
        "title": "Add Author Byline and Credentials",
        "action": "Display author name, title, credentials, and link to an author profile page with schema.org/Person markup.",
        "expected_benefit": "Establishes first-party E-E-A-T trust signals required for AI citation inclusion.",
        "classification": RecommendationClassification.QUICK_WIN,
    },
    "trust_byline_present": {
        "title": "Display Clear Author Byline",
        "action": "Add an explicit author byline near the article title with publication timestamp.",
        "expected_benefit": "Reinforces content freshness and editorial accountability.",
        "classification": RecommendationClassification.QUICK_WIN,
    },
    "trust_contact_info_present": {
        "title": "Add Verifiable Contact Details",
        "action": "Include physical address, support email, phone number, and a direct link to the Contact page in the footer.",
        "expected_benefit": "Provides fundamental first-party business transparency for search engines.",
        "classification": RecommendationClassification.QUICK_WIN,
    },
    "trust_email_present": {
        "title": "Publish Direct Contact Email",
        "action": "Provide a valid, domain-matched contact email address in the page header or footer.",
        "expected_benefit": "Validates business legitimacy and improves trust scores.",
        "classification": RecommendationClassification.QUICK_WIN,
    },
    "transparency_business_identity_consistent": {
        "title": "Harmonize Business Identity in DOM and Schema",
        "action": "Ensure legal organization name, logo, and address match identically between JSON-LD schema and page footer.",
        "expected_benefit": "Prevents entity confusion and strengthens brand graph recognition.",
        "classification": RecommendationClassification.QUICK_WIN,
    },

    # 3. Authority & Citations Rules
    "authority_topical_depth": {
        "title": "Deepen Topical Coverage and Subtopics",
        "action": "Expand thin sections with data, real-world examples, and comprehensive coverage of related subtopics.",
        "expected_benefit": "Enhances semantic depth, topical authority, and organic ranking potential.",
        "classification": RecommendationClassification.DEEP_FIX,
    },
    "source_external_link_detected": {
        "title": "Anchor Claims with Authoritative Citations",
        "action": "Add outbound reference links to primary sources, academic literature, or authoritative documentation.",
        "expected_benefit": "Transforms unsupported factual assertions into verifiable claims.",
        "classification": RecommendationClassification.DEEP_FIX,
    },
    "citation_readiness_level": {
        "title": "Improve Structural Citation Readiness",
        "action": "Structure factual statements with precise data points, direct sourcing, and verifiable entity associations.",
        "expected_benefit": "Directly enhances inclusion probability in AI search engine responses (Perplexity, Google AI Overviews).",
        "classification": RecommendationClassification.DEEP_FIX,
    },
    "claim_support_statistical": {
        "title": "Provide Verification Sources for Quantitative Claims",
        "action": "Attach primary data citations or research links to numerical and statistical claims.",
        "expected_benefit": "Protects against AI hallucination penalties and boosts claim credibility.",
        "classification": RecommendationClassification.DEEP_FIX,
    },

    # 4. Content Quality & Gaps Rules
    "quality_empty_content": {
        "title": "Populate Empty Page with Main Content",
        "action": "Add substantive body text addressing the primary user query and search intent.",
        "expected_benefit": "Prevents soft 404 penalties and indexing drops.",
        "classification": RecommendationClassification.DEEP_FIX,
    },
    "quality_thin_content": {
        "title": "Expand Thin Content",
        "action": "Increase article depth beyond minimal word count thresholds with meaningful analysis.",
        "expected_benefit": "Boosts comprehensive ranking signals and user engagement.",
        "classification": RecommendationClassification.DEEP_FIX,
    },
    "content_gap_unanswered_question": {
        "title": "Directly Answer Unaddressed User Questions",
        "action": "Add concise 40-60 word answer paragraphs immediately beneath core question subheadings.",
        "expected_benefit": "Optimizes answer-readiness for direct LLM quote extraction.",
        "classification": RecommendationClassification.QUICK_WIN,
    },

    # 5. Semantic Coverage & Intent Rules
    "content_semantic_coverage": {
        "title": "Broaden Semantic Entity Coverage",
        "action": "Integrate key co-occurring industry concepts, terminology, and semantic entities into the content.",
        "expected_benefit": "Improves semantic breadth and contextual relevance for broad search queries.",
        "classification": RecommendationClassification.DEEP_FIX,
    },
    "content_question_unanswered": {
        "title": "Provide Direct Answers to Heading Questions",
        "action": "Write concise, authoritative answers following question-formatted H2/H3 tags.",
        "expected_benefit": "Enables rich FAQ snippets and AI overview inclusion.",
        "classification": RecommendationClassification.QUICK_WIN,
    },
}


class PriorityConfig(BaseModel):
    """
    Centralized Priority & Recommendation Configuration.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    critical_point_impact_threshold: float = Field(
        default=12.0,
        description="Overall point deduction threshold triggering Critical priority",
    )
    high_point_impact_threshold: float = Field(
        default=6.0,
        description="Overall point deduction threshold triggering High priority",
    )
    medium_point_impact_threshold: float = Field(
        default=2.5,
        description="Overall point deduction threshold triggering Medium priority",
    )


class PriorityEngine:
    """
    Priority & Recommendation Engine (Step 8.6).
    """

    def __init__(self, config: PriorityConfig | None = None):
        self.config = config or PriorityConfig()

    def determine_priority(
        self,
        contribution: ScoreContribution,
        finding: Any | None = None,
    ) -> FindingPriority:
        """
        Deterministically computes priority from multi-factor inputs:
        - Severity (critical, high, medium, low, info)
        - Score deduction impact
        - Rule category
        - Status and applicability
        """
        status = (contribution.status or "").strip().lower()
        applicability = (contribution.applicability or "").strip().lower()

        # 1. Non-actionable or passing statuses receive INFO
        if status in ("pass", "passed", "verified", "detected", "supported") or \
           status in ("n/a", "not_applicable") or applicability == "not_applicable":
            return FindingPriority.INFO

        # 2. Insufficient data / UNKNOWN receives INFO (not failure priority)
        if status == "unknown" or contribution.is_skipped:
            return FindingPriority.INFO

        # 3. Explicit severity check from finding/contribution
        severity = ""
        if contribution.finding_severity:
            severity = contribution.finding_severity.lower().strip()
        elif finding and hasattr(finding, "severity") and finding.severity:
            severity = str(finding.severity).lower().strip()

        if severity in ("critical", "urgent"):
            return FindingPriority.CRITICAL

        # 4. Point Impact Checks (using absolute overall impact deduction)
        impact = abs(contribution.overall_point_impact)

        if impact >= self.config.critical_point_impact_threshold:
            return FindingPriority.CRITICAL
        if severity == "high" or impact >= self.config.high_point_impact_threshold:
            return FindingPriority.HIGH
        if severity == "medium" or impact >= self.config.medium_point_impact_threshold:
            return FindingPriority.MEDIUM
        if severity == "low" or status in ("warning", "warn", "partial"):
            return FindingPriority.LOW

        return FindingPriority.LOW

    def classify_recommendation(
        self,
        rule_id: str,
        category: str | None = None,
    ) -> RecommendationClassification:
        """
        Deterministically classifies remediation into Quick Win vs Deep Fix.
        """
        rule_clean = (rule_id or "").strip().lower()

        if rule_clean in RULE_REMEDIATION_MAP:
            return RULE_REMEDIATION_MAP[rule_clean]["classification"]

        # Heuristic rules
        # Tag/meta/heading/disclosure fixes are Quick Wins
        if any(term in rule_clean for term in ("title", "meta", "heading", "h1", "h2", "byline", "email", "phone", "contact", "schema", "r-str-")):
            return RecommendationClassification.QUICK_WIN

        # Deep content gaps, research claims, and authority expansions are Deep Fixes
        return RecommendationClassification.DEEP_FIX

    def generate_recommendation(
        self,
        contribution: ScoreContribution,
        finding: Any | None = None,
    ) -> PrioritizedRecommendation | None:
        """
        Generates an evidence-backed, prioritized recommendation for a single score contribution.
        Returns None for PASS, N/A, UNKNOWN, or skipped signals.
        """
        # Skip non-penalized or skipped rules
        if not contribution.is_penalized or contribution.is_skipped:
            return None

        status = (contribution.status or "").strip().lower()
        if status in ("pass", "n/a", "unknown"):
            return None

        rule_id = contribution.rule_id
        rule_clean = rule_id.strip().lower()
        priority = self.determine_priority(contribution, finding=finding)

        # Retrieve knowledge base template or generate from rule
        template = RULE_REMEDIATION_MAP.get(rule_clean)
        classification = self.classify_recommendation(rule_id, category=contribution.category)

        if template:
            title = template["title"]
            action = template["action"]
            expected_impact = template.get("expected_benefit", "Improves search intelligence score and AI visibility.")
        else:
            formatted_rule = rule_id.replace("_", " ").title()
            title = f"Remediate {formatted_rule}"
            action = f"Review and resolve non-compliant condition for rule '{rule_id}'."
            expected_impact = "Recovers lost score points in category."

        explanation = contribution.rationale or f"Observed status '{status}' caused a point deduction in {contribution.category}."
        score_impact = round(abs(contribution.overall_point_impact), 2)

        # Generate deterministic recommendation ID
        rec_id_raw = f"rec_{rule_clean}_{contribution.category}_{contribution.finding_id or 'gen'}"
        rec_id = f"rec_{hashlib.sha256(rec_id_raw.encode('utf-8')).hexdigest()[:12]}"

        metadata = {
            "rule_id": rule_id,
            "category": contribution.category,
            "source_module": contribution.source_module,
            "confidence": contribution.confidence,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        return PrioritizedRecommendation(
            recommendation_id=rec_id,
            finding_id=contribution.finding_id,
            rule_id=rule_id,
            category=contribution.category,
            priority=priority.value,
            classification=classification.value,
            title=title,
            explanation=explanation,
            recommended_action=action,
            expected_impact=expected_impact,
            score_impact=score_impact,
            evidence=deepcopy(contribution.evidence),
            status="open",
            metadata=metadata,
        )

    def generate_recommendations(
        self,
        score_result: DeterministicScoreResult,
        findings: list[Any] | None = None,
    ) -> list[PrioritizedRecommendation]:
        """
        Batch generates deduplicated, prioritized recommendations from a score result.
        Guarantees idempotency and prevents duplicate recommendations for the same issue.
        """
        recommendations: list[PrioritizedRecommendation] = []
        seen_recommendation_keys: set[str] = set()

        # Build lookup for findings by rule/type/id if provided
        finding_lookup: dict[str, Any] = {}
        if findings:
            for f in findings:
                if hasattr(f, "id") and f.id:
                    finding_lookup[str(f.id)] = f
                if hasattr(f, "finding_type") and f.finding_type:
                    finding_lookup[str(f.finding_type).lower()] = f
                elif hasattr(f, "type") and f.type:
                    finding_lookup[str(f.type).lower()] = f

        for contrib in score_result.traceability_chain:
            # Check if this rule is penalized and not skipped
            if not contrib.is_penalized or contrib.is_skipped:
                continue

            # Deterministic recommendation key: rule_id + category
            rec_key = f"{contrib.rule_id.strip().lower()}::{contrib.category.strip().lower()}"
            if rec_key in seen_recommendation_keys:
                continue

            associated_finding = None
            if contrib.finding_id and str(contrib.finding_id) in finding_lookup:
                associated_finding = finding_lookup[str(contrib.finding_id)]
            elif contrib.finding_type and str(contrib.finding_type).lower() in finding_lookup:
                associated_finding = finding_lookup[str(contrib.finding_type).lower()]

            rec = self.generate_recommendation(contrib, finding=associated_finding)
            if rec:
                seen_recommendation_keys.add(rec_key)
                recommendations.append(rec)

        # Sort recommendations deterministically by Priority (Critical > High > Medium > Low > Info), then score impact
        priority_order = {
            FindingPriority.CRITICAL.value: 4,
            FindingPriority.HIGH.value: 3,
            FindingPriority.MEDIUM.value: 2,
            FindingPriority.LOW.value: 1,
            FindingPriority.INFO.value: 0,
        }

        recommendations.sort(
            key=lambda r: (priority_order.get(r.priority, 0), r.score_impact),
            reverse=True,
        )

        return recommendations


# Global singleton instance & convenience functions
_DEFAULT_PRIORITY_ENGINE = PriorityEngine()


def determine_finding_priority(
    contribution: ScoreContribution,
    finding: Any | None = None,
) -> FindingPriority:
    """Convenience helper to calculate priority."""
    return _DEFAULT_PRIORITY_ENGINE.determine_priority(contribution, finding=finding)


def generate_prioritized_recommendations(
    score_result: DeterministicScoreResult,
    findings: list[Any] | None = None,
) -> list[PrioritizedRecommendation]:
    """Convenience helper to generate prioritized recommendations."""
    return _DEFAULT_PRIORITY_ENGINE.generate_recommendations(score_result, findings=findings)
