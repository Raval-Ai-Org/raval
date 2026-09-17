from fastapi.testclient import TestClient
import pytest

from app.content_quality_checks import (
    ContentQualityChecker,
    run_content_quality_checks,
)
from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Scan, Website

client = TestClient(app)


def test_valid_content_passes_checks():
    html = """
    <!DOCTYPE html>
    <html>
    <head><title>Geothermal Heating Overview</title></head>
    <body>
        <h1>Geothermal Heating Principles</h1>
        <p>Geothermal heat pumps transfer heat to or from the ground, utilizing the earth's natural thermal properties for energy conservation.</p>
    </body>
    </html>
    """
    text = "Geothermal Heating Principles. Geothermal heat pumps transfer heat to or from the ground, utilizing the earth's natural thermal properties for energy conservation."
    headings = [{"level": 1, "text": "Geothermal Heating Principles"}]

    result = run_content_quality_checks(
        raw_html=html,
        text_content=text,
        title="Geothermal Heating Overview",
        headings=headings,
    )

    assert result.is_valid_content is True
    assert result.total_checks >= 5
    assert result.failed_checks == 0
    assert result.passed_checks >= 4


def test_empty_content_fails_gracefully():
    result = run_content_quality_checks(
        raw_html="",
        text_content="",
        title=None,
        headings=[],
    )

    assert result.is_valid_content is False
    assert result.failed_checks >= 1
    empty_check = next((c for c in result.checks if c["check_name"] == "empty_content"), None)
    assert empty_check is not None
    assert empty_check["status"] == "fail"
    assert any(f["type"].startswith("content_check_failed") for f in result.findings)


def test_malformed_truncated_html():
    malformed_html = "<html><head><title>Unclosed Page</title><div><p>Some text without body tag"
    text = "Some text without body tag"

    result = run_content_quality_checks(
        raw_html=malformed_html,
        text_content=text,
        title="Unclosed Page",
        headings=[],
    )

    html_check = next((c for c in result.checks if c["check_name"] == "html_integrity"), None)
    assert html_check is not None
    assert html_check["status"] in ("warn", "fail")


def test_corrupted_control_characters_detected():
    corrupted_text = "Standard text with \x00\x01\x02 corrupted control characters."
    result = run_content_quality_checks(
        raw_html="<html><body><p>" + corrupted_text + "</p></body></html>",
        text_content=corrupted_text,
        title="Corrupted",
    )

    enc_check = next((c for c in result.checks if c["check_name"] == "text_encoding"), None)
    assert enc_check is not None
    assert enc_check["status"] == "fail"


def test_safe_execution_on_none_values():
    # Calling with pure None arguments must never raise an unhandled exception
    checker = ContentQualityChecker()
    result = checker.run_checks(
        raw_html=None,
        text_content=None,
        title=None,
        headings=None,
    )
    assert isinstance(result.total_checks, int)
    assert result.is_valid_content is False


def test_quality_checks_api_persistence():
    db = SessionLocal()
    try:
        website = Website(name="Checks Site", url="https://checks-site.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        page = PageResult(
            scan_id=scan.id,
            url="https://checks-site.com/broken",
            status_code=200,
            content="",  # empty content to trigger findings
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        extraction = PageExtraction(
            page_result_id=page.id,
            scan_id=scan.id,
            title_text="",
            h1_count=0,
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        res = client.get(f"/api/v1/pages/{page.id}/content-quality-checks?persist_findings=true")
        assert res.status_code == 200
        data = res.json()

        assert data["is_valid_content"] is False
        assert data["failed_checks"] >= 1

        persisted = db.query(Finding).filter(Finding.page_id == page.id).all()
        assert len(persisted) >= 1
        assert persisted[0].website_id == website.id

        # 404 test
        res404 = client.get("/api/v1/pages/999999/content-quality-checks")
        assert res404.status_code == 404
    finally:
        db.close()
