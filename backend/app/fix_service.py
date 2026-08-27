"""
Fix / Action Planning Foundation Service (Task 6.4)
Implements deterministic, reviewable Fix Plan creation and lifecycle management.
Safety Rule: Pure planning foundation; does NOT execute destructive changes,
CMS mutations, GitHub pushes, or automated site deployments.
"""

from datetime import datetime
from typing import Any
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from .models import Finding, FixPlan, Opportunity, PageResult, Recommendation, Scan, Website
from .schemas import FixPlanCreate, FixPlanUpdate

ALLOWED_FIX_STATUSES = {
    "draft",
    "proposed",
    "ready_for_review",
    "approved",
    "validated",
    "applied",
    "completed",
    "rejected",
    "failed",
    "cancelled",
}

# Valid forward transitions in the reviewable lifecycle
ALLOWED_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"ready_for_review", "proposed", "cancelled"},
    "proposed": {"ready_for_review", "validated", "approved", "rejected", "cancelled"},
    "ready_for_review": {"approved", "rejected", "draft", "proposed", "cancelled"},
    "approved": {"completed", "validated", "applied", "failed", "cancelled", "ready_for_review"},
    "validated": {"applied", "completed", "ready_for_review", "approved"},
    "applied": {"completed", "failed", "ready_for_review"},
    "completed": set(),  # Terminal state
    "failed": {"ready_for_review", "proposed", "draft", "cancelled"},
    "rejected": {"draft", "proposed", "cancelled"},
    "cancelled": {"draft", "proposed"},
}

ALLOWED_FIX_TYPES = {
    "meta_tag_improvement",
    "structured_data_injection",
    "heading_structure_fix",
    "content_gap_fill",
    "internal_link_addition",
    "entity_optimization",
    "aeo_answer_block",
    "technical_seo_correction",
    "general_fix",
}

ALLOWED_RISK_LEVELS = {"low", "medium", "high"}
ALLOWED_EFFORT_LEVELS = {"low", "medium", "high"}

# Mapping from recommendation action_type to fix_type and default risk
ACTION_TO_FIX_TYPE_MAP: dict[str, dict[str, Any]] = {
    "meta_tag_fix": {
        "fix_type": "meta_tag_improvement",
        "risk_level": "low",
        "default_effort": "low",
    },
    "schema_markup": {
        "fix_type": "structured_data_injection",
        "risk_level": "low",
        "default_effort": "medium",
    },
    "heading_fix": {
        "fix_type": "heading_structure_fix",
        "risk_level": "medium",
        "default_effort": "low",
    },
    "content_expansion": {
        "fix_type": "content_gap_fill",
        "risk_level": "medium",
        "default_effort": "medium",
    },
    "entity_linking": {
        "fix_type": "entity_optimization",
        "risk_level": "low",
        "default_effort": "low",
    },
    "internal_link_addition": {
        "fix_type": "internal_link_addition",
        "risk_level": "medium",
        "default_effort": "medium",
    },
    "canonical_fix": {
        "fix_type": "technical_seo_correction",
        "risk_level": "high",
        "default_effort": "low",
    },
}


def map_action_to_fix_type(action_type: str | None) -> tuple[str, str, str]:
    """
    Returns (fix_type, risk_level, default_effort).
    """
    act = str(action_type or "").lower()
    for prefix, config in ACTION_TO_FIX_TYPE_MAP.items():
        if prefix in act:
            return config["fix_type"], config["risk_level"], config["default_effort"]

    if "schema" in act:
        return "structured_data_injection", "low", "medium"
    if "heading" in act:
        return "heading_structure_fix", "medium", "low"
    if "meta" in act or "title" in act:
        return "meta_tag_improvement", "low", "low"
    if "content" in act or "answer" in act:
        return "content_gap_fill", "medium", "medium"
    if "entity" in act:
        return "entity_optimization", "low", "low"
    if "link" in act:
        return "internal_link_addition", "medium", "medium"

    return "general_fix", "medium", "medium"


def build_diff_payload(
    fix_type: str,
    target: str,
    finding: Finding | None,
    recommendation: Recommendation,
) -> dict[str, Any]:
    """
    Generates a structured, inspectable proposal diff payload without applying external changes.
    """
    if fix_type == "meta_tag_improvement":
        return {
            "target": target,
            "action": "replace_or_insert_meta_tag",
            "before": "<title>Missing or Unoptimized</title>",
            "after": f"<title>{recommendation.title}</title>",
            "guidelines": "Place inside <head> element. Target length 50-60 characters.",
        }
    elif fix_type == "structured_data_injection":
        return {
            "target": target,
            "action": "insert_json_ld_script",
            "before": "None",
            "after": {
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": [
                    {
                        "@type": "Question",
                        "name": "Target Question",
                        "acceptedAnswer": {"@type": "Answer", "text": "Concise verified answer."},
                    }
                ],
            },
            "guidelines": "Inject as <script type='application/ld+json'> in document head or body.",
        }
    elif fix_type == "heading_structure_fix":
        return {
            "target": target,
            "action": "reorder_heading_hierarchy",
            "before": "Unordered or missing H1 headings",
            "after": f"<h1>{recommendation.title}</h1>",
            "guidelines": "Ensure single H1, followed sequentially by H2 and H3 elements.",
        }
    elif fix_type == "content_gap_fill":
        return {
            "target": target,
            "action": "expand_content_section",
            "before": "Thin or missing topic section",
            "after": f"Structured authoritative section addressing: {recommendation.description}",
            "guidelines": "Draft 150-300 words of factual, verifiable content with clear subheadings.",
        }
    elif fix_type == "entity_optimization":
        return {
            "target": target,
            "action": "inject_entity_same_as",
            "before": "Entity without authoritative references",
            "after": {
                "sameAs": [
                    "https://www.wikidata.org/wiki/...",
                    "https://en.wikipedia.org/wiki/...",
                ]
            },
            "guidelines": "Add authoritative sameAs URLs to Organization or Person Schema.",
        }
    else:
        return {
            "target": target,
            "action": fix_type,
            "before": "Current state as reported in finding",
            "after": f"Remediated state: {recommendation.description}",
            "guidelines": "Review manual action plan before execution.",
        }


def generate_fix_plan_from_recommendation(
    db: Session,
    recommendation_id: int,
) -> FixPlan:
    """
    Deterministically converts a Recommendation into a reviewable FixPlan.
    Applies deduplication: updates existing fix plan with matching (recommendation_id, fix_type).
    """
    rec = db.get(Recommendation, recommendation_id)
    if rec is None:
        raise ValueError("Recommendation not found")

    finding = rec.finding
    website_id = finding.website_id if finding else 1
    scan_id = finding.scan_id if finding else None
    page_id = finding.page_id if finding else None
    opportunity_id = rec.opportunity_id

    fix_type, risk_level, default_effort = map_action_to_fix_type(rec.action_type)
    effort = rec.effort if hasattr(rec, "effort") and rec.effort else default_effort

    target_url = finding.page_result.url if (finding and finding.page_result) else f"Website #{website_id}"
    problem_statement = (
        f"Detected {finding.finding_type if finding else 'issue'}: {rec.description}. "
        f"Severity: {rec.priority}."
    )
    proposed_action = (
        f"Implement {fix_type} on {target_url}. Action: {rec.title}. "
        f"Guideline: Follow standard optimization patterns."
    )
    expected_outcome = (
        f"{rec.impact or 'Resolve detected issue and improve search performance'}. "
        f"Eliminates finding #{finding.id if finding else 'N/A'}."
    )

    diff_payload = build_diff_payload(fix_type, target_url, finding, rec)
    safety_checks = {
        "requires_manual_approval": True,
        "auto_executable": False,
        "verified_safe": True,
        "destructive": False,
        "review_checklist": [
            "Verify target page/URL is accurate",
            "Inspect diff payload for semantic correctness",
            "Ensure no breaking layout or styling regressions",
        ],
    }

    # Deduplication check: existing fix plan for same recommendation and fix_type
    existing = (
        db.query(FixPlan)
        .filter(
            FixPlan.recommendation_id == rec.id,
            FixPlan.fix_type == fix_type,
        )
        .first()
    )

    if existing is not None:
        existing.title = f"Fix Plan: {rec.title}"
        existing.description = f"Actionable remediation plan for recommendation #{rec.id} ({fix_type})"
        existing.problem_statement = problem_statement
        existing.proposed_action = proposed_action
        existing.expected_outcome = expected_outcome
        existing.estimated_effort = effort
        existing.risk_level = risk_level
        existing.priority = rec.priority
        existing.diff_payload = diff_payload
        existing.safety_checks = safety_checks
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return existing

    fix_plan = FixPlan(
        recommendation_id=rec.id,
        finding_id=finding.id if finding else None,
        opportunity_id=opportunity_id,
        website_id=website_id,
        scan_id=scan_id,
        page_id=page_id,
        fix_type=fix_type,
        title=f"Fix Plan: {rec.title}",
        description=f"Actionable remediation plan for recommendation #{rec.id} ({fix_type})",
        problem_statement=problem_statement,
        proposed_action=proposed_action,
        expected_outcome=expected_outcome,
        estimated_effort=effort,
        risk_level=risk_level,
        priority=rec.priority,
        status="draft",
        diff_payload=diff_payload,
        safety_checks=safety_checks,
    )

    db.add(fix_plan)
    db.commit()
    db.refresh(fix_plan)

    return fix_plan


def create_fix_plan(
    db: Session,
    payload: FixPlanCreate | dict[str, Any],
) -> FixPlan:
    """
    Manually creates a new FixPlan with relational validation.
    """
    data = payload.model_dump() if isinstance(payload, FixPlanCreate) else payload

    # Validate recommendation existence
    rec = db.get(Recommendation, data["recommendation_id"])
    if rec is None:
        raise ValueError("Recommendation not found")

    # Validate website existence
    website = db.get(Website, data["website_id"])
    if website is None:
        raise ValueError("Website not found")

    if not data.get("title") or not str(data["title"]).strip():
        raise ValueError("Title must not be empty")

    if not data.get("problem_statement") or not str(data["problem_statement"]).strip():
        raise ValueError("Problem statement must not be empty")

    if not data.get("proposed_action") or not str(data["proposed_action"]).strip():
        raise ValueError("Proposed action must not be empty")

    status = str(data.get("status", "draft")).lower()
    if status not in ALLOWED_FIX_STATUSES:
        raise ValueError(f"Invalid status: '{status}'. Allowed: {sorted(ALLOWED_FIX_STATUSES)}")

    fix_type = str(data.get("fix_type", "general_fix")).lower()
    risk_level = str(data.get("risk_level", "low")).lower()
    effort = str(data.get("estimated_effort", "medium")).lower()
    priority = str(data.get("priority", "medium")).lower()

    fix_plan = FixPlan(
        recommendation_id=data["recommendation_id"],
        finding_id=data.get("finding_id"),
        opportunity_id=data.get("opportunity_id"),
        website_id=data["website_id"],
        scan_id=data.get("scan_id"),
        page_id=data.get("page_id"),
        fix_type=fix_type,
        title=str(data["title"]).strip(),
        description=str(data.get("description", "")).strip(),
        problem_statement=str(data["problem_statement"]).strip(),
        proposed_action=str(data["proposed_action"]).strip(),
        expected_outcome=str(data.get("expected_outcome", "")).strip(),
        estimated_effort=effort,
        risk_level=risk_level,
        priority=priority,
        status=status,
        diff_payload=data.get("diff_payload"),
        safety_checks=data.get("safety_checks") or {"requires_manual_approval": True, "auto_executable": False},
    )

    db.add(fix_plan)
    db.commit()
    db.refresh(fix_plan)

    return fix_plan


def get_fix_plan(
    db: Session,
    fix_plan_id: int,
) -> FixPlan:
    """
    Retrieves a FixPlan by ID.
    """
    plan = db.get(FixPlan, fix_plan_id)
    if plan is None:
        raise ValueError("FixPlan not found")
    return plan


def transition_fix_plan_status(
    db: Session,
    fix_plan_id: int,
    new_status: str,
    comment: str | None = None,
) -> FixPlan:
    """
    Validates and performs a status transition according to the safety lifecycle:
    draft -> ready_for_review -> approved -> completed
    """
    plan = db.get(FixPlan, fix_plan_id)
    if plan is None:
        raise ValueError("FixPlan not found")

    target = str(new_status).lower().strip()
    if target not in ALLOWED_FIX_STATUSES:
        raise ValueError(f"Invalid status: '{target}'. Allowed values: {sorted(ALLOWED_FIX_STATUSES)}")

    current = plan.status
    if current == target:
        return plan

    allowed_next = ALLOWED_STATUS_TRANSITIONS.get(current, set())
    if target not in allowed_next:
        raise ValueError(
            f"Cannot transition fix plan from '{current}' to '{target}'. "
            f"Allowed transitions from '{current}': {sorted(allowed_next)}"
        )

    # Safety enforcement: Cannot transition to completed without being approved, validated, or applied
    if target == "completed" and current not in {"approved", "validated", "applied"}:
        raise ValueError("A fix plan must be 'approved', 'validated', or 'applied' before it can be marked 'completed'.")

    plan.status = target
    plan.updated_at = datetime.utcnow()

    safety = dict(plan.safety_checks or {})
    audit_history = list(safety.get("audit_history", []))
    audit_history.append(
        {
            "from_status": current,
            "to_status": target,
            "timestamp": datetime.utcnow().isoformat(),
            "comment": comment,
        }
    )
    safety["audit_history"] = audit_history
    plan.safety_checks = safety
    flag_modified(plan, "safety_checks")

    db.commit()
    db.refresh(plan)
    return plan


def update_fix_plan(
    db: Session,
    fix_plan_id: int,
    payload: FixPlanUpdate | dict[str, Any],
) -> FixPlan:
    """
    Updates editable fields of a FixPlan.
    """
    plan = db.get(FixPlan, fix_plan_id)
    if plan is None:
        raise ValueError("FixPlan not found")

    data = payload.model_dump(exclude_unset=True) if isinstance(payload, FixPlanUpdate) else payload

    if "status" in data and data["status"]:
        # Delegate status change to transition helper for lifecycle validation
        transition_fix_plan_status(db, fix_plan_id, data["status"])

    for field in [
        "title",
        "description",
        "problem_statement",
        "proposed_action",
        "expected_outcome",
        "estimated_effort",
        "risk_level",
        "priority",
    ]:
        if field in data and data[field] is not None:
            setattr(plan, field, str(data[field]).strip())

    if "diff_payload" in data:
        plan.diff_payload = data["diff_payload"]

    if "safety_checks" in data:
        plan.safety_checks = data["safety_checks"]

    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)
    return plan


def delete_fix_plan(
    db: Session,
    fix_plan_id: int,
) -> bool:
    """
    Deletes a FixPlan.
    """
    plan = db.get(FixPlan, fix_plan_id)
    if plan is None:
        raise ValueError("FixPlan not found")

    db.delete(plan)
    db.commit()
    return True


def list_fix_plans(
    db: Session,
    website_id: int | None = None,
    scan_id: int | None = None,
    recommendation_id: int | None = None,
    opportunity_id: int | None = None,
    status: str | None = None,
    fix_type: str | None = None,
    priority: str | None = None,
) -> list[FixPlan]:
    """
    Lists FixPlans with query filtering.
    """
    query = db.query(FixPlan)

    if website_id is not None:
        query = query.filter(FixPlan.website_id == website_id)

    if scan_id is not None:
        query = query.filter(FixPlan.scan_id == scan_id)

    if recommendation_id is not None:
        query = query.filter(FixPlan.recommendation_id == recommendation_id)

    if opportunity_id is not None:
        query = query.filter(FixPlan.opportunity_id == opportunity_id)

    if status:
        query = query.filter(FixPlan.status == status.lower().strip())

    if fix_type:
        query = query.filter(FixPlan.fix_type == fix_type.lower().strip())

    if priority:
        query = query.filter(FixPlan.priority == priority.lower().strip())

    return query.order_by(FixPlan.id.asc()).all()


def generate_fix_plans_for_scan(
    db: Session,
    scan_id: int,
) -> list[FixPlan]:
    """
    Batch generates fix plans for all recommendations in a scan.
    """
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError("Scan not found")

    recs = (
        db.query(Recommendation)
        .join(Finding, Recommendation.finding_id == Finding.id)
        .filter(Finding.scan_id == scan_id)
        .all()
    )

    plans: list[FixPlan] = []
    for r in recs:
        plan = generate_fix_plan_from_recommendation(db, r.id)
        if plan not in plans:
            plans.append(plan)

    return plans


def generate_fix_plans_for_website(
    db: Session,
    website_id: int,
) -> list[FixPlan]:
    """
    Batch generates fix plans across all recommendations for a website.
    """
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")

    recs = (
        db.query(Recommendation)
        .join(Finding, Recommendation.finding_id == Finding.id)
        .filter(Finding.website_id == website_id)
        .all()
    )

    plans: list[FixPlan] = []
    for r in recs:
        plan = generate_fix_plan_from_recommendation(db, r.id)
        if plan not in plans:
            plans.append(plan)

    return plans
