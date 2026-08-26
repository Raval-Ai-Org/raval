import pytest

from app.content_intelligence_analyzer import analyze_content_intelligence
from app.quality_analyzer import analyze_quality
from app.question_analyzer import analyze_questions, is_question_text
from app.topic_analyzer import analyze_topic_semantics


def test_copyright_year_not_counted_as_scientific_data_point():
    text = "Welcome to our documentation site. © 2001-2025 Python Software Foundation. All rights reserved."
    evidence = analyze_quality(text_content=text)

    # 2001 or 2025 in copyright boilerplate should not be classified as empirical data points
    assert evidence.data_points_count == 0


def test_instructional_superlative_not_flagged_as_unsupported_claim():
    text = "For the best viewing experience, please enable JavaScript in your browser settings."
    evidence = analyze_quality(text_content=text)

    # Should not flag browser instruction as an unsupported commercial/scientific claim
    assert evidence.unsupported_claims_count == 0


def test_ui_and_cookie_prompts_not_detected_as_questions():
    assert is_question_text("Accept cookies?") is False
    assert is_question_text("Got it?") is False
    assert is_question_text("Search?") is False
    assert is_question_text("Sign in?") is False
    assert is_question_text("Need help?") is False

    # Legitimate questions must still be detected
    assert is_question_text("How does solar battery storage work?") is True
    assert is_question_text("What is the cost of heat pump installation?") is True


def test_navigation_and_boilerplate_not_selected_as_primary_topic():
    text = "Skip to main content. Navigation menu. Search this site. Python Programming Language overview and ecosystem."
    headings = [
        {"level": 1, "text": "Python Programming Language"},
        {"level": 2, "text": "Navigation and Search"},
    ]
    evidence = analyze_topic_semantics(text_content=text, title="Python Language", headings=headings)

    # Primary topic should reflect substantive content, not navigation boilerplate
    assert evidence.primary_topic is not None
    assert "navigation" not in evidence.primary_topic.lower()
    assert "search" not in evidence.primary_topic.lower()
    assert "python" in evidence.primary_topic.lower() or "programming" in evidence.primary_topic.lower()
