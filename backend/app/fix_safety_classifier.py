"""
Three-Tier Safety Classification Engine for Fix Plans (Day 10 - Step 3)

Implements a deterministic, explainable safety classification system for all remediation proposals:
1. AUTO_SAFE:
   - Only deterministic, reversible, low-risk structural/technical fixes
     where the required change can be derived from existing evidence.
2. ASSISTED:
   - AI/content drafting may be useful, but a human must review and approve
     the proposal before application.
3. MANUAL_REVIEW:
   - Any change involving factual, legal, commercial, identity, credentials,
     expertise, or unsupported claims.
   - Conservative fallback for ambiguous or unclassified proposals.

Strict Architectural Invariants:
1. DETERMINISTIC & EXPLAINABLE:
   - Classification is a pure function of rule_id, category, fix_type, severity, and evidence.
2. CONSERVATIVE SAFETY POLICY:
   - When in doubt or evidence is incomplete, falls back to MANUAL_REVIEW.
3. ZERO UNAUTHORIZED MUTATION:
   - Safety classification classifies proposal risk; it does NOT execute, deploy, or
     automatically mutate websites.
4. NO FABRICATED CITATIONS OR FACTS:
   - Unsupported factual claims and author credentials are strictly MANUAL_REVIEW.
"""

from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class SafetyTier(str, Enum):
    """Canonical 3-tier safety classifications for remediation proposals."""
    AUTO_SAFE = "auto_safe"
    ASSISTED = "assisted"
    MANUAL_REVIEW = "manual_review"


# Canonical Rule-to-Safety Policy Registry
# Explicit deterministic mapping for known rules
AUTO_SAFE_RULES: set[str] = {
    # Structural DOM & Tag Rules
    "r-str-01",                     # Missing H1 heading
    "r-str-02",                     # Multiple H1 headings
    "r-str-03",                     # Heading hierarchy skip
    "missing_h1",
    "multiple_h1",
    "heading_hierarchy_issue",
    "heading_level_skip",
    "content_heading_structure",
    "r-chk-03",                     # Missing document title & H1
    
    # Meta Tags & Canonicals
    "missing_title",
    "title_empty",
    "title_too_short",
    "title_too_long",
    "missing_meta_description",
    "meta_description_empty",
    "meta_description_too_short",
    "meta_description_too_long",
    "r-str-05",                     # Title & H1 alignment
    "canonical_fix",
    "missing_canonical",
    "canonical_conflict",
    "canonical_multiple",
    "site_robots_txt",
    "site_sitemap_present",
    
    # Deterministic Schema Syntax (when fields exist in page extraction)
    "schema_markup",
    "schema_faq",
    "r-qna-03",                     # Missing FAQ / Q&A structured data
    "structured_data_missing",
    "structured_data_syntax",
    
    # Generic Anchor Text Remediation
    "source_generic_anchor_text",
    "anchor_text_fix",
}

ASSISTED_RULES: set[str] = {
    # Q&A / AEO Direct Answer Drafting
    "r-qna-01",                     # Unanswered question heading
    "r-qna-02",                     # Absence of direct answer snippet
    "aeo_answer_block",
    "content_question_unanswered",
    "r-red-01",                     # Low answer readiness score
    "readiness_analyzer",
    
    # Content Gap & Thin Section Expansion
    "r-gap-01",                     # Missing essential conceptual dimensions
    "content_gap_fill",
    "content_gap_unanswered_question",
    "quality_thin_content",
    "quality_empty_content",
    "r-chk-01",                     # Empty or missing content
    "r-chk-02",                     # Thin page content
    "content_expansion",
    
    # Topic & Semantic Coverage Expansion
    "r-top-01",                     # Primary topic absent from title/H1
    "r-top-02",                     # Keyword stuffing reduction
    "r-top-03",                     # Low lexical diversity expansion
    "authority_shallow_depth",
    "r-sem-01",                     # Low semantic coverage
    "content_semantic_coverage",
    "entity_optimization",
    "entity_linking",
    "r-int-01",                     # Conflicting search intent signals
    
    # Content Restructuring
    "r-str-04",                     # Long text block without subheadings
    
    # Internal Linking
    "internal_link_addition",
    "authority_lacks_internal_links",
}

MANUAL_REVIEW_RULES: set[str] = {
    # Author Credentials & Expertise Disclosures
    "authority_missing_credentials",
    "trust_author_credentials_present",
    "trust_byline_present",
    "author_credentials",
    "author_medical_credentials",
    "author_legal_credentials",
    
    # Claim Support & Empirical Citations
    "claim_unsupported_statistical",
    "claim_support_statistical",
    "claim_unsupported_superlative",
    "r-ev-01",                     # Unsupported superlative assertion
    "r-ev-02",                     # No empirical or quantitative data points
    "unsupported_claims",
    "unsupported_claim",
    
    # First-Party Trust, Legal Identity & Contact Disclosures
    "trust_missing_identity",
    "trust_business_conflict",
    "transparency_missing_first_party",
    "transparency_business_identity_consistent",
    "transparency_contact_conflict",
    "trust_contact_info_present",
    "trust_email_present",
    "privacy_policy_missing",
    "terms_missing",
    "commercial_policy_disclosure",
    
    # External Sourcing & Citation Readiness
    "source_broken_reference_link",
    "source_external_link_detected",
    "source_excessive_commercial_links",
    "readiness_low_structural_citation",
    "citation_readiness_level",
    "broken_external_source",
}


class FixSafetyClassification(BaseModel):
    """
    Structured outcome of deterministic safety classification for a fix proposal.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    safety_tier: SafetyTier = Field(..., description="Safety tier: auto_safe, assisted, or manual_review")
    policy_rule_id: str = Field(..., description="Canonical policy rule identifier")
    reason: str = Field(..., description="Deterministic explanation for the assigned safety tier")
    requires_human_approval: bool = Field(
        ...,
        description="Whether human review and explicit approval is required before applying",
    )
    auto_executable: bool = Field(
        default=False,
        description="Whether this fix is eligible for deterministic automated application",
    )
    risk_level: str = Field(default="low", description="Risk rating: low, medium, or high")
    review_checklist: list[str] = Field(
        default_factory=list,
        description="Step-by-step verification checklist for reviewers",
    )
    safe_bounds: dict[str, Any] = Field(
        default_factory=dict,
        description="Safety parameters (is_destructive, reversible, contains_factual_claims)",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional classification telemetry and source details",
    )


class FixSafetyClassifier:
    """
    Deterministic Three-Tier Safety Classifier for Fix Planning (Day 10 - Step 3).
    """

    @classmethod
    def classify(
        cls,
        finding_type: str | None = None,
        category: str | None = None,
        fix_type: str | None = None,
        severity: str | None = None,
        confidence: str | None = None,
        evidence: Any | None = None,
        proposed_action: str | None = None,
        root_cause_scope: str | None = None,
    ) -> FixSafetyClassification:
        """
        Deterministically classifies a fix proposal into AUTO_SAFE, ASSISTED, or MANUAL_REVIEW.

        Policy precedence:
        1. Explicit MANUAL_REVIEW rules (factual claims, credentials, legal/identity, broken citations)
        2. Explicit AUTO_SAFE rules (deterministic meta, canonicals, single H1, heading structure, schema syntax)
        3. Explicit ASSISTED rules (AI drafting for answers, gaps, subheadings, semantic expansion)
        4. Category & Fix-Type Fallback Heuristics
        5. Conservative Fallback to MANUAL_REVIEW if ambiguous or evidence incomplete
        """
        rule_key = str(finding_type or "").strip().lower()
        fix_key = str(fix_type or "").strip().lower()
        cat_key = str(category or "").strip().lower()
        action_text = str(proposed_action or "").strip().lower()

        # =========================================================================
        # 1. MANUAL_REVIEW Evaluation (Highest Precedence - Safety First)
        # =========================================================================
        
        # Check rule match
        if rule_key in MANUAL_REVIEW_RULES:
            return cls._build_manual_review_result(rule_key, "rule_match")

        # Check domain-sensitive content in action/category/evidence
        if cat_key in ("trust", "transparency", "authority_citations") and any(
            k in rule_key or k in action_text or k in fix_key
            for k in ("credential", "medical", "legal", "claim", "identity", "conflict", "privacy", "broken_reference")
        ):
            return cls._build_manual_review_result(rule_key or "domain_sensitive_trust", "domain_sensitive")

        # Unsupported claims or statistical data points always require manual review
        if "statistical" in rule_key or "unsupported" in rule_key or "superlative" in rule_key:
            return cls._build_manual_review_result(rule_key, "unsupported_claim")

        # Author credentials always require manual verification
        if "credential" in rule_key or "byline" in rule_key or "author" in rule_key:
            return cls._build_manual_review_result(rule_key, "credentials")

        # Business identity changes require manual verification
        if "identity" in rule_key or "business_name" in rule_key:
            return cls._build_manual_review_result(rule_key, "business_identity")

        # =========================================================================
        # 2. AUTO_SAFE Evaluation
        # =========================================================================

        # Check explicit rule match
        if rule_key in AUTO_SAFE_RULES:
            return cls._build_auto_safe_result(rule_key, fix_key, "rule_match")

        # Fix-type based deterministic meta tag or heading fixes
        if fix_key in ("meta_tag_improvement", "heading_structure_fix") and cat_key in ("seo", "structure"):
            return cls._build_auto_safe_result(rule_key or fix_key, fix_key, "fix_type_match")

        if fix_key == "technical_seo_correction" and ("canonical" in rule_key or "robots" in rule_key):
            return cls._build_auto_safe_result(rule_key or fix_key, fix_key, "technical_seo_deterministic")

        if fix_key == "structured_data_injection" and ("faq" in rule_key or "syntax" in rule_key or "r-qna-03" in rule_key):
            return cls._build_auto_safe_result(rule_key or fix_key, fix_key, "structured_data_syntax")

        # =========================================================================
        # 3. ASSISTED Evaluation
        # =========================================================================

        # Check explicit rule match
        if rule_key in ASSISTED_RULES:
            return cls._build_assisted_result(rule_key, fix_key, "rule_match")

        # Fix-type based assisted content expansion
        if fix_key in ("content_gap_fill", "aeo_answer_block", "entity_optimization", "internal_link_addition"):
            return cls._build_assisted_result(rule_key or fix_key, fix_key, "fix_type_match")

        if cat_key in ("questions", "readiness", "content_gaps", "semantic_coverage", "topic"):
            return cls._build_assisted_result(rule_key or cat_key, fix_key, "category_match")

        # =========================================================================
        # 4. Conservative Fallback -> MANUAL_REVIEW
        # =========================================================================
        return cls._build_manual_review_result(
            rule_key or "unknown_rule",
            "ambiguous_fallback",
            custom_reason="Remediation proposal is unclassified or ambiguous; defaults conservatively to Manual Review.",
        )

    # -------------------------------------------------------------------------
    # Result Builders
    # -------------------------------------------------------------------------

    @classmethod
    def _build_auto_safe_result(
        cls,
        rule_key: str,
        fix_key: str,
        match_type: str,
    ) -> FixSafetyClassification:
        """Constructs an AUTO_SAFE classification result."""
        if (
            "h1" in rule_key
            or "heading" in rule_key
            or "heading" in fix_key
            or rule_key in ("r-str-01", "r-str-02", "r-str-03", "missing_h1", "multiple_h1", "content_heading_structure")
        ):
            policy_id = "policy-auto-safe-heading-structure"
            reason = "Deterministic, reversible heading structure reorganization (H1/H2/H3) without prose modification."
        elif "canonical" in rule_key or "canonical" in fix_key:
            policy_id = "policy-auto-safe-canonical"
            reason = "Deterministic self-referencing or standard canonical URL tag configuration."
        elif "schema" in rule_key or "structured_data" in fix_key or rule_key in ("r-qna-03", "structured_data_missing"):
            policy_id = "policy-auto-safe-structured-data"
            reason = "Deterministic JSON-LD structured data injection derived from verified page content."
        elif "anchor" in rule_key or "anchor" in fix_key:
            policy_id = "policy-auto-safe-anchor-text"
            reason = "Deterministic substitution of generic anchor text with destination title."
        else:
            policy_id = "policy-auto-safe-meta-tags"
            reason = "Deterministic, reversible HTML meta/title tag configuration with bounded length rules."


        return FixSafetyClassification(
            safety_tier=SafetyTier.AUTO_SAFE,
            policy_rule_id=policy_id,
            reason=reason,
            requires_human_approval=False,
            auto_executable=True,
            risk_level="low",
            review_checklist=[
                "Verify target page URL and DOM selector",
                "Inspect proposed tag/element syntax for correctness",
                "Confirm change is non-destructive and easily reversible",
            ],
            safe_bounds={
                "is_destructive": False,
                "reversible": True,
                "contains_factual_claims": False,
                "requires_credentials": False,
            },
            metadata={"match_type": match_type, "rule_key": rule_key, "fix_key": fix_key},
        )

    @classmethod
    def _build_assisted_result(
        cls,
        rule_key: str,
        fix_key: str,
        match_type: str,
    ) -> FixSafetyClassification:
        """Constructs an ASSISTED classification result."""
        if "qna" in rule_key or "answer" in rule_key or "answer" in fix_key:
            policy_id = "policy-assisted-faq-answer-drafting"
            reason = "Drafted answer snippet requires human editorial review for accuracy, clarity, and tone."
        elif "gap" in rule_key or "content" in fix_key or "thin" in rule_key:
            policy_id = "policy-assisted-content-gap-fill"
            reason = "Substantive content expansion requires human editorial and domain review before publication."
        elif "top" in rule_key or "topic" in rule_key:
            policy_id = "policy-assisted-topical-expansion"
            reason = "Topic and subheading additions require editorial judgment to ensure topical relevance."
        elif "sem" in rule_key or "entity" in rule_key or "entity" in fix_key:
            policy_id = "policy-assisted-semantic-expansion"
            reason = "Semantic entity additions and disambiguation links require human verification."
        elif "link" in rule_key or "link" in fix_key:
            policy_id = "policy-assisted-internal-linking"
            reason = "Internal link additions require confirmation of contextual link relevance and anchor phrasing."
        else:
            policy_id = "policy-assisted-content-restructuring"
            reason = "Content modification or restructuring proposal requires human review and sign-off."

        return FixSafetyClassification(
            safety_tier=SafetyTier.ASSISTED,
            policy_rule_id=policy_id,
            reason=reason,
            requires_human_approval=True,
            auto_executable=False,
            risk_level="medium",
            review_checklist=[
                "Review AI/assisted content draft for factual accuracy and tone",
                "Verify brand voice alignment and readability",
                "Inspect layout and DOM rendering after content insertion",
                "Explicit human approval required prior to publishing",
            ],
            safe_bounds={
                "is_destructive": False,
                "reversible": True,
                "contains_factual_claims": False,
                "requires_credentials": False,
            },
            metadata={"match_type": match_type, "rule_key": rule_key, "fix_key": fix_key},
        )

    @classmethod
    def _build_manual_review_result(
        cls,
        rule_key: str,
        match_type: str,
        custom_reason: str | None = None,
    ) -> FixSafetyClassification:
        """Constructs a MANUAL_REVIEW classification result."""
        if "credential" in rule_key or "byline" in rule_key or "author" in rule_key:
            policy_id = "policy-manual-review-credentials"
            reason = (
                custom_reason
                or "Author credentials, academic qualifications, and professional affiliations must be verified "
                "by real authorized persons. Never fabricate author credentials."
            )
        elif "claim" in rule_key or "statistical" in rule_key or "superlative" in rule_key or "r-ev" in rule_key:
            policy_id = "policy-manual-review-unsupported-claims"
            reason = (
                custom_reason
                or "Factual and numerical claims require real primary data sources and manual citation attachment. "
                "Never fabricate citations, data points, or ungrounded facts."
            )
        elif "identity" in rule_key or "business" in rule_key or "transparency" in rule_key:
            policy_id = "policy-manual-review-business-identity"
            reason = (
                custom_reason
                or "Legal organization name, corporate registration, and business transparency disclosures "
                "require formal business verification."
            )
        elif "source" in rule_key or "broken" in rule_key or "citation" in rule_key:
            policy_id = "policy-manual-review-external-sources"
            reason = (
                custom_reason
                or "Selecting external authoritative sources or replacing broken citations requires human verification "
                "of third-party domains."
            )
        else:
            policy_id = "policy-manual-review-ambiguous-fallback"
            reason = custom_reason or "Uncertain or domain-sensitive remediation proposal defaults conservatively to Manual Review."

        return FixSafetyClassification(
            safety_tier=SafetyTier.MANUAL_REVIEW,
            policy_rule_id=policy_id,
            reason=reason,
            requires_human_approval=True,
            auto_executable=False,
            risk_level="high",
            review_checklist=[
                "Verify factual, credential, or legal statements with authorized organization stakeholders",
                "Confirm official third-party citation URLs are authentic, reputable, and accessible",
                "Verify legal entity disclosures match registered corporate details",
                "Explicit human sign-off required prior to any change",
            ],
            safe_bounds={
                "is_destructive": False,
                "reversible": False,
                "contains_factual_claims": True,
                "requires_credentials": True,
            },
            metadata={"match_type": match_type, "rule_key": rule_key},
        )


# =============================================================================
# Helper Convenience Functions
# =============================================================================

def classify_fix_safety(
    finding_type: str | None = None,
    category: str | None = None,
    fix_type: str | None = None,
    severity: str | None = None,
    confidence: str | None = None,
    evidence: Any | None = None,
    proposed_action: str | None = None,
    root_cause_scope: str | None = None,
) -> FixSafetyClassification:
    """Convenience helper to classify safety tier of any fix proposal."""
    return FixSafetyClassifier.classify(
        finding_type=finding_type,
        category=category,
        fix_type=fix_type,
        severity=severity,
        confidence=confidence,
        evidence=evidence,
        proposed_action=proposed_action,
        root_cause_scope=root_cause_scope,
    )
