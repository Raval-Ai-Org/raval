"""
Content AEO & GEO Intelligence Rules Catalog (Task 5 - Step 23)

Defines the complete, deterministic rules catalog for content structure,
answer-engine readiness, quality evidence, semantic coverage, and search intent.
"""

from typing import Any


CONTENT_AEO_RULES: list[dict[str, Any]] = [
    # 1. Structure Rules
    {
        "rule_id": "R-STR-01",
        "category": "structure",
        "severity": "high",
        "weight": 1.0,
        "title": "Missing H1 Heading",
        "description": "Page lacks an H1 heading, weakening primary entity and topic anchoring for answer engines.",
        "recommendation": "Add a single, descriptive H1 heading aligned with the page title and primary topic.",
        "trigger_condition": "h1_count == 0",
    },
    {
        "rule_id": "R-STR-02",
        "category": "structure",
        "severity": "medium",
        "weight": 0.8,
        "title": "Multiple H1 Headings",
        "description": "Page contains multiple H1 headings, creating ambiguity for primary topic extraction.",
        "recommendation": "Consolidate page structure into exactly one primary H1 heading; use H2 and H3 for sub-sections.",
        "trigger_condition": "h1_count > 1",
    },
    {
        "rule_id": "R-STR-03",
        "category": "structure",
        "severity": "medium",
        "weight": 0.6,
        "title": "Heading Hierarchy Skip",
        "description": "Heading levels skip logically (e.g. H2 directly to H4 without an H3), breaking outline comprehension.",
        "recommendation": "Maintain a strict, sequential heading hierarchy (H1 -> H2 -> H3 -> H4).",
        "trigger_condition": "len(heading_level_skips) > 0",
    },
    {
        "rule_id": "R-STR-04",
        "category": "structure",
        "severity": "low",
        "weight": 0.4,
        "title": "Long Text Block Without Subheadings",
        "description": "Contains dense prose exceeding 150 words without structural breaks or bullet points.",
        "recommendation": "Break dense paragraphs into bite-sized explanations, bullet points, or subheadings.",
        "trigger_condition": "len(long_text_blocks) > 0",
    },
    {
        "rule_id": "R-STR-05",
        "category": "structure",
        "severity": "medium",
        "weight": 0.7,
        "title": "Title and H1 Heading Misalignment",
        "description": "Page title and primary H1 heading do not share core topical tokens, signaling inconsistent topical intent.",
        "recommendation": "Align the primary keyword and topic across both the document title and the primary H1.",
        "trigger_condition": "title_h1_alignment.aligned is False",
    },

    # 2. Topic & Semantic Rules
    {
        "rule_id": "R-TOP-01",
        "category": "topic",
        "severity": "high",
        "weight": 1.0,
        "title": "Primary Topic Absent From Title / H1",
        "description": "The dominant extracted topic does not appear in the page title or primary H1 heading.",
        "recommendation": "Incorporate the core subject keyword directly into the document title and primary H1.",
        "trigger_condition": "primary_topic not in title or primary_topic not in h1",
    },
    {
        "rule_id": "R-TOP-02",
        "category": "topic",
        "severity": "high",
        "weight": 0.9,
        "title": "Potential Keyword Stuffing Detected",
        "description": "A single keyword cluster repeats excessively (> 4.5% density), triggering low-quality penalties.",
        "recommendation": "Reduce excessive repetition of the primary keyword; use natural synonyms and related semantic concepts.",
        "trigger_condition": "max_density > 0.045",
    },
    {
        "rule_id": "R-TOP-03",
        "category": "topic",
        "severity": "medium",
        "weight": 0.6,
        "title": "Low Lexical Diversity",
        "description": "Vocabulary vocabulary repetition is high (lexical diversity < 0.25), indicating shallow treatment.",
        "recommendation": "Expand explanatory depth by introducing domain-specific terminology, examples, and nuances.",
        "trigger_condition": "lexical_diversity < 0.25",
    },

    # 3. Question & Answer Rules
    {
        "rule_id": "R-QNA-01",
        "category": "questions",
        "severity": "high",
        "weight": 1.0,
        "title": "Unanswered Question Heading",
        "description": "A heading poses an explicit question, but the section contains thin or no explanatory body text.",
        "recommendation": "Provide a direct, complete 1–3 sentence answer immediately following any question heading.",
        "trigger_condition": "unanswered_question_count > 0",
    },
    {
        "rule_id": "R-QNA-02",
        "category": "questions",
        "severity": "medium",
        "weight": 0.7,
        "title": "Absence of Direct Answer Snippet",
        "description": "Questions in the content lack concise definition answers, reducing answer engine snippet extraction.",
        "recommendation": "Structure answer sections with clear direct answers (e.g. '[Subject] is [definition]...').",
        "trigger_condition": "direct_answer_count == 0 when questions present",
    },
    {
        "rule_id": "R-QNA-03",
        "category": "questions",
        "severity": "medium",
        "weight": 0.6,
        "title": "Missing FAQ / Q&A Structured Data",
        "description": "Page features multiple Q&A sections but does not implement FAQPage or QAPage schema.",
        "recommendation": "Mark up Q&A sections with valid Schema.org FAQPage JSON-LD structured data.",
        "trigger_condition": "question_count >= 2 and faq_schema_present is False",
    },

    # 4. Readiness & Content Gap Rules
    {
        "rule_id": "R-RED-01",
        "category": "readiness",
        "severity": "high",
        "weight": 1.0,
        "title": "Low Answer Readiness Score",
        "description": "Overall answer-readiness score is below 0.50, meaning answer engines struggle to cite this page.",
        "recommendation": "Add structured lists, concise definitions, and direct answers to primary user questions.",
        "trigger_condition": "answer_readiness_score < 0.50",
    },
    {
        "rule_id": "R-GAP-01",
        "category": "content_gaps",
        "severity": "medium",
        "weight": 0.8,
        "title": "Missing Essential Conceptual Dimensions",
        "description": "Content fails to address standard user questions or expected topical facets for this domain.",
        "recommendation": "Cover standard dimensions including costs, comparison against alternatives, and implementation steps.",
        "trigger_condition": "len(unaddressed_facets) > 0",
    },

    # 5. Quality & Evidence Rules
    {
        "rule_id": "R-EV-01",
        "category": "quality_evidence",
        "severity": "high",
        "weight": 1.0,
        "title": "Unsupported Superlative Assertion",
        "description": "Uses superlative claims ('best in the world', 'industry-leading') without data or attribution.",
        "recommendation": "Back superlative claims with verified benchmark metrics, third-party awards, or empirical citations.",
        "trigger_condition": "unsupported_claims_count > 0",
    },
    {
        "rule_id": "R-EV-02",
        "category": "quality_evidence",
        "severity": "medium",
        "weight": 0.8,
        "title": "No Empirical or Quantitative Data Points",
        "description": "Lacks empirical metrics, statistics, percentages, or measurable specifications.",
        "recommendation": "Incorporate authoritative figures, specifications, percentages, and data points into the analysis.",
        "trigger_condition": "data_points_count == 0",
    },

    # 6. Intent & Semantic Coverage Rules
    {
        "rule_id": "R-INT-01",
        "category": "search_intent",
        "severity": "medium",
        "weight": 0.7,
        "title": "Conflicting Search Intent Signals",
        "description": "Page mixes contradictory search intent signals (e.g. pure research vs heavy transactional CTAs).",
        "recommendation": "Clarify primary intent: provide educational answers first before presenting commercial offers.",
        "trigger_condition": "len(conflicting_signals) > 0",
    },
    {
        "rule_id": "R-SEM-01",
        "category": "semantic_coverage",
        "severity": "medium",
        "weight": 0.8,
        "title": "Low Semantic Coverage",
        "description": "Page covers fewer than 50% of expected core domain terms and contextual entities.",
        "recommendation": "Expand coverage of core semantic terms, related subtopics, and contextual relationships.",
        "trigger_condition": "semantic_coverage_score < 0.50",
    },

    # 7. Content Quality & Integrity Checks
    {
        "rule_id": "R-CHK-01",
        "category": "content_checks",
        "severity": "high",
        "weight": 1.0,
        "title": "Empty or Missing Content",
        "description": "Page body contains no text or raw HTML is completely empty.",
        "recommendation": "Ensure page renders meaningful HTML body content on initial HTTP GET.",
        "trigger_condition": "empty_content status == 'fail'",
    },
    {
        "rule_id": "R-CHK-02",
        "category": "content_checks",
        "severity": "high",
        "weight": 0.9,
        "title": "Thin Page Content",
        "description": "Body contains fewer than 35 words, failing basic search quality thresholds.",
        "recommendation": "Expand body text to at least 150+ words of informative, original content.",
        "trigger_condition": "thin_content status == 'fail'",
    },
    {
        "rule_id": "R-CHK-03",
        "category": "content_checks",
        "severity": "high",
        "weight": 0.8,
        "title": "Missing Document Title and H1 Heading",
        "description": "Page lacks both a <title> tag and an <h1> heading, leaving it unanchored.",
        "recommendation": "Add a unique <title> tag and a clear <h1> heading to the document.",
        "trigger_condition": "title_heading_anchors status == 'fail'",
    },
]


def get_content_aeo_rules(category: str | None = None) -> list[dict[str, Any]]:
    """
    Retrieve the catalog of AEO & GEO Content Intelligence rules,
    optionally filtered by category.
    """
    if category:
        return [r for r in CONTENT_AEO_RULES if r["category"].lower() == category.lower()]
    return list(CONTENT_AEO_RULES)
