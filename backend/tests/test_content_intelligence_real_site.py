import pytest

from backend.scripts.verify_content_intelligence_real_site import (
    run_real_site_content_intelligence_verification,
)


def test_real_site_content_intelligence_verification():
    report = run_real_site_content_intelligence_verification("https://www.python.org/")

    assert report["success"] is True
    assert report["url"] == "https://www.python.org/"

    # Check Quality Checks
    qc = report["quality_checks"]
    assert qc["is_valid_content"] is True
    assert qc["failed_checks"] == 0
    assert qc["passed_checks"] >= 4

    # Check Content Intelligence
    ci = report["content_intelligence"]
    assert ci["overall_content_score"] > 0.0
    assert ci["word_count"] > 30
    assert ci["primary_intent"] in ("informational", "navigational", "qa_intent")
    assert ci["content_status"] in ("optimal", "needs_improvement")
