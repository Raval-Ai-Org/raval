"""
Raval GEO Intelligence — Opportunity Prioritization Engine (Task 6.2)

Deterministic, bounded, and explainable prioritization of opportunities.
Combines impact, confidence, and estimated effort into a composite score:
    Score = 0.50 * Impact + 0.25 * Confidence + 0.25 * (1.0 - Effort)
Bounded strictly to [0.0, 1.0] with deterministic thresholds:
    CRITICAL: score >= 0.80
    HIGH:     0.60 <= score < 0.80
    MEDIUM:   0.40 <= score < 0.60
    LOW:      score < 0.40
"""

from typing import Any


ALLOWED_OPPORTUNITY_STATUSES = {
    "identified",
    "in_progress",
    "implemented",
    "dismissed",
    "archived",
}

ALLOWED_OPPORTUNITY_CATEGORIES = {
    "technical_seo",
    "content",
    "aeo",
    "geo",
    "entity",
    "structured_data",
    "internal_linking",
    "quality",
    "discoverability",
    "citation",
    "seo",
}

ALLOWED_OPPORTUNITY_PRIORITIES = {
    "CRITICAL",
    "HIGH",
    "MEDIUM",
    "LOW",
}

PRIORITY_THRESHOLDS = {
    "CRITICAL": 0.80,
    "HIGH": 0.60,
    "MEDIUM": 0.40,
}

WEIGHT_IMPACT = 0.50
WEIGHT_CONFIDENCE = 0.25
WEIGHT_EASE = 0.25


def severity_to_impact(severity: str | None) -> float:
    """
    Map finding severity or priority string to a normalized impact float [0.0, 1.0].
    """
    if not severity:
        return 0.50

    sev = str(severity).strip().lower()
    mapping = {
        "critical": 1.0,
        "high": 0.80,
        "medium": 0.50,
        "moderate": 0.50,
        "low": 0.25,
        "info": 0.10,
    }
    return mapping.get(sev, 0.50)


def category_and_type_to_effort(
    category: str | None,
    opportunity_type: str | None,
) -> float:
    """
    Estimate implementation effort float [0.0, 1.0] based on category and opportunity type.
    Lower effort means easier to implement, yielding higher ROI.
    """
    op_type = str(opportunity_type or "").lower()
    cat = str(category or "").lower()

    # High effort (0.70 - 0.85): comprehensive architecture, site restructure
    if any(k in op_type or k in cat for k in ["architecture", "site_structure", "template", "redesign"]):
        return 0.75

    # Medium-high effort (0.50 - 0.65): answering questions, content gap writing
    if any(k in op_type or k in cat for k in ["content_gap", "answer_readiness", "question", "quality"]):
        return 0.55

    # Medium effort (0.45 - 0.55): entity sameAs, citations, entity authority
    if any(k in op_type or k in cat for k in ["entity", "citation", "authority"]):
        return 0.45

    # Low-medium effort (0.30 - 0.35): structured data, JSON-LD, FAQ schema
    if any(k in op_type or k in cat for k in ["schema", "structured_data", "json_ld", "faq"]):
        return 0.30

    # Medium effort (0.35): headings, content structure outline, internal links
    if any(k in op_type for k in ["heading", "structure", "internal_link", "anchor"]):
        return 0.35

    # Low effort (0.20 - 0.30): metadata, title, simple tags, alt text
    if any(k in op_type for k in ["meta", "title", "alt", "tag", "robots"]):
        return 0.25

    return 0.50


def evidence_to_confidence(evidence: Any) -> float:
    """
    Estimate confidence score [0.0, 1.0] based on empirical evidence presence and density.
    """
    if evidence is None:
        return 0.70

    if isinstance(evidence, dict):
        total_items = sum(len(v) if isinstance(v, (list, dict, set)) else 1 for v in evidence.values())
        if total_items >= 3 or len(evidence) >= 3:
            return 0.95
        if total_items >= 1 or len(evidence) >= 1:
            return 0.85
        return 0.75

    if isinstance(evidence, list):
        if len(evidence) >= 3:
            return 0.95
        if len(evidence) >= 1:
            return 0.85
        return 0.75

    if isinstance(evidence, str) and evidence.strip():
        return 0.80

    return 0.70


def calculate_opportunity_priority(
    impact: float,
    effort: float,
    confidence: float,
) -> tuple[float, str, str]:
    """
    Calculate deterministic priority score, level, and explainable rationale.

    Formula:
        Score = 0.50 * Impact + 0.25 * Confidence + 0.25 * (1.0 - Effort)
    Bounded strictly to [0.0, 1.0].

    Returns:
        tuple of (priority_score, priority_level, rationale)
    """
    # Clamp inputs to [0.0, 1.0]
    imp = max(0.0, min(1.0, float(impact)))
    eff = max(0.0, min(1.0, float(effort)))
    conf = max(0.0, min(1.0, float(confidence)))

    ease = 1.0 - eff
    raw_score = (WEIGHT_IMPACT * imp) + (WEIGHT_CONFIDENCE * conf) + (WEIGHT_EASE * ease)
    score = round(max(0.0, min(1.0, raw_score)), 4)

    # Determine priority level based on strict thresholds
    if score >= PRIORITY_THRESHOLDS["CRITICAL"]:
        priority = "CRITICAL"
    elif score >= PRIORITY_THRESHOLDS["HIGH"]:
        priority = "HIGH"
    elif score >= PRIORITY_THRESHOLDS["MEDIUM"]:
        priority = "MEDIUM"
    else:
        priority = "LOW"

    # Human-readable qualitative descriptors
    if imp >= 0.85:
        imp_desc = "critical"
    elif imp >= 0.70:
        imp_desc = "high"
    elif imp >= 0.40:
        imp_desc = "moderate"
    else:
        imp_desc = "low"

    if conf >= 0.85:
        conf_desc = "high"
    elif conf >= 0.65:
        conf_desc = "moderate"
    else:
        conf_desc = "low"

    if eff <= 0.30:
        eff_desc = "low (high ease of implementation)"
    elif eff <= 0.60:
        eff_desc = "moderate"
    else:
        eff_desc = "high (complex implementation)"

    rationale = (
        f"{priority} priority (score: {score:.2f}) because impact is {imp_desc} ({imp:.2f}), "
        f"confidence is {conf_desc} ({conf:.2f}), and estimated effort is {eff_desc} ({eff:.2f})."
    )

    return score, priority, rationale
