"""
Validation Engine Service (Tasks 6.5 & 6.6)
Implements deterministic, evidence-based validation of Fix Plans and Recommendations.
Evaluates before/after states, produces bounded scores and explainable results (PASS/FAIL/PARTIAL),
and closes the feedback loop to update FixPlan and Recommendation lifecycle statuses.
Safety Boundary: Operates strictly internally on simulated/collected signals. No external mutations.
"""

from datetime import datetime
from typing import Any
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from .models import Finding, FixPlan, Opportunity, PageResult, Recommendation, Scan, ValidationResult, Website
from .schemas import ValidationCreate

SUPPORTED_VALIDATION_TYPES = {
    "meta_tag_validation",
    "structured_data_validation",
    "heading_structure_validation",
    "content_gap_validation",
    "internal_link_validation",
    "entity_validation",
    "aeo_validation",
    "technical_seo_validation",
    "general_validation",
}

VALIDATION_RESULTS = {"PASS", "FAIL", "PARTIAL", "UNABLE_TO_VALIDATE"}
VALIDATION_STATUSES = {"pending", "in_progress", "completed", "failed", "unable_to_validate"}

FIX_TYPE_TO_VALIDATION_MAP = {
    "meta_tag_improvement": "meta_tag_validation",
    "structured_data_injection": "structured_data_validation",
    "heading_structure_fix": "heading_structure_validation",
    "content_gap_fill": "content_gap_validation",
    "internal_link_addition": "internal_link_validation",
    "entity_optimization": "entity_validation",
    "aeo_answer_block": "aeo_validation",
    "technical_seo_correction": "technical_seo_validation",
    "general_fix": "general_validation",
}


# ==========================================
# Deterministic Rule Evaluation Logic
# ==========================================

def _evaluate_meta_tag_rule(
    before_state: Any,
    after_state: Any,
    expected_outcome: str,
    finding: Finding | None,
) -> tuple[str, float, str, str, dict[str, Any]]:
    """
    Evaluates meta tag remediation (title, description, robots).
    """
    if not after_state:
        return (
            "FAIL",
            0.0,
            "After-state contains no meta tags.",
            "Meta tag remains missing or unconfigured in after-state.",
            {"what_changed": "none", "remaining_issues": ["Missing meta tag"]},
        )

    title = None
    desc = None
    if isinstance(after_state, dict):
        title = after_state.get("title")
        desc = after_state.get("description") or after_state.get("meta_description")
    elif isinstance(after_state, str):
        title = after_state

    # Check title evaluation
    if title is not None:
        title_str = str(title).strip()
        length = len(title_str)
        if 10 <= length <= 70:
            return (
                "PASS",
                1.0,
                f"Valid title tag configured ({length} chars): '{title_str[:40]}...'",
                f"Title tag successfully resolved to optimal length ({length} chars). Meets SEO standards.",
                {"what_changed": f"Title updated to length {length}", "remaining_issues": []},
            )
        elif length > 0:
            return (
                "PARTIAL",
                0.5,
                f"Title tag present but sub-optimal length ({length} chars): '{title_str[:40]}...'",
                f"Title tag is present but length ({length} chars) is outside optimal 10-70 character window.",
                {"what_changed": "Title present with non-ideal length", "remaining_issues": ["Title length sub-optimal"]},
            )
        else:
            return (
                "FAIL",
                0.0,
                "Title tag is empty.",
                "Title tag was provided as empty string.",
                {"what_changed": "none", "remaining_issues": ["Empty title tag"]},
            )

    # Check description evaluation
    if desc is not None:
        desc_str = str(desc).strip()
        length = len(desc_str)
        if 50 <= length <= 200:
            return (
                "PASS",
                1.0,
                f"Valid meta description configured ({length} chars).",
                f"Meta description meets optimal search snippet length ({length} chars).",
                {"what_changed": f"Meta description updated to length {length}", "remaining_issues": []},
            )
        elif length > 0:
            return (
                "PARTIAL",
                0.5,
                f"Meta description present but sub-optimal length ({length} chars).",
                f"Meta description length ({length} chars) is outside optimal 50-200 character window.",
                {"what_changed": "Meta description present with non-ideal length", "remaining_issues": ["Description length outside recommended bounds"]},
            )

    return (
        "FAIL",
        0.0,
        "No verifiable title or meta description found in after-state.",
        "Expected meta tag modification was not detected.",
        {"what_changed": "none", "remaining_issues": ["No valid tag detected"]},
    )


def _evaluate_structured_data_rule(
    before_state: Any,
    after_state: Any,
    expected_outcome: str,
    finding: Finding | None,
) -> tuple[str, float, str, str, dict[str, Any]]:
    """
    Evaluates JSON-LD or schema structured data presence and validity.
    """
    if not after_state:
        return (
            "FAIL",
            0.0,
            "No structured data markup present in after-state.",
            "Structured data markup was not found in page payload.",
            {"what_changed": "none", "remaining_issues": ["Missing structured data script"]},
        )

    schema_data = None
    if isinstance(after_state, dict):
        schema_data = after_state
    elif isinstance(after_state, list) and len(after_state) > 0 and isinstance(after_state[0], dict):
        schema_data = after_state[0]

    if schema_data:
        has_context = bool(schema_data.get("@context"))
        has_type = bool(schema_data.get("@type"))
        schema_type = schema_data.get("@type", "Unknown")

        if has_context and has_type:
            return (
                "PASS",
                1.0,
                f"Valid JSON-LD schema (@type: '{schema_type}') verified with complete @context.",
                f"Structured data successfully injected and validated with valid schema.org context and type '{schema_type}'.",
                {"what_changed": f"Injected valid JSON-LD schema {schema_type}", "remaining_issues": []},
            )
        elif has_type and not has_context:
            return (
                "PARTIAL",
                0.5,
                f"Schema markup present with @type '{schema_type}' but missing standard @context.",
                "Schema markup lacks valid '@context': 'https://schema.org'. Rich snippet qualification may fail.",
                {"what_changed": "Schema type present without context", "remaining_issues": ["Missing @context in JSON-LD"]},
            )

    return (
        "FAIL",
        0.0,
        "Malformed or empty structured data payload.",
        "Structured data is present but fails JSON-LD schema.org syntax requirements.",
        {"what_changed": "none", "remaining_issues": ["Malformed schema payload"]},
    )


def _evaluate_heading_rule(
    before_state: Any,
    after_state: Any,
    expected_outcome: str,
    finding: Finding | None,
) -> tuple[str, float, str, str, dict[str, Any]]:
    """
    Evaluates heading hierarchy and H1 single-occurrence compliance.
    """
    if not after_state:
        return (
            "FAIL",
            0.0,
            "No heading structure in after-state.",
            "Headings were not found in the verified document.",
            {"what_changed": "none", "remaining_issues": ["Missing heading data"]},
        )

    h1_count = 0
    if isinstance(after_state, dict):
        h1_count = int(after_state.get("h1_count", 0))
    elif isinstance(after_state, list):
        h1_count = sum(1 for h in after_state if str(h).lower().startswith("h1:") or (isinstance(h, dict) and h.get("level") == 1))

    if h1_count == 1:
        return (
            "PASS",
            1.0,
            "Exactly one H1 heading found. Hierarchy conforms to SEO standards.",
            "Page heading structure validated: exactly one H1 present, organizing main topic.",
            {"what_changed": "H1 count normalized to 1", "remaining_issues": []},
        )
    elif h1_count > 1:
        return (
            "FAIL",
            0.0,
            f"Multiple H1 headings detected ({h1_count}).",
            f"Page still contains {h1_count} H1 tags. Pages should contain exactly one H1 heading.",
            {"what_changed": f"H1 count is {h1_count}", "remaining_issues": ["Multiple H1 headings"]},
        )
    else:
        return (
            "FAIL",
            0.0,
            "No H1 heading found in after-state.",
            "Page is missing a primary H1 heading.",
            {"what_changed": "none", "remaining_issues": ["Missing primary H1"]},
        )


def _evaluate_content_gap_rule(
    before_state: Any,
    after_state: Any,
    expected_outcome: str,
    finding: Finding | None,
) -> tuple[str, float, str, str, dict[str, Any]]:
    """
    Evaluates content depth expansion and gap resolution.
    """
    before_words = 0
    after_words = 0

    if isinstance(before_state, dict):
        before_words = int(before_state.get("word_count", 0))
    if isinstance(after_state, dict):
        after_words = int(after_state.get("word_count", 0))
    elif isinstance(after_state, str):
        after_words = len(after_state.split())

    diff = after_words - before_words

    if after_words >= 300 and diff >= 50:
        return (
            "PASS",
            1.0,
            f"Content expanded by {diff} words (Total: {after_words} words). Sufficient depth.",
            f"Content expansion verified: added {diff} words, exceeding thin content and topic coverage thresholds.",
            {"what_changed": f"Added {diff} words", "remaining_issues": []},
        )
    elif diff > 0:
        return (
            "PARTIAL",
            0.5,
            f"Content slightly increased by {diff} words (Total: {after_words}).",
            f"Word count increased by {diff} words, but total depth remains below recommended target.",
            {"what_changed": f"Added {diff} words", "remaining_issues": ["Content depth still below target"]},
        )
    else:
        return (
            "FAIL",
            0.0,
            f"No content increase detected (Before: {before_words}, After: {after_words}).",
            "Content expansion not observed. Gap remains unaddressed.",
            {"what_changed": "none", "remaining_issues": ["No content expansion"]},
        )


def _evaluate_internal_link_rule(
    before_state: Any,
    after_state: Any,
    expected_outcome: str,
    finding: Finding | None,
) -> tuple[str, float, str, str, dict[str, Any]]:
    """
    Evaluates internal linking addition and anchor text coverage.
    """
    before_links = int(before_state.get("internal_link_count", 0)) if isinstance(before_state, dict) else 0
    after_links = int(after_state.get("internal_link_count", 0)) if isinstance(after_state, dict) else 0

    if isinstance(after_state, list):
        after_links = len(after_state)

    if after_links > before_links or after_links >= 3:
        return (
            "PASS",
            1.0,
            f"Internal links successfully increased from {before_links} to {after_links}.",
            "Internal link graph enriched with contextually relevant anchor links.",
            {"what_changed": f"Added {after_links - before_links} internal links", "remaining_issues": []},
        )
    else:
        return (
            "FAIL",
            0.0,
            f"Internal link count unchanged ({after_links} links).",
            "No new internal links detected. Orphan or linking weakness persists.",
            {"what_changed": "none", "remaining_issues": ["Missing internal links"]},
        )


def _evaluate_entity_rule(
    before_state: Any,
    after_state: Any,
    expected_outcome: str,
    finding: Finding | None,
) -> tuple[str, float, str, str, dict[str, Any]]:
    """
    Evaluates entity disambiguation and sameAs links.
    """
    if isinstance(after_state, dict):
        has_sameas = bool(after_state.get("same_as") or after_state.get("sameAs"))
        entity_name = after_state.get("name") or after_state.get("entity")
        if has_sameas and entity_name:
            return (
                "PASS",
                1.0,
                f"Entity '{entity_name}' disambiguated with authoritative sameAs reference.",
                "Knowledge graph node disambiguation verified with authoritative authority reference.",
                {"what_changed": f"Added sameAs authority for {entity_name}", "remaining_issues": []},
            )
        elif entity_name:
            return (
                "PARTIAL",
                0.6,
                f"Entity '{entity_name}' referenced without authoritative sameAs link.",
                "Entity mentioned in text but lacks Wikipedia/Wikidata sameAs URI for unambiguous grounding.",
                {"what_changed": "Entity mentioned", "remaining_issues": ["Missing sameAs authority URI"]},
            )

    return (
        "FAIL",
        0.0,
        "No entity optimization detected in after-state.",
        "Entity authority markup was not detected.",
        {"what_changed": "none", "remaining_issues": ["Entity remains unoptimized"]},
    )


def _evaluate_aeo_rule(
    before_state: Any,
    after_state: Any,
    expected_outcome: str,
    finding: Finding | None,
) -> tuple[str, float, str, str, dict[str, Any]]:
    """
    Evaluates direct answer presence for AI engine answer readiness.
    """
    answer_text = None
    if isinstance(after_state, dict):
        answer_text = after_state.get("direct_answer") or after_state.get("answer")
    elif isinstance(after_state, str):
        answer_text = after_state

    if answer_text:
        words = len(str(answer_text).split())
        if 15 <= words <= 85:
            return (
                "PASS",
                1.0,
                f"Direct answer block verified ({words} words). Optimal for AI citation snippets.",
                "Concise, authoritative answer block directly answers user search intent.",
                {"what_changed": f"Added direct answer ({words} words)", "remaining_issues": []},
            )
        elif words > 85:
            return (
                "PARTIAL",
                0.6,
                f"Direct answer present but verbose ({words} words).",
                "Answer block exceeds recommended snippet length (>85 words). May be truncated by AI answer engines.",
                {"what_changed": f"Answer added with {words} words", "remaining_issues": ["Answer text too long for optimal snippet"]},
            )
        else:
            return (
                "PARTIAL",
                0.5,
                f"Direct answer present but too short ({words} words).",
                "Answer is under 15 words; lacks sufficient topical context for standalone citation.",
                {"what_changed": f"Answer added with {words} words", "remaining_issues": ["Answer text too short"]},
            )

    return (
        "FAIL",
        0.0,
        "No direct answer block found in after-state.",
        "AEO answer block missing. AI engines cannot easily extract direct answers.",
        {"what_changed": "none", "remaining_issues": ["Missing direct answer"]},
    )


def _evaluate_technical_seo_rule(
    before_state: Any,
    after_state: Any,
    expected_outcome: str,
    finding: Finding | None,
) -> tuple[str, float, str, str, dict[str, Any]]:
    """
    Evaluates technical SEO corrections (canonical, robots, status code).
    """
    if isinstance(after_state, dict):
        canonical = after_state.get("canonical_url") or after_state.get("canonical")
        status_code = after_state.get("status_code", 200)

        if canonical and str(canonical).startswith("http") and status_code == 200:
            return (
                "PASS",
                1.0,
                f"Valid canonical URL '{canonical}' and HTTP status 200 verified.",
                "Technical SEO parameters verified: valid canonical tag and clean HTTP 200 response.",
                {"what_changed": f"Canonical set to {canonical}", "remaining_issues": []},
            )
        elif status_code != 200:
            return (
                "FAIL",
                0.0,
                f"Non-200 HTTP status ({status_code}) in after-state.",
                f"Page returned HTTP status {status_code}. Technical SEO error persists.",
                {"what_changed": f"HTTP status {status_code}", "remaining_issues": ["Non-200 HTTP status"]},
            )

    return (
        "FAIL",
        0.0,
        "Technical SEO issue unresolved in after-state.",
        "Expected canonical or technical directive was not properly applied.",
        {"what_changed": "none", "remaining_issues": ["Technical issue remains"]},
    )


def _evaluate_general_rule(
    before_state: Any,
    after_state: Any,
    expected_outcome: str,
    finding: Finding | None,
) -> tuple[str, float, str, str, dict[str, Any]]:
    """
    Fallback general evaluation.
    """
    if after_state and after_state != before_state:
        return (
            "PASS",
            1.0,
            "After-state differs from before-state and reflects expected change.",
            f"Remediation verified against expected outcome: '{expected_outcome[:80]}...'",
            {"what_changed": "State updated", "remaining_issues": []},
        )
    elif after_state and after_state == before_state:
        return (
            "FAIL",
            0.0,
            "After-state is identical to before-state. No modification detected.",
            "Proposed remediation was not observed in after-state.",
            {"what_changed": "none", "remaining_issues": ["No state difference"]},
        )
    return (
        "FAIL",
        0.0,
        "No after-state data available to verify remediation.",
        "Validation failed due to missing verification evidence.",
        {"what_changed": "none", "remaining_issues": ["Missing verification data"]},
    )


def evaluate_validation_rule(
    validation_type: str,
    before_state: Any,
    after_state: Any,
    expected_outcome: str,
    finding: Finding | None = None,
) -> tuple[str, float, str, str, dict[str, Any]]:
    """
    Dispatches to specific deterministic validation rule.
    Returns: (result, score, actual_result, explanation, feedback)
    """
    vt = validation_type.lower().strip()
    if vt == "meta_tag_validation":
        return _evaluate_meta_tag_rule(before_state, after_state, expected_outcome, finding)
    elif vt == "structured_data_validation":
        return _evaluate_structured_data_rule(before_state, after_state, expected_outcome, finding)
    elif vt == "heading_structure_validation":
        return _evaluate_heading_rule(before_state, after_state, expected_outcome, finding)
    elif vt == "content_gap_validation":
        return _evaluate_content_gap_rule(before_state, after_state, expected_outcome, finding)
    elif vt == "internal_link_validation":
        return _evaluate_internal_link_rule(before_state, after_state, expected_outcome, finding)
    elif vt == "entity_validation":
        return _evaluate_entity_rule(before_state, after_state, expected_outcome, finding)
    elif vt == "aeo_validation":
        return _evaluate_aeo_rule(before_state, after_state, expected_outcome, finding)
    elif vt == "technical_seo_validation":
        return _evaluate_technical_seo_rule(before_state, after_state, expected_outcome, finding)
    else:
        return _evaluate_general_rule(before_state, after_state, expected_outcome, finding)


# ==========================================
# Task 6.6 — Feedback Loop Integration
# ==========================================

def apply_validation_feedback(
    db: Session,
    validation: ValidationResult,
    fix_plan: FixPlan | None = None,
    recommendation: Recommendation | None = None,
) -> None:
    """
    Updates FixPlan and Recommendation lifecycle statuses based on validation result.
    Enforces safe bounds without infinite automatic loops.
    """
    result = validation.result

    if fix_plan is None and validation.fix_plan_id:
        fix_plan = db.get(FixPlan, validation.fix_plan_id)
    if recommendation is None and validation.recommendation_id:
        recommendation = db.get(Recommendation, validation.recommendation_id)

    # Feedback payload enrichment
    fb = dict(validation.feedback or {})
    fb["validated_at"] = datetime.utcnow().isoformat()
    fb["validation_id"] = validation.id

    if result == "PASS":
        fb["next_action"] = "Remediation verified successfully. No further action needed."
        fb["remediation_status"] = "resolved"

        # Update FixPlan status safely
        if fix_plan:
            # Transition to completed if approved/ready
            fix_plan.status = "completed"
            fix_plan.updated_at = datetime.utcnow()
            safety = dict(fix_plan.safety_checks or {})
            safety["validated"] = True
            safety["validation_result"] = "PASS"
            safety["validation_score"] = validation.validation_score
            fix_plan.safety_checks = safety
            flag_modified(fix_plan, "safety_checks")

        # Update Recommendation status safely
        if recommendation:
            recommendation.status = "resolved"
            rec_payload = dict(recommendation.payload or {})
            rec_payload["validation_result"] = "PASS"
            recommendation.payload = rec_payload
            flag_modified(recommendation, "payload")

    elif result == "PARTIAL":
        fb["next_action"] = "Remediation partially successful. Address remaining gaps before re-validating."
        fb["remediation_status"] = "in_progress"

        if fix_plan:
            fix_plan.status = "ready_for_review"
            fix_plan.updated_at = datetime.utcnow()
            safety = dict(fix_plan.safety_checks or {})
            safety["validated"] = False
            safety["validation_result"] = "PARTIAL"
            safety["validation_score"] = validation.validation_score
            fix_plan.safety_checks = safety
            flag_modified(fix_plan, "safety_checks")

        if recommendation:
            recommendation.status = "in_progress"
            rec_payload = dict(recommendation.payload or {})
            rec_payload["validation_result"] = "PARTIAL"
            recommendation.payload = rec_payload
            flag_modified(recommendation, "payload")

    else:  # FAIL
        fb["next_action"] = "Remediation failed verification. Re-examine diff payload and prepare revised plan."
        fb["remediation_status"] = "unresolved"

        # Track cycle count in feedback to prevent infinite automated loops
        prior_cycles = 0
        if fix_plan and fix_plan.safety_checks:
            prior_cycles = int(fix_plan.safety_checks.get("cycle_count", 0))
        elif fb.get("remediation_cycles"):
            prior_cycles = int(fb.get("remediation_cycles", 0))
        current_cycles = prior_cycles + 1
        fb["remediation_cycles"] = current_cycles

        if fix_plan:
            fix_plan.status = "ready_for_review"
            fix_plan.updated_at = datetime.utcnow()
            safety = dict(fix_plan.safety_checks or {})
            safety["validated"] = False
            safety["validation_result"] = "FAIL"
            safety["validation_score"] = validation.validation_score
            safety["cycle_count"] = current_cycles
            fix_plan.safety_checks = safety
            flag_modified(fix_plan, "safety_checks")

        if recommendation:
            recommendation.status = "open"
            rec_payload = dict(recommendation.payload or {})
            rec_payload["validation_result"] = "FAIL"
            rec_payload["cycle_count"] = current_cycles
            recommendation.payload = rec_payload
            flag_modified(recommendation, "payload")

    validation.feedback = fb
    flag_modified(validation, "feedback")
    db.commit()


# ==========================================
# Core Validation Service Functions
# ==========================================

def validate_fix_plan(
    db: Session,
    fix_plan_id: int,
    simulated_after_state: Any = None,
) -> ValidationResult:
    """
    Validates a FixPlan deterministically.
    Compares the plan's problem statement / proposed diff against after_state.
    Persists ValidationResult and executes Task 6.6 feedback loop.
    """
    fix_plan = db.get(FixPlan, fix_plan_id)
    if not fix_plan:
        raise ValueError(f"FixPlan with id {fix_plan_id} not found")

    finding = db.get(Finding, fix_plan.finding_id) if fix_plan.finding_id else None
    recommendation = db.get(Recommendation, fix_plan.recommendation_id) if fix_plan.recommendation_id else None

    validation_type = FIX_TYPE_TO_VALIDATION_MAP.get(fix_plan.fix_type, "general_validation")

    # Resolve before state
    before_state = None
    if fix_plan.diff_payload and isinstance(fix_plan.diff_payload, dict):
        before_state = fix_plan.diff_payload.get("before")

    # Resolve after state
    if simulated_after_state is not None:
        after_state = simulated_after_state
    elif fix_plan.diff_payload and isinstance(fix_plan.diff_payload, dict):
        after_state = fix_plan.diff_payload.get("after")
    else:
        after_state = None

    expected_outcome = fix_plan.expected_outcome or fix_plan.proposed_action

    # Run deterministic rule
    result, score, actual_result, explanation, feedback = evaluate_validation_rule(
        validation_type=validation_type,
        before_state=before_state,
        after_state=after_state,
        expected_outcome=expected_outcome,
        finding=finding,
    )

    # Check for existing validation for this fix plan to maintain idempotency
    existing = (
        db.query(ValidationResult)
        .filter(
            ValidationResult.fix_plan_id == fix_plan.id,
            ValidationResult.validation_type == validation_type,
        )
        .first()
    )

    if existing:
        val_record = existing
        val_record.status = "completed"
        val_record.result = result
        val_record.validation_score = score
        val_record.before_state = before_state
        val_record.after_state = after_state
        val_record.expected_result = expected_outcome
        val_record.actual_result = actual_result
        val_record.explanation = explanation
        val_record.feedback = feedback
        val_record.updated_at = datetime.utcnow()
    else:
        val_record = ValidationResult(
            fix_plan_id=fix_plan.id,
            recommendation_id=fix_plan.recommendation_id,
            finding_id=fix_plan.finding_id,
            opportunity_id=fix_plan.opportunity_id,
            website_id=fix_plan.website_id,
            scan_id=fix_plan.scan_id,
            page_id=fix_plan.page_id,
            validation_type=validation_type,
            status="completed",
            result=result,
            validation_score=score,
            before_state=before_state,
            after_state=after_state,
            expected_result=expected_outcome,
            actual_result=actual_result,
            explanation=explanation,
            feedback=feedback,
        )
        db.add(val_record)

    db.commit()
    db.refresh(val_record)

    # Apply Task 6.6 feedback loop
    apply_validation_feedback(db, val_record, fix_plan=fix_plan, recommendation=recommendation)
    db.refresh(val_record)
    return val_record


def validate_recommendation(
    db: Session,
    recommendation_id: int,
    simulated_after_state: Any = None,
) -> ValidationResult:
    """
    Validates a Recommendation directly.
    If a FixPlan exists, delegates to validate_fix_plan. Otherwise evaluates directly.
    """
    rec = db.get(Recommendation, recommendation_id)
    if not rec:
        raise ValueError(f"Recommendation with id {recommendation_id} not found")

    # If an associated fix plan exists, validate through it
    if rec.fix_plans:
        return validate_fix_plan(db, rec.fix_plans[0].id, simulated_after_state=simulated_after_state)

    finding = db.get(Finding, rec.finding_id) if rec.finding_id else None
    website_id = finding.website_id if finding else 1
    scan_id = finding.scan_id if finding else None
    page_id = finding.page_id if finding else None

    # Map recommendation action_type to validation_type
    action_type = str(rec.action_type or "general").lower().strip()
    if "meta" in action_type or "title" in action_type:
        val_type = "meta_tag_validation"
    elif "schema" in action_type:
        val_type = "structured_data_validation"
    elif "heading" in action_type:
        val_type = "heading_structure_validation"
    elif "content" in action_type:
        val_type = "content_gap_validation"
    elif "link" in action_type:
        val_type = "internal_link_validation"
    elif "entity" in action_type:
        val_type = "entity_validation"
    else:
        val_type = "general_validation"

    before_state = finding.description if finding else None
    after_state = simulated_after_state
    expected_outcome = rec.description or rec.title

    result, score, actual_result, explanation, feedback = evaluate_validation_rule(
        validation_type=val_type,
        before_state=before_state,
        after_state=after_state,
        expected_outcome=expected_outcome,
        finding=finding,
    )

    existing = (
        db.query(ValidationResult)
        .filter(
            ValidationResult.recommendation_id == rec.id,
            ValidationResult.validation_type == val_type,
        )
        .first()
    )

    if existing:
        val_record = existing
        val_record.status = "completed"
        val_record.result = result
        val_record.validation_score = score
        val_record.before_state = before_state
        val_record.after_state = after_state
        val_record.expected_result = expected_outcome
        val_record.actual_result = actual_result
        val_record.explanation = explanation
        val_record.feedback = feedback
        val_record.updated_at = datetime.utcnow()
    else:
        val_record = ValidationResult(
            recommendation_id=rec.id,
            finding_id=rec.finding_id,
            website_id=website_id,
            scan_id=scan_id,
            page_id=page_id,
            validation_type=val_type,
            status="completed",
            result=result,
            validation_score=score,
            before_state=before_state,
            after_state=after_state,
            expected_result=expected_outcome,
            actual_result=actual_result,
            explanation=explanation,
            feedback=feedback,
        )
        db.add(val_record)

    db.commit()
    db.refresh(val_record)

    apply_validation_feedback(db, val_record, recommendation=rec)
    db.refresh(val_record)
    return val_record


def create_validation(
    db: Session,
    payload: ValidationCreate | dict[str, Any],
) -> ValidationResult:
    """
    Manually creates and evaluates a ValidationResult record.
    """
    data = payload.model_dump() if isinstance(payload, ValidationCreate) else dict(payload)

    website = db.get(Website, data["website_id"])
    if not website:
        raise ValueError(f"Website with id {data['website_id']} not found")

    finding = db.get(Finding, data["finding_id"]) if data.get("finding_id") else None

    result, score, actual_result, explanation, feedback = evaluate_validation_rule(
        validation_type=data["validation_type"],
        before_state=data.get("before_state"),
        after_state=data.get("after_state"),
        expected_outcome=data["expected_result"],
        finding=finding,
    )

    val_record = ValidationResult(
        website_id=data["website_id"],
        fix_plan_id=data.get("fix_plan_id"),
        recommendation_id=data.get("recommendation_id"),
        finding_id=data.get("finding_id"),
        opportunity_id=data.get("opportunity_id"),
        scan_id=data.get("scan_id"),
        page_id=data.get("page_id"),
        validation_type=data["validation_type"],
        status="completed",
        result=result,
        validation_score=score,
        before_state=data.get("before_state"),
        after_state=data.get("after_state"),
        expected_result=data["expected_result"],
        actual_result=actual_result,
        explanation=explanation,
        feedback=feedback,
    )
    db.add(val_record)
    db.commit()
    db.refresh(val_record)

    apply_validation_feedback(db, val_record)
    db.refresh(val_record)
    return val_record


def get_validation(db: Session, validation_id: int) -> ValidationResult:
    val = db.get(ValidationResult, validation_id)
    if not val:
        raise ValueError(f"ValidationResult with id {validation_id} not found")
    return val


def list_validations(
    db: Session,
    website_id: int | None = None,
    scan_id: int | None = None,
    fix_plan_id: int | None = None,
    recommendation_id: int | None = None,
    finding_id: int | None = None,
    opportunity_id: int | None = None,
    status: str | None = None,
    result: str | None = None,
    validation_type: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[ValidationResult]:
    """
    Lists ValidationResult records with optional query filtering.
    """
    query = db.query(ValidationResult)

    if website_id is not None:
        query = query.filter(ValidationResult.website_id == website_id)
    if scan_id is not None:
        query = query.filter(ValidationResult.scan_id == scan_id)
    if fix_plan_id is not None:
        query = query.filter(ValidationResult.fix_plan_id == fix_plan_id)
    if recommendation_id is not None:
        query = query.filter(ValidationResult.recommendation_id == recommendation_id)
    if finding_id is not None:
        query = query.filter(ValidationResult.finding_id == finding_id)
    if opportunity_id is not None:
        query = query.filter(ValidationResult.opportunity_id == opportunity_id)
    if status is not None:
        query = query.filter(ValidationResult.status == status.strip().lower())
    if result is not None:
        query = query.filter(ValidationResult.result == result.strip().upper())
    if validation_type is not None:
        query = query.filter(ValidationResult.validation_type == validation_type.strip().lower())

    return query.order_by(ValidationResult.id.asc()).offset(offset).limit(limit).all()


def batch_validate_scan(
    db: Session,
    scan_id: int,
) -> list[ValidationResult]:
    """
    Batch validates all FixPlans in a scan.
    """
    scan = db.get(Scan, scan_id)
    if not scan:
        raise ValueError(f"Scan with id {scan_id} not found")

    fix_plans = db.query(FixPlan).filter(FixPlan.scan_id == scan_id).all()
    results: list[ValidationResult] = []

    for plan in fix_plans:
        val = validate_fix_plan(db, plan.id)
        results.append(val)

    return results


def batch_validate_website(
    db: Session,
    website_id: int,
) -> list[ValidationResult]:
    """
    Batch validates all FixPlans for a website.
    """
    website = db.get(Website, website_id)
    if not website:
        raise ValueError(f"Website with id {website_id} not found")

    fix_plans = db.query(FixPlan).filter(FixPlan.website_id == website_id).all()
    results: list[ValidationResult] = []

    for plan in fix_plans:
        val = validate_fix_plan(db, plan.id)
        results.append(val)

    return results
