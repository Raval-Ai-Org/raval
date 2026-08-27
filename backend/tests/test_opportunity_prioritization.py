import pytest

from app.opportunity_prioritization import (
    ALLOWED_OPPORTUNITY_CATEGORIES,
    ALLOWED_OPPORTUNITY_PRIORITIES,
    ALLOWED_OPPORTUNITY_STATUSES,
    PRIORITY_THRESHOLDS,
    calculate_opportunity_priority,
    category_and_type_to_effort,
    evidence_to_confidence,
    severity_to_impact,
)


def test_prioritization_formula_exact_values():
    # Score = 0.50 * Impact + 0.25 * Confidence + 0.25 * (1.0 - Effort)
    # Impact = 1.0, Confidence = 1.0, Effort = 0.0 -> Score = 0.5 + 0.25 + 0.25 = 1.0
    score, priority, rationale = calculate_opportunity_priority(
        impact=1.0,
        effort=0.0,
        confidence=1.0,
    )
    assert score == 1.0
    assert priority == "CRITICAL"
    assert "CRITICAL priority" in rationale

    # Impact = 0.0, Confidence = 0.0, Effort = 1.0 -> Score = 0.0
    score, priority, rationale = calculate_opportunity_priority(
        impact=0.0,
        effort=1.0,
        confidence=0.0,
    )
    assert score == 0.0
    assert priority == "LOW"
    assert "LOW priority" in rationale


def test_prioritization_score_boundaries():
    # Extreme inputs should be clamped to [0.0, 1.0]
    score_over, _, _ = calculate_opportunity_priority(impact=5.0, effort=-2.0, confidence=10.0)
    assert 0.0 <= score_over <= 1.0
    assert score_over == 1.0

    score_under, _, _ = calculate_opportunity_priority(impact=-5.0, effort=10.0, confidence=-2.0)
    assert 0.0 <= score_under <= 1.0
    assert score_under == 0.0


def test_priority_threshold_levels():
    # Thresholds: CRITICAL >= 0.80, HIGH >= 0.60, MEDIUM >= 0.40, LOW < 0.40
    # Case CRITICAL: Impact=0.9, Conf=0.9, Effort=0.2 (Ease=0.8) -> 0.45 + 0.225 + 0.20 = 0.875
    s1, p1, _ = calculate_opportunity_priority(0.9, 0.2, 0.9)
    assert s1 >= 0.80
    assert p1 == "CRITICAL"

    # Case HIGH: Impact=0.7, Conf=0.8, Effort=0.5 (Ease=0.5) -> 0.35 + 0.20 + 0.125 = 0.675
    s2, p2, _ = calculate_opportunity_priority(0.7, 0.5, 0.8)
    assert 0.60 <= s2 < 0.80
    assert p2 == "HIGH"

    # Case MEDIUM: Impact=0.5, Conf=0.6, Effort=0.6 (Ease=0.4) -> 0.25 + 0.15 + 0.10 = 0.50
    s3, p3, _ = calculate_opportunity_priority(0.5, 0.6, 0.6)
    assert 0.40 <= s3 < 0.60
    assert p3 == "MEDIUM"

    # Case LOW: Impact=0.2, Conf=0.4, Effort=0.8 (Ease=0.2) -> 0.10 + 0.10 + 0.05 = 0.25
    s4, p4, _ = calculate_opportunity_priority(0.2, 0.8, 0.4)
    assert s4 < 0.40
    assert p4 == "LOW"


def test_prioritization_monotonicity():
    # 1. Increasing impact strictly increases or keeps score equal
    low_imp_score, _, _ = calculate_opportunity_priority(0.3, 0.5, 0.7)
    high_imp_score, _, _ = calculate_opportunity_priority(0.8, 0.5, 0.7)
    assert high_imp_score > low_imp_score

    # 2. Increasing effort strictly decreases score (higher effort = lower ROI)
    low_effort_score, _, _ = calculate_opportunity_priority(0.6, 0.2, 0.7)
    high_effort_score, _, _ = calculate_opportunity_priority(0.6, 0.8, 0.7)
    assert low_effort_score > high_effort_score

    # 3. Increasing confidence increases score
    low_conf_score, _, _ = calculate_opportunity_priority(0.6, 0.5, 0.3)
    high_conf_score, _, _ = calculate_opportunity_priority(0.6, 0.5, 0.9)
    assert high_conf_score > low_conf_score


def test_prioritization_determinism_and_reproducibility():
    # 100 repeated evaluations with identical inputs yield identical outputs
    results = [calculate_opportunity_priority(0.75, 0.35, 0.85) for _ in range(100)]
    first_score, first_pri, first_rat = results[0]
    for score, pri, rat in results:
        assert score == first_score
        assert pri == first_pri
        assert rat == first_rat


def test_explainable_rationale_content():
    _, priority, rationale = calculate_opportunity_priority(
        impact=0.90,
        effort=0.25,
        confidence=0.85,
    )
    assert priority == "CRITICAL"
    assert "critical" in rationale.lower()
    assert "low (high ease of implementation)" in rationale.lower()
    assert "score:" in rationale.lower()


def test_severity_and_effort_helper_mappings():
    assert severity_to_impact("critical") == 1.0
    assert severity_to_impact("high") == 0.80
    assert severity_to_impact("medium") == 0.50
    assert severity_to_impact("low") == 0.25
    assert severity_to_impact("info") == 0.10
    assert severity_to_impact("unknown") == 0.50

    assert category_and_type_to_effort("technical_seo", "missing_title") == 0.25
    assert category_and_type_to_effort("structured_data", "faq_schema") == 0.30
    assert category_and_type_to_effort("content", "content_gap") == 0.55
    assert category_and_type_to_effort("architecture", "site_structure") == 0.75

    assert evidence_to_confidence({"items": [1, 2, 3]}) == 0.95
    assert evidence_to_confidence({"item": 1}) == 0.85
    assert evidence_to_confidence(None) == 0.70
