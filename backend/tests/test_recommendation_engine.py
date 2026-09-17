from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Finding, Opportunity, PageResult, Recommendation, Scan, Website
from app.recommendation_service import (
    ALLOWED_RECOMMENDATION_CATEGORIES,
    build_explainable_rationale,
    delete_recommendation,
    generate_recommendation_from_finding,
    generate_recommendation_from_opportunity,
    generate_recommendations_for_scan,
    generate_recommendations_for_website,
    list_recommendations,
    normalize_priority,
    update_recommendation,
)

client = TestClient(app)


def _setup_entities(db: Session, prefix: str = "RecEng"):
    website = Website(name=f"{prefix} Site", url=f"https://{prefix.lower()}.com")
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed", pages_crawled=1)
    db.add(scan)
    db.commit()
    db.refresh(scan)

    page = PageResult(
        scan_id=scan.id,
        url=f"https://{prefix.lower()}.com/docs",
        status_code=200,
        content_type="text/html",
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    finding = Finding(
        website_id=website.id,
        scan_id=scan.id,
        page_id=page.id,
        finding_type="missing_faq_schema",
        category="structured_data",
        title="Missing FAQ Schema",
        description="FAQ content found without schema markup.",
        severity="high",
        status="open",
        evidence={"questions": ["How do I start?", "Where is my key?"]},
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    opportunity = Opportunity(
        website_id=website.id,
        scan_id=scan.id,
        page_id=page.id,
        finding_id=finding.id,
        title="Inject FAQPage Structured Data",
        description="Add FAQPage JSON-LD markup to appear in AI Overviews.",
        opportunity_type="structured_data_enhancement",
        category="structured_data",
        status="identified",
        impact=0.80,
        effort=0.30,
        confidence=0.90,
        priority_score=0.80,
        priority="CRITICAL",
        rationale="Critical priority because impact is high and effort is low.",
        evidence={"questions_found": 2},
    )
    db.add(opportunity)
    db.commit()
    db.refresh(opportunity)

    return website, scan, page, finding, opportunity


def test_priority_normalization():
    assert normalize_priority("CRITICAL") == "critical"
    assert normalize_priority("high") == "high"
    assert normalize_priority("urgent") == "high"
    assert normalize_priority("medium") == "medium"
    assert normalize_priority("moderate") == "medium"
    assert normalize_priority("low") == "low"
    assert normalize_priority("info") == "low"
    assert normalize_priority("unknown") == "medium"
    assert normalize_priority(None) == "medium"


def test_explainable_rationale_construction():
    rat = build_explainable_rationale(
        why="Missing title tag detected",
        what="Add unique title tag between 50-60 characters",
        where="Page https://example.com",
        benefit="Improves SERP CTR",
        effort="low",
    )
    assert "WHY:" in rat
    assert "WHAT:" in rat
    assert "WHERE:" in rat
    assert "EXPECTED BENEFIT:" in rat
    assert "ESTIMATED EFFORT:" in rat


def test_generate_recommendation_from_finding():
    db = SessionLocal()
    try:
        website, scan, page, finding, op = _setup_entities(db, "FromFind")

        rec = generate_recommendation_from_finding(db, finding.id, opportunity_id=op.id)

        assert rec.id is not None
        assert rec.finding_id == finding.id
        assert rec.priority == "high"  # Inherited from finding severity 'high'
        assert rec.action_type == "schema_markup"
        assert "FAQPage" in rec.title
        assert rec.category == "structured_data"
        assert rec.effort == "medium"
        assert "WHY:" in rec.rationale
        assert rec.opportunity_id == op.id

        # Verify DB persistence
        db_rec = db.get(Recommendation, rec.id)
        assert db_rec is not None
        assert db_rec.finding.id == finding.id
    finally:
        db.close()


def test_generate_recommendation_from_opportunity_priority_inheritance():
    db = SessionLocal()
    try:
        website, scan, page, finding, op = _setup_entities(db, "FromOp")

        rec = generate_recommendation_from_opportunity(db, op.id)

        assert rec.id is not None
        assert rec.finding_id == finding.id
        assert rec.priority == "critical"  # Inherited from Opportunity priority 'CRITICAL'
        assert "WHY:" in rec.rationale
        assert rec.opportunity_id == op.id
        assert op.recommendation_id == rec.id
    finally:
        db.close()


def test_recommendation_deduplication():
    db = SessionLocal()
    try:
        website, scan, page, finding, op = _setup_entities(db, "Dedupe")

        # 1. First generation creates record
        rec1 = generate_recommendation_from_finding(db, finding.id)
        rec1_id = rec1.id

        # 2. Second generation updates in place
        rec2 = generate_recommendation_from_finding(db, finding.id)
        assert rec2.id == rec1_id

        # Verify only 1 recommendation exists for finding and action_type
        count = (
            db.query(Recommendation)
            .filter(
                Recommendation.finding_id == finding.id,
                Recommendation.action_type == "schema_markup",
            )
            .count()
        )
        assert count == 1
    finally:
        db.close()


def test_batch_generate_recommendations_for_scan_and_website():
    db = SessionLocal()
    try:
        website, scan, page, finding, op = _setup_entities(db, "BatchRec")

        scan_recs = generate_recommendations_for_scan(db, scan.id)
        assert len(scan_recs) >= 1
        assert scan_recs[0].priority in ("critical", "high", "medium", "low")

        web_recs = generate_recommendations_for_website(db, website.id)
        assert len(web_recs) >= 1
    finally:
        db.close()


def test_recommendation_update_and_delete():
    db = SessionLocal()
    try:
        website, scan, page, finding, _ = _setup_entities(db, "UpdDel")
        rec = generate_recommendation_from_finding(db, finding.id)

        # Update status and title
        updated = update_recommendation(
            db,
            rec.id,
            {"status": "in_progress", "title": "Updated Recommendation Title"},
        )
        assert updated.status == "in_progress"
        assert updated.title == "Updated Recommendation Title"

        # Invalid status should raise ValueError
        with pytest.raises(ValueError, match="Invalid status"):
            update_recommendation(db, rec.id, {"status": "invalid_status"})

        # Delete
        rec_id = rec.id
        assert delete_recommendation(db, rec_id) is True
        assert db.get(Recommendation, rec_id) is None
    finally:
        db.close()


def test_recommendation_extended_apis():
    db = SessionLocal()
    try:
        website, scan, page, finding, op = _setup_entities(db, "ExtApi")

        # 1. POST /api/v1/findings/{id}/generate-recommendations
        res1 = client.post(f"/api/v1/findings/{finding.id}/generate-recommendations")
        assert res1.status_code == 200
        rec_id = res1.json()["id"]

        # 2. POST /api/v1/opportunities/{id}/generate-recommendations
        res2 = client.post(f"/api/v1/opportunities/{op.id}/generate-recommendations")
        assert res2.status_code == 200

        # 3. GET /api/v1/recommendations with filters
        res3 = client.get(f"/api/v1/recommendations?scan_id={scan.id}&status=open")
        assert res3.status_code == 200
        items = res3.json()
        assert len(items) >= 1

        # 4. PATCH /api/v1/recommendations/{id}
        res4 = client.patch(
            f"/api/v1/recommendations/{rec_id}",
            json={"status": "resolved", "priority": "low"},
        )
        assert res4.status_code == 200
        assert res4.json()["status"] == "resolved"
        assert res4.json()["priority"] == "low"

        # 5. GET /api/v1/opportunities/{id}/recommendations
        res5 = client.get(f"/api/v1/opportunities/{op.id}/recommendations")
        assert res5.status_code == 200
        assert len(res5.json()) >= 1

        # 6. DELETE /api/v1/recommendations/{id}
        res6 = client.delete(f"/api/v1/recommendations/{rec_id}")
        assert res6.status_code == 200
        assert res6.json()["status"] == "success"
    finally:
        db.close()
