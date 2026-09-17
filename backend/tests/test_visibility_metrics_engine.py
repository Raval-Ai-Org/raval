"""
Unit tests for Step 6 Visibility Metrics Calculation Engine.
Tests metric formulas, denominator rules, failure isolation, and change calculations.
"""

from datetime import datetime, timezone
import pytest

from backend.app.visibility_metrics_service import (
    MetricRate,
    OperationalHealthMetrics,
    TargetVsCompetitorStats,
    calculate_change,
    compute_metric_rate,
)


def test_compute_metric_rate():
    # Normal fraction
    mr1 = compute_metric_rate(3, 4)
    assert mr1.numerator == 3
    assert mr1.denominator == 4
    assert mr1.rate == 0.75

    # Zero numerator
    mr2 = compute_metric_rate(0, 10)
    assert mr2.numerator == 0
    assert mr2.denominator == 10
    assert mr2.rate == 0.0

    # Zero denominator (safe null handling)
    mr3 = compute_metric_rate(0, 0)
    assert mr3.numerator == 0
    assert mr3.denominator == 0
    assert mr3.rate is None

    # Serialization
    d1 = mr1.to_dict()
    assert d1["rate"] == 0.75
    d3 = mr3.to_dict()
    assert d3["rate"] is None


def test_calculate_change_positive_and_negative():
    # Positive growth
    abs_chg, rel_pct = calculate_change(0.60, 0.40)
    assert abs_chg == 0.20
    assert rel_pct == 50.0

    # Negative decline
    abs_chg, rel_pct = calculate_change(0.30, 0.50)
    assert abs_chg == -0.20
    assert rel_pct == -40.0

    # No change
    abs_chg, rel_pct = calculate_change(0.50, 0.50)
    assert abs_chg == 0.0
    assert rel_pct == 0.0


def test_calculate_change_zero_and_none_handling():
    # Zero previous value -> relative change is undefined/None
    abs_chg, rel_pct = calculate_change(0.50, 0.0)
    assert abs_chg == 0.50
    assert rel_pct is None

    # Current value is None
    abs_chg, rel_pct = calculate_change(None, 0.50)
    assert abs_chg is None
    assert rel_pct is None

    # Previous value is None
    abs_chg, rel_pct = calculate_change(0.50, None)
    assert abs_chg is None
    assert rel_pct is None

    # Both None
    abs_chg, rel_pct = calculate_change(None, None)
    assert abs_chg is None
    assert rel_pct is None


def test_target_vs_competitor_stats():
    stats = TargetVsCompetitorStats(
        target_mentioned_count=5,
        target_cited_count=4,
        competitor_present_count=3,
        target_absent_competitor_present_count=1,
        target_present_competitor_absent_count=2,
        both_present_count=2,
        neither_present_count=1,
    )
    d = stats.to_dict()
    assert d["target_mentioned_count"] == 5
    assert d["target_cited_count"] == 4
    assert d["competitor_present_count"] == 3
    assert d["target_absent_competitor_present_count"] == 1
    assert d["target_present_competitor_absent_count"] == 2
    assert d["both_present_count"] == 2
    assert d["neither_present_count"] == 1


def test_operational_health_metrics_serialization():
    health = OperationalHealthMetrics(
        total_attempts=10,
        successful_responses=8,
        timeout_count=1,
        rate_limit_count=1,
        unavailable_count=0,
        error_count=0,
        success_rate=0.80,
        avg_latency_ms=250.55,
        total_input_tokens=1000,
        total_output_tokens=500,
        total_tokens=1500,
    )
    d = health.to_dict()
    assert d["total_attempts"] == 10
    assert d["successful_responses"] == 8
    assert d["timeout_count"] == 1
    assert d["rate_limit_count"] == 1
    assert d["success_rate"] == 0.8
    assert d["avg_latency_ms"] == 250.6
    assert d["total_tokens"] == 1500
