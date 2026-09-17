"""
End-to-End Intelligence Pipeline Service (Task 6.7)
Unifies and orchestrates Tasks 6.1 through 6.6 into a coherent, deterministic intelligence workflow:
Scan -> Findings -> Opportunities -> Prioritization -> Recommendations -> Fix Plans -> Validation -> Feedback.
Safety Boundary: Operates strictly within internal data models. No external writes or live LLM calls.
"""

from datetime import datetime
from typing import Any
from sqlalchemy.orm import Session

from .fix_service import generate_fix_plans_for_scan, generate_fix_plans_for_website, list_fix_plans
from .models import Finding, FixPlan, MonitoringRecord, Opportunity, Recommendation, Scan, ValidationResult, Website
from .monitoring_service import evaluate_scan_monitoring, evaluate_website_monitoring, get_website_health_status
from .opportunity_service import generate_opportunities_for_scan, generate_opportunities_for_website
from .recommendation_service import generate_recommendations_for_scan, generate_recommendations_for_website, list_recommendations
from .validation_service import batch_validate_scan, batch_validate_website, list_validations


def run_end_to_end_intelligence_pipeline(
    db: Session,
    website_id: int,
    scan_id: int | None = None,
    run_validations: bool = True,
) -> dict[str, Any]:
    """
    Executes the entire intelligence pipeline deterministically:
    1. Finding resolution
    2. Opportunity generation and prioritization (Tasks 6.1 & 6.2)
    3. Actionable recommendation synthesis (Task 6.3)
    4. Reviewable fix plan construction (Task 6.4)
    5. Evidence-based validation and feedback loop (Tasks 6.5 & 6.6)
    
    Safe with empty data (0 findings, 0 opportunities, etc.) and idempotent.
    """
    website = db.get(Website, website_id)
    if not website:
        raise ValueError(f"Website with id {website_id} not found")

    if scan_id is not None:
        scan = db.get(Scan, scan_id)
        if not scan:
            raise ValueError(f"Scan with id {scan_id} not found")
        if scan.website_id != website_id:
            raise ValueError(f"Scan with id {scan_id} does not belong to Website {website_id}")

    # Stage 1: Query Findings
    finding_query = db.query(Finding)
    if scan_id is not None:
        finding_query = finding_query.filter(Finding.scan_id == scan_id)
    else:
        finding_query = finding_query.filter(Finding.website_id == website_id)
    findings = finding_query.all()
    findings_count = len(findings)

    # Stage 2: Generate & Prioritize Opportunities (Tasks 6.1 & 6.2)
    if scan_id is not None:
        opportunities = generate_opportunities_for_scan(db, scan_id)
    else:
        opportunities = generate_opportunities_for_website(db, website_id)

    # Stage 3: Synthesize Recommendations (Task 6.3)
    if scan_id is not None:
        recommendations = generate_recommendations_for_scan(db, scan_id)
    else:
        recommendations = generate_recommendations_for_website(db, website_id)

    # Stage 4: Construct Fix Plans (Task 6.4)
    if scan_id is not None:
        fix_plans = generate_fix_plans_for_scan(db, scan_id)
    else:
        fix_plans = generate_fix_plans_for_website(db, website_id)

    # Stage 5: Validation & Feedback Loop (Tasks 6.5 & 6.6)
    validations: list[ValidationResult] = []
    if run_validations:
        if scan_id is not None:
            validations = batch_validate_scan(db, scan_id)
        else:
            validations = batch_validate_website(db, website_id)

    # Stage 6: Calculate Validation Metrics
    val_summary = {"PASS": 0, "FAIL": 0, "PARTIAL": 0}
    for val in validations:
        res = val.result
        if res in val_summary:
            val_summary[res] += 1

    # Stage 7: Monitoring & Delta Tracking (Task 6.10)
    monitoring_records: list[MonitoringRecord] = []
    if scan_id is not None:
        monitoring_records = evaluate_scan_monitoring(db, scan_id)
    else:
        monitoring_records = evaluate_website_monitoring(db, website_id)

    return {
        "website_id": website_id,
        "scan_id": scan_id,
        "status": "completed",
        "stage_counts": {
            "findings": findings_count,
            "opportunities": len(opportunities),
            "recommendations": len(recommendations),
            "fix_plans": len(fix_plans),
            "validations": len(validations),
            "monitoring": len(monitoring_records),
        },
        "validation_summary": val_summary,
        "opportunities": opportunities,
        "recommendations": recommendations,
        "fix_plans": fix_plans,
        "validations": validations,
        "monitoring_records": monitoring_records,
        "completed_at": datetime.utcnow(),
    }


def get_pipeline_summary(
    db: Session,
    website_id: int,
    scan_id: int | None = None,
) -> dict[str, Any]:
    """
    Returns pipeline aggregate counts, validation distribution, and health score.
    """
    website = db.get(Website, website_id)
    if not website:
        raise ValueError(f"Website with id {website_id} not found")

    if scan_id is not None:
        scan = db.get(Scan, scan_id)
        if not scan:
            raise ValueError(f"Scan with id {scan_id} not found")

    # Counts
    f_q = db.query(Finding).filter(Finding.scan_id == scan_id if scan_id else Finding.website_id == website_id)
    o_q = db.query(Opportunity).filter(Opportunity.scan_id == scan_id if scan_id else Opportunity.website_id == website_id)
    r_q = db.query(Recommendation).join(Finding).filter(Finding.scan_id == scan_id if scan_id else Finding.website_id == website_id)
    fp_q = db.query(FixPlan).filter(FixPlan.scan_id == scan_id if scan_id else FixPlan.website_id == website_id)
    v_q = db.query(ValidationResult).filter(ValidationResult.scan_id == scan_id if scan_id else ValidationResult.website_id == website_id)

    findings_count = f_q.count()
    opps_count = o_q.count()
    recs_count = r_q.count()
    fix_plans_count = fp_q.count()
    validations = v_q.all()

    val_summary = {"PASS": 0, "FAIL": 0, "PARTIAL": 0}
    for val in validations:
        if val.result in val_summary:
            val_summary[val.result] += 1

    # Health score: 1.0 - (unresolved findings / total findings)
    total_val = len(validations)
    pass_val = val_summary["PASS"]
    health_score = round(pass_val / total_val, 2) if total_val > 0 else (1.0 if findings_count == 0 else 0.5)

    health_status = "healthy"
    if health_score < 0.50:
        health_status = "critical"
    elif health_score < 0.80:
        health_status = "warning"

    m_q = db.query(MonitoringRecord).filter(MonitoringRecord.scan_id == scan_id if scan_id else MonitoringRecord.website_id == website_id)
    monitoring_count = m_q.count()

    return {
        "website_id": website_id,
        "scan_id": scan_id,
        "stage_counts": {
            "findings": findings_count,
            "opportunities": opps_count,
            "recommendations": recs_count,
            "fix_plans": fix_plans_count,
            "validations": total_val,
            "monitoring": monitoring_count,
        },
        "validation_summary": val_summary,
        "health_score": health_score,
        "health_status": health_status,
    }
