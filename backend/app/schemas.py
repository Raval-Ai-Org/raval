from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class WebsiteCreate(BaseModel):
    name: str
    url: HttpUrl


class WebsiteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    url: str
    created_at: datetime


class ScanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    website_id: int
    status: str
    started_at: datetime | None
    completed_at: datetime | None
    error_message: str | None
    pages_crawled: int
    pages_failed: int
    pages_skipped: int
    created_at: datetime
    updated_at: datetime


class ScanStatusUpdate(BaseModel):
    status: str
    error_message: str | None = None


class PageResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scan_id: int
    url: str
    final_url: str | None = None
    status_code: int | None = None
    content_type: str | None = None
    content: str | None = None
    depth: int = 0
    parent_url: str | None = None
    error: str | None = None
    robots_txt_allowed: bool | None = None
    created_at: datetime


class PageExtractionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_result_id: int
    scan_id: int
    html_available: bool
    content_size_bytes: int = 0
    clean_text_available: bool
    word_count: int
    paragraph_count: int = 0
    main_content_candidate: str | None = None
    main_content_confidence: float | None = None
    detected_language: str | None = None
    extraction_status: str
    extraction_error: str | None = None
    extracted_at: datetime
    title_present: bool = False
    title_text: str | None = None
    title_length: int = 0
    title_word_count: int = 0
    title_empty: bool = False
    title_duplicate: bool = False
    title_too_short: bool = False
    title_too_long: bool = False
    title_count: int = 0
    meta_description_present: bool = False
    meta_description_count: int = 0
    h1_count: int = 0
    missing_h1: bool = False
    multiple_h1: bool = False
    heading_hierarchy_issue: bool = False
    heading_hierarchy_details: list[Any] | None = None
    canonical_present: bool = False
    canonical_count: int = 0
    canonical_multiple: bool = False
    canonical_conflict: bool = False
    image_count: int = 0
    images_without_alt: int = 0


class PageMetaDescriptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    position: int
    text: str | None = None
    length: int = 0
    word_count: int = 0
    empty: bool = False
    duplicate_within_page: bool = False
    duplicate_in_scan: bool = False
    too_short: bool = False
    too_long: bool = False


class PageHeadingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    level: int
    text: str | None = None
    position: int
    empty: bool = False


class PageCanonicalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    position: int
    url: str | None = None
    empty: bool = False
    valid: bool = False
    self_reference: bool = False
    cross_page: bool = False


class PageRobotsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    raw_content: str | None = None
    index: bool | None = None
    follow: bool | None = None
    noindex: bool = False
    nofollow: bool = False
    noarchive: bool = False
    nosnippet: bool = False
    other_directives: list[Any] | None = None


class PageSocialMetadataResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    platform: str
    property_name: str
    content: str | None = None
    position: int
    empty: bool = False
    duplicate: bool = False


class PageStructuredDataResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    block_position: int
    raw_block: str | None = None
    parsed_json: dict[str, Any] | list[Any] | None = None
    context: str | None = None
    types: list[Any] | None = None
    entity_names: list[Any] | None = None
    entity_urls: list[Any] | None = None
    parse_error: str | None = None


class PageMicrodataResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    item_position: int
    item_type: str | None = None
    item_id: str | None = None
    properties: dict[str, Any] | None = None
    raw_snippet: str | None = None


class PageBreadcrumbResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    position: int
    detection_method: str
    name: str | None = None
    url: str | None = None


class PageImageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    position: int
    url: str | None = None
    alt: str | None = None
    alt_missing: bool = False
    alt_empty: bool = False
    width: int | None = None
    height: int | None = None
    file_type: str | None = None
    loading: str | None = None
    lazy_loaded: bool = False


class PageLinkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    position: int
    source_url: str | None = None
    destination_url: str | None = None
    anchor_text: str | None = None
    rel_raw: str | None = None
    nofollow: bool = False
    sponsored: bool = False
    ugc: bool = False
    link_type: str = "internal"


class PageLanguageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    html_lang: str | None = None
    detected_language: str | None = None


class PageHreflangResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    position: int
    language_region: str
    target_url: str | None = None
    duplicate_declaration: bool = False
    conflicting_declaration: bool = False


class PageIndexabilityEvidenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_extraction_id: int
    http_status: int | None = None
    robots_txt_allowed: bool | None = None
    page_noindex: bool = False
    page_nofollow: bool = False
    canonical_url: str | None = None
    redirected: bool = False
    final_url: str | None = None
    content_type: str | None = None
    evidence_summary: dict[str, Any] | None = None


class PageMetadataResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    page_result_id: int
    page_extraction_id: int | None = None
    detected_language: str | None = None
    title_present: bool = False
    title_text: str | None = None
    title_length: int = 0
    title_word_count: int = 0
    title_empty: bool = False
    title_duplicate: bool = False
    title_too_short: bool = False
    title_too_long: bool = False
    meta_descriptions: list[PageMetaDescriptionResponse] = []
    social_metadata: list[PageSocialMetadataResponse] = []
    language: PageLanguageResponse | None = None
    hreflang: list[PageHreflangResponse] = []
    canonicals: list[PageCanonicalResponse] = []
    robots: PageRobotsResponse | None = None


class PageIntelligenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    page_result_id: int
    scan_id: int
    url: str
    final_url: str | None = None
    status_code: int | None = None
    content_type: str | None = None
    created_at: datetime
    extraction: PageExtractionResponse | None = None
    meta_descriptions: list[PageMetaDescriptionResponse] = []
    headings: list[PageHeadingResponse] = []
    canonicals: list[PageCanonicalResponse] = []
    robots: PageRobotsResponse | None = None
    social_metadata: list[PageSocialMetadataResponse] = []
    structured_data: list[PageStructuredDataResponse] = []
    microdata: list[PageMicrodataResponse] = []
    breadcrumbs: list[PageBreadcrumbResponse] = []
    images: list[PageImageResponse] = []
    links: list[PageLinkResponse] = []
    language: PageLanguageResponse | None = None
    hreflang: list[PageHreflangResponse] = []
    indexability_evidence: PageIndexabilityEvidenceResponse | None = None


class FindingCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    page_id: int | None = None
    finding_type: str = Field(..., alias="type")
    category: str = "seo"
    title: str
    description: str
    severity: str = "medium"
    status: str = "open"
    evidence: dict[str, Any] | list[Any] | None = None


class FindingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    website_id: int
    scan_id: int
    page_id: int | None = None
    finding_type: str
    type: str | None = None
    category: str
    title: str
    description: str
    severity: str
    status: str
    evidence: dict[str, Any] | list[Any] | None = None
    created_at: datetime

    @model_validator(mode="after")
    def populate_type(self):
        if self.type is None:
            self.type = self.finding_type
        return self


class RecommendationCreate(BaseModel):
    title: str
    description: str
    priority: str = "medium"
    status: str = "open"
    impact: str | None = None
    action_type: str | None = None
    payload: dict[str, Any] | list[Any] | None = None


class RecommendationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    finding_id: int
    title: str
    description: str
    priority: str
    status: str
    impact: str | None = None
    action_type: str | None = None
    payload: dict[str, Any] | list[Any] | None = None
    category: str | None = None
    effort: str | None = None
    rationale: str | None = None
    opportunity_id: int | None = None
    created_at: datetime


class RecommendationUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    status: str | None = None
    impact: str | None = None
    action_type: str | None = None
    payload: dict[str, Any] | list[Any] | None = None


class RecommendationBatchGenerateResponse(BaseModel):
    website_id: int | None = None
    scan_id: int | None = None
    generated_count: int
    recommendations: list[RecommendationResponse] = []


class QuestionSetCreate(BaseModel):
    name: str
    version: str = "1.0"
    description: str | None = None


class QuestionSetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    website_id: int
    name: str
    version: str
    description: str | None = None
    created_at: datetime


class QuestionCreate(BaseModel):
    text: str
    intent: str | None = None
    topic: str | None = None


class QuestionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question_set_id: int
    text: str
    intent: str | None = None
    topic: str | None = None
    created_at: datetime


class AIRunCreate(BaseModel):
    question_id: int
    provider: str
    model: str
    environment: str = "production"


class AIRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    website_id: int
    question_id: int
    provider: str
    model: str
    environment: str
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    created_at: datetime


class AIRunStatusUpdate(BaseModel):
    status: str
    error_message: str | None = None


class CitationCreate(BaseModel):
    url: str
    domain: str | None = None
    title: str | None = None
    snippet: str | None = None
    position: int = 1


class CitationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ai_result_id: int
    url: str
    domain: str | None = None
    title: str | None = None
    snippet: str | None = None
    position: int
    created_at: datetime


class AIResultCreate(BaseModel):
    answer: str
    mentions_brand: bool = False
    mentions_competitors: list[str] | dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None
    citations: list[CitationCreate] = []


class AIResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ai_run_id: int
    answer: str
    mentions_brand: bool
    mentions_competitors: list[str] | dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None
    citations: list[CitationResponse] = []
    created_at: datetime


class EntityCreate(BaseModel):
    name: str
    entity_type: str
    page_id: int | None = None
    scan_id: int | None = None
    description: str | None = None
    confidence: float = 1.0
    same_as: list[str] | dict[str, Any] | None = None
    properties: dict[str, Any] | None = None
    relationships: dict[str, Any] | list[Any] | None = None
    evidence: dict[str, Any] | list[Any] | str | None = None


class EntityUpdate(BaseModel):
    name: str | None = None
    entity_type: str | None = None
    page_id: int | None = None
    scan_id: int | None = None
    description: str | None = None
    confidence: float | None = None
    same_as: list[str] | dict[str, Any] | None = None
    properties: dict[str, Any] | None = None
    relationships: dict[str, Any] | list[Any] | None = None
    evidence: dict[str, Any] | list[Any] | str | None = None


class EntityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    website_id: int
    page_id: int | None = None
    scan_id: int | None = None
    name: str
    entity_type: str
    description: str | None = None
    confidence: float
    same_as: list[str] | dict[str, Any] | None = None
    properties: dict[str, Any] | None = None
    relationships: dict[str, Any] | list[Any] | None = None
    evidence: dict[str, Any] | list[Any] | str | None = None
    created_at: datetime
    updated_at: datetime


class ContentStructureResponse(BaseModel):
    h1_count: int
    has_h1: bool
    multiple_h1: bool
    missing_h1: bool
    heading_levels: dict[str, int]
    total_headings: int
    heading_hierarchy_valid: bool
    heading_level_skips: list[dict[str, Any]]
    repeated_headings: list[dict[str, Any]]
    list_present: bool
    unordered_list_present: bool
    ordered_list_present: bool
    unordered_list_count: int
    ordered_list_count: int
    total_list_item_count: int
    paragraph_count: int
    average_paragraph_words: float
    long_text_blocks: list[dict[str, Any]]
    section_count: int
    sections: list[dict[str, Any]]
    empty_sections: list[dict[str, Any]]
    thin_sections: list[dict[str, Any]]
    title_h1_alignment: dict[str, Any] | None = None


class TopicAnalysisResponse(BaseModel):
    primary_topic: str | None = None
    primary_topic_confidence: float
    supporting_topics: list[str]
    topic_keywords: list[dict[str, Any]]
    total_words: int
    unique_meaningful_words: int
    lexical_diversity: float
    semantic_depth: str
    primary_topic_in_title: bool
    primary_topic_in_h1: bool
    findings: list[dict[str, Any]]


class EntityAnalysisResponse(BaseModel):
    entity_count: int
    entities: list[dict[str, Any]]
    structured_data_entity_count: int
    content_entity_count: int
    has_organization_entity: bool
    has_product_entity: bool
    entity_consistency_valid: bool
    consistency_issues: list[dict[str, Any]]
    findings: list[dict[str, Any]]


class QuestionAnalysisResponse(BaseModel):
    question_count: int
    answered_question_count: int
    unanswered_question_count: int
    faq_schema_present: bool
    answer_readiness_score: float
    questions: list[dict[str, Any]]
    findings: list[dict[str, Any]]


class AnswerAnalysisResponse(BaseModel):
    total_questions: int
    answered_questions: int
    unanswered_questions: int
    direct_answers_count: int
    optimal_length_answers_count: int
    overall_answer_rate: float
    answers: list[dict[str, Any]]
    findings: list[dict[str, Any]]


class AnswerReadinessResponse(BaseModel):
    readiness_score: float
    readiness_level: str
    component_scores: dict[str, float]
    positive_signals: list[str]
    negative_signals: list[str]
    total_questions: int
    answered_questions: int
    direct_answers_count: int
    has_structured_data_qa: bool
    findings: list[dict[str, Any]]


class ContentGapResponse(BaseModel):
    total_gaps: int
    unanswered_question_gaps_count: int
    structural_gaps_count: int
    topical_gaps_count: int
    entity_gaps_count: int
    schema_gaps_count: int
    gaps: list[dict[str, Any]]
    findings: list[dict[str, Any]]


class QualityAnalysisResponse(BaseModel):
    has_quantitative_evidence: bool
    data_points_count: int
    citations_count: int
    attributions_count: int
    unsupported_claims_count: int
    thin_sections_count: int
    evidence_strength: str
    quality_score: float
    data_points: list[str]
    attributions: list[str]
    unsupported_claims: list[dict[str, Any]]
    findings: list[dict[str, Any]]


class IntentAnalysisResponse(BaseModel):
    primary_intent: str
    confidence: float
    secondary_intents: list[dict[str, Any]]
    supporting_evidence: list[str]
    conflicting_signals: list[str]
    has_commercial_call_to_action: bool
    findings: list[dict[str, Any]]


class SemanticCoverageResponse(BaseModel):
    semantic_coverage_score: float
    breadth_level: str
    covered_concepts: list[str]
    weakly_covered_concepts: list[str]
    missing_concepts: list[str]
    component_scores: dict[str, float]
    findings: list[dict[str, Any]]


class ContentIntelligenceResponse(BaseModel):
    page_id: int | None
    url: str | None
    title: str | None
    overall_content_score: float
    content_status: str
    word_count: int
    reading_time_minutes: float
    primary_topic: str | None
    primary_intent: str
    intent_confidence: float
    answer_readiness_score: float
    answer_readiness_level: str
    semantic_coverage_score: float
    semantic_breadth_level: str
    evidence_quality_score: float
    evidence_strength: str
    total_questions: int
    answered_questions: int
    unanswered_questions: int
    total_gaps: int
    entity_count: int
    key_strengths: list[str]
    critical_issues: list[str]
    component_summaries: dict[str, Any]
    findings: list[dict[str, Any]]


class ContentQualityChecksResponse(BaseModel):
    is_valid_content: bool
    total_checks: int
    passed_checks: int
    failed_checks: int
    warning_checks: int
    checks: list[dict[str, Any]]
    findings: list[dict[str, Any]]


class ScanContentIntelligenceSummaryResponse(BaseModel):
    scan_id: int
    total_pages_analyzed: int
    average_content_score: float
    optimal_pages_count: int
    needs_improvement_pages_count: int
    deficient_pages_count: int
    pages: list[ContentIntelligenceResponse]


class ContentPipelineResultResponse(BaseModel):
    page_id: int
    url: str
    content_intelligence: ContentIntelligenceResponse
    quality_checks: ContentQualityChecksResponse
    findings_persisted_count: int


class ContentAEORuleItem(BaseModel):
    rule_id: str
    category: str
    severity: str
    weight: float
    title: str
    description: str
    recommendation: str
    trigger_condition: str


class ContentAEORulesResponse(BaseModel):
    total_rules: int
    categories: list[str]
    rules: list[ContentAEORuleItem]


class OpportunityCreate(BaseModel):
    website_id: int
    scan_id: int | None = None
    page_id: int | None = None
    finding_id: int | None = None
    recommendation_id: int | None = None
    title: str
    description: str
    opportunity_type: str
    category: str = "seo"
    status: str = "identified"
    impact: float = 0.5
    effort: float = 0.5
    confidence: float = 0.8
    priority_score: float | None = None
    priority: str | None = None
    rationale: str | None = None
    evidence: dict[str, Any] | list[Any] | None = None


class OpportunityUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    status: str | None = None
    impact: float | None = None
    effort: float | None = None
    confidence: float | None = None
    priority_score: float | None = None
    priority: str | None = None
    rationale: str | None = None
    evidence: dict[str, Any] | list[Any] | None = None


class OpportunityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    website_id: int
    scan_id: int | None = None
    page_id: int | None = None
    finding_id: int | None = None
    recommendation_id: int | None = None
    title: str
    description: str
    opportunity_type: str
    category: str
    status: str
    impact: float
    effort: float
    confidence: float
    priority_score: float
    priority: str
    rationale: str
    evidence: dict[str, Any] | list[Any] | None = None
    created_at: datetime
    updated_at: datetime


class OpportunityBatchGenerateResponse(BaseModel):
    website_id: int
    scan_id: int | None = None
    generated_count: int
    opportunities: list[OpportunityResponse] = []


# ==========================================
# Task 6.4 Fix / Action Planning Schemas
# ==========================================

class FixPlanCreate(BaseModel):
    recommendation_id: int
    finding_id: int | None = None
    opportunity_id: int | None = None
    website_id: int
    scan_id: int | None = None
    page_id: int | None = None
    fix_type: str
    title: str
    description: str
    problem_statement: str
    proposed_action: str
    expected_outcome: str
    estimated_effort: str = "medium"
    risk_level: str = "low"
    priority: str = "medium"
    status: str = "draft"
    diff_payload: dict[str, Any] | list[Any] | None = None
    safety_checks: dict[str, Any] | None = None


class FixPlanUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    problem_statement: str | None = None
    proposed_action: str | None = None
    expected_outcome: str | None = None
    estimated_effort: str | None = None
    risk_level: str | None = None
    priority: str | None = None
    status: str | None = None
    diff_payload: dict[str, Any] | list[Any] | None = None
    safety_checks: dict[str, Any] | None = None


class FixPlanStatusTransition(BaseModel):
    status: str
    comment: str | None = None


class FixPlanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    recommendation_id: int
    finding_id: int | None = None
    opportunity_id: int | None = None
    website_id: int
    scan_id: int | None = None
    page_id: int | None = None
    fix_type: str
    title: str
    description: str
    problem_statement: str
    proposed_action: str
    expected_outcome: str
    estimated_effort: str
    risk_level: str
    priority: str
    status: str
    diff_payload: dict[str, Any] | list[Any] | None = None
    safety_checks: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class FixPlanBatchGenerateResponse(BaseModel):
    website_id: int | None = None
    scan_id: int | None = None
    generated_count: int
    fix_plans: list[FixPlanResponse] = []


# ==========================================
# Task 6.5 & 6.6 — Validation Engine Schemas
# ==========================================

class ValidationCreate(BaseModel):
    website_id: int
    fix_plan_id: int | None = None
    recommendation_id: int | None = None
    finding_id: int | None = None
    opportunity_id: int | None = None
    scan_id: int | None = None
    page_id: int | None = None
    validation_type: str
    expected_result: str
    before_state: dict[str, Any] | list[Any] | str | None = None
    after_state: dict[str, Any] | list[Any] | str | None = None


class ValidationRunRequest(BaseModel):
    simulated_after_state: dict[str, Any] | list[Any] | str | None = None


class ValidationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    fix_plan_id: int | None = None
    recommendation_id: int | None = None
    finding_id: int | None = None
    opportunity_id: int | None = None
    website_id: int
    scan_id: int | None = None
    page_id: int | None = None
    validation_type: str
    status: str
    result: str
    validation_score: float
    before_state: dict[str, Any] | list[Any] | str | None = None
    after_state: dict[str, Any] | list[Any] | str | None = None
    expected_result: str
    actual_result: str
    explanation: str
    feedback: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class ValidationBatchResponse(BaseModel):
    website_id: int | None = None
    scan_id: int | None = None
    total_validated: int
    pass_count: int
    fail_count: int
    partial_count: int
    validations: list[ValidationResponse] = []


# ====================================================
# Task 6.7 — End-to-End Intelligence Pipeline Schemas
# ====================================================

class PipelineRunRequest(BaseModel):
    run_validations: bool = True


class PipelineStageCounts(BaseModel):
    findings: int = 0
    opportunities: int = 0
    recommendations: int = 0
    fix_plans: int = 0
    validations: int = 0
    monitoring: int = 0


# ==========================================
# Task 6.10 — Monitoring Schemas
# ==========================================

class MonitoringRecordCreate(BaseModel):
    website_id: int
    scan_id: int | None = None
    ai_run_id: int | None = None
    target_type: str = "website"
    target_id: int | None = None
    metric_name: str
    metric_category: str = "intelligence"
    current_value: float
    previous_value: float | None = None
    delta: float | None = None
    change_detected: bool = False
    status: str = "active"
    event_type: str | None = None
    summary: str
    details: dict[str, Any] | list[Any] | None = None


class MonitoringRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    website_id: int
    scan_id: int | None = None
    ai_run_id: int | None = None
    target_type: str
    target_id: int | None = None
    metric_name: str
    metric_category: str
    previous_value: float | None = None
    current_value: float
    delta: float | None = None
    change_detected: bool
    status: str
    event_type: str | None = None
    summary: str
    details: dict[str, Any] | list[Any] | None = None
    recorded_at: datetime


class MonitoringTimelineResponse(BaseModel):
    website_id: int
    total_records: int
    records: list[MonitoringRecordResponse] = []


class WebsiteHealthSummaryResponse(BaseModel):
    website_id: int
    health_status: str  # healthy, warning, critical
    health_score: float
    validation_pass_rate: float
    open_findings_count: int
    critical_opportunities_count: int
    recent_events: list[str] = []
    evaluated_at: datetime


class PipelineRunResponse(BaseModel):
    website_id: int
    scan_id: int | None = None
    status: str = "completed"
    stage_counts: PipelineStageCounts
    validation_summary: dict[str, int] = {"PASS": 0, "FAIL": 0, "PARTIAL": 0}
    opportunities: list[OpportunityResponse] = []
    recommendations: list[RecommendationResponse] = []
    fix_plans: list[FixPlanResponse] = []
    validations: list[ValidationResponse] = []
    monitoring_records: list[MonitoringRecordResponse] = []
    completed_at: datetime


class PipelineSummaryResponse(BaseModel):
    website_id: int
    scan_id: int | None = None
    stage_counts: PipelineStageCounts
    validation_summary: dict[str, int] = {"PASS": 0, "FAIL": 0, "PARTIAL": 0}
    health_score: float = 1.0
    health_status: str = "healthy"


class DirectAuthorityCitationAnalysisRequest(BaseModel):
    url: str | None = None
    html: str | None = None
    text_content: str | None = None
    title: str | None = None
    meta_description: str | None = None
    headings: list[dict[str, Any]] | None = None
    links: list[dict[str, Any]] | None = None
    structured_data: list[dict[str, Any]] | None = None
    page_id: int | None = None


# =============================================================================
# Task 8.6 - 8.8 Scoring, Explanation, Recommendation & Site Summary Schemas
# =============================================================================

class PrioritizedRecommendationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    recommendation_id: str
    finding_id: str | None = None
    rule_id: str
    category: str
    priority: str
    classification: str
    title: str
    explanation: str
    recommended_action: str
    expected_impact: str | None = None
    score_impact: float = 0.0
    evidence: Any | None = None
    status: str = "open"
    metadata: dict[str, Any] = {}


class PageRecommendationsListResponse(BaseModel):
    page_id: int
    url: str | None = None
    total_recommendations: int
    quick_wins_count: int
    deep_fixes_count: int
    recommendations: list[PrioritizedRecommendationResponse] = []


class SiteScoreHistoryPoint(BaseModel):
    scan_id: int | None = None
    timestamp: str
    overall_score: float
    site_status: str
    category_scores: dict[str, float] = {}


class SiteScoreHistoryResponse(BaseModel):
    website_id: int
    total_scans: int
    history: list[SiteScoreHistoryPoint] = []


# ==========================================
# Task 10 - Query Intelligence & Query Sets
# ==========================================


class QueryBase(BaseModel):
    query_text: str = Field(..., min_length=1, max_length=2048)
    intent: str = Field(default="INFORMATIONAL")
    topic_id: str | None = None
    topic: str | None = None
    entity_id: int | None = None
    entity_name: str | None = None
    page_id: int | None = None
    generation_source: str = Field(default="TOPIC_INTELLIGENCE")
    priority: str = Field(default="MEDIUM")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    version: str = Field(default="1.0")
    active: bool = True
    metadata_json: dict[str, Any] | list[Any] | None = None


class QueryCreate(QueryBase):
    query_set_id: int | None = None
    website_id: int | None = None


class QueryUpdate(BaseModel):
    query_text: str | None = Field(default=None, min_length=1, max_length=2048)
    intent: str | None = None
    priority: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    active: bool | None = None
    metadata_json: dict[str, Any] | list[Any] | None = None


class QueryStatusUpdate(BaseModel):
    active: bool


class QueryResponse(QueryBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    query_set_id: int
    website_id: int
    created_at: datetime
    updated_at: datetime


class QuerySetBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    version: str = Field(default="1.0", max_length=50)
    status: str = Field(default="active", max_length=50)


class QuerySetCreate(QuerySetBase):
    website_id: int
    scan_id: int | None = None


class QuerySetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    version: str | None = Field(default=None, max_length=50)
    status: str | None = Field(default=None, max_length=50)


class QuerySetResponse(QuerySetBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    website_id: int
    scan_id: int | None = None
    total_queries: int = 0
    active_queries: int = 0
    created_at: datetime
    updated_at: datetime


class QuerySetDetailResponse(QuerySetResponse):
    queries: list[QueryResponse] = []


class QuerySetGenerateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    version: str = "1.0"
    max_variants_per_source: int = Field(default=3, ge=1, le=10)
    max_total_queries: int = Field(default=250, ge=1, le=1000)
    include_topics: bool = True
    include_entities: bool = True
    include_questions: bool = True
    include_content: bool = True
    target_intents: list[str] | None = None


# ==========================================
# Task 10 Step 2 - AI Response & Providers
# ==========================================


class ProviderInfoResponse(BaseModel):
    provider_name: str
    default_model: str
    model_version: str | None = None
    enabled: bool = True
    is_configured: bool = False
    is_mock: bool = False
    status: str
    timeout_seconds: float = 30.0
    max_retries: int = 2


class ExecuteQueryResponseRequest(BaseModel):
    provider: str = Field(default="mock", max_length=100)
    model: str | None = None
    timeout_seconds: float | None = Field(default=None, ge=1.0, le=120.0)


class BatchExecuteQuerySetRequest(BaseModel):
    provider: str = Field(default="mock", max_length=100)
    model: str | None = None
    active_only: bool = True
    timeout_seconds: float | None = Field(default=None, ge=1.0, le=120.0)


class AIResponseDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    query_id: int
    query_set_id: int
    website_id: int
    provider: str
    model: str
    model_version: str | None = None
    status: str
    response_text: str
    latency_ms: int
    error_type: str | None = None
    error_message: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    request_timestamp: datetime
    response_timestamp: datetime
    metadata_json: dict[str, Any] | list[Any] | None = None
    created_at: datetime


class BatchAIResponseResult(BaseModel):
    query_set_id: int
    provider: str
    total_executed: int
    success_count: int
    failure_count: int
    responses: list[AIResponseDetail] = []


# ==========================================
# Task 10 Step 3 - Mention & Citation Detection
# ==========================================


class MentionDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    response_id: int | None = None
    matched_text: str
    match_type: str
    normalized_text: str
    start_pos: int | None = None
    end_pos: int | None = None
    context_snippet: str | None = None
    confidence: float = 1.0
    entity_id: int | None = None
    created_at: datetime | None = None


class CitationDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    response_id: int | None = None
    url: str
    normalized_url: str
    domain: str
    is_target_domain: bool
    page_id: int | None = None
    position: int = 1
    context_snippet: str | None = None
    confidence: float = 1.0
    created_at: datetime | None = None


class DetectionResultResponse(BaseModel):
    response_id: int
    query_id: int
    website_id: int
    provider: str
    target_mentioned: bool
    target_cited: bool
    mentions_count: int
    citations_count: int
    target_citations_count: int
    mentions: list[MentionDetail] = []
    citations: list[CitationDetail] = []


class BatchDetectionResultResponse(BaseModel):
    query_set_id: int
    total_processed: int
    target_mentioned_count: int
    target_cited_count: int
    results: list[DetectionResultResponse] = []


class DetectionRequest(BaseModel):
    custom_aliases: list[str] | None = None


# ==========================================
# Task 10 Step 4 - Visibility & Competitor Signals
# ==========================================


class CompetitorSignalDetail(BaseModel):
    competitor_name: str
    domain: str | None = None
    entity_id: int | None = None
    mentioned: bool = False
    cited: bool = False
    mention_count: int = 0
    citation_count: int = 0
    first_mention_position: int | None = None
    first_citation_position: int | None = None
    evidence_snippets: list[str] = []
    confidence: float = 1.0


class VisibilityObservationDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    response_id: int
    query_id: int
    query_set_id: int
    website_id: int
    provider: str
    model: str
    target_mentioned: bool
    target_cited: bool
    first_party_cited: bool
    relevant_answer: str = "UNKNOWN"
    observable_mention_position: int | None = None
    observable_citation_position: int | None = None
    confidence: float = 1.0
    competitor_count: int = 0
    competitors_present: bool = False
    competitors: list[CompetitorSignalDetail] = []
    evidence_summary: dict[str, Any] = {}
    created_at: datetime | None = None


class BatchVisibilityObservationResponse(BaseModel):
    query_set_id: int
    total_evaluated: int
    target_mentioned_count: int
    target_cited_count: int
    competitors_present_count: int
    observations: list[VisibilityObservationDetail] = []


class VisibilityEvaluationRequest(BaseModel):
    custom_competitors: list[dict[str, Any]] | list[str] | None = None


# ==========================================
# Task 10 Step 5 - Visibility Gap Analysis & Finding Linkage
# ==========================================


class GapFindingLinkDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    finding_id: int
    match_type: str
    confidence: float = 1.0
    reasons: list[str] = []
    finding_title: str | None = None
    finding_category: str | None = None


class VisibilityGapDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    response_id: int
    observation_id: int | None = None
    query_id: int
    query_set_id: int
    website_id: int
    gap_type: str
    severity: str
    reason: str
    evidence: dict[str, Any] = {}
    linked_findings: list[GapFindingLinkDetail] = []
    created_at: datetime | None = None


class BatchVisibilityGapResponse(BaseModel):
    query_set_id: int
    total_evaluated: int
    total_gaps_found: int
    gap_type_counts: dict[str, int] = {}
    gaps: list[VisibilityGapDetail] = []


# ==========================================
# Task 10 Step 6: AI Visibility Metrics & Historical Analytics Schemas
# ==========================================


class MetricRateDetail(BaseModel):
    numerator: int
    denominator: int
    rate: float | None = None


class TargetVsCompetitorDetail(BaseModel):
    target_mentioned_count: int = 0
    target_cited_count: int = 0
    competitor_present_count: int = 0
    target_absent_competitor_present_count: int = 0
    target_present_competitor_absent_count: int = 0
    both_present_count: int = 0
    neither_present_count: int = 0


class OperationalHealthDetail(BaseModel):
    total_attempts: int = 0
    successful_responses: int = 0
    timeout_count: int = 0
    rate_limit_count: int = 0
    unavailable_count: int = 0
    error_count: int = 0
    success_rate: float | None = None
    avg_latency_ms: float | None = None
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0


class CompetitorMetricDetail(BaseModel):
    competitor_name: str
    domain: str | None = None
    mention_count: int = 0
    citation_count: int = 0
    appearance_count: int = 0
    appearance_rate: float | None = None
    first_mention_position_avg: float | None = None


class VisibilityMetricsResponse(BaseModel):
    website_id: int
    query_set_id: int | None = None
    query_id: int | None = None
    provider: str | None = None
    model: str | None = None
    total_attempts: int = 0
    evaluable_responses: int = 0
    failed_responses: int = 0
    mention_metrics: MetricRateDetail
    citation_metrics: MetricRateDetail
    first_party_citation_metrics: MetricRateDetail
    relevant_answer_metrics: MetricRateDetail
    competitor_appearance_metrics: MetricRateDetail
    target_vs_competitor: TargetVsCompetitorDetail
    operational_health: OperationalHealthDetail
    top_competitors: list[CompetitorMetricDetail] = []
    gap_summary: dict[str, Any] = {}
    response_ids: list[int] = []
    period_start: str | None = None
    period_end: str | None = None
    calculated_at: str


class ProviderMetricsBreakdownResponse(BaseModel):
    website_id: int
    query_set_id: int | None = None
    providers: dict[str, VisibilityMetricsResponse] = {}


class PeriodComparisonResponse(BaseModel):
    current: VisibilityMetricsResponse
    previous: VisibilityMetricsResponse
    absolute_change: dict[str, float | None] = {}
    relative_change_pct: dict[str, float | None] = {}


class TimelinePointDetail(BaseModel):
    date: str
    total_attempts: int
    evaluable_responses: int
    mention_rate: float | None = None
    citation_rate: float | None = None
    first_party_citation_rate: float | None = None
    competitor_appearance_rate: float | None = None


class VisibilityTimelineResponse(BaseModel):
    website_id: int
    query_set_id: int | None = None
    timeline: list[TimelinePointDetail] = []


class VisibilitySnapshotDetail(BaseModel):
    id: int
    website_id: int
    query_set_id: int | None = None
    provider: str | None = None
    period_start: datetime
    period_end: datetime
    evaluable_responses: int
    total_attempts: int
    mention_count: int
    citation_count: int
    first_party_citation_count: int
    competitor_appearance_count: int
    mention_rate: float | None = None
    citation_rate: float | None = None
    first_party_citation_rate: float | None = None
    competitor_appearance_rate: float | None = None
    metrics_json: dict[str, Any] | None = None
    created_at: datetime


# ==========================================
# Task 10 Step 7: Monitoring Pipeline Schemas
# ==========================================


class StartMonitoringRunRequest(BaseModel):
    provider: str = "mock"
    model: str | None = None
    query_ids: list[int] | None = None
    mock_responses: list[str] | None = None


class MonitoringRunResponse(BaseModel):
    id: int
    website_id: int
    query_set_id: int
    provider: str
    model: str | None = None
    status: str
    total_queries: int
    attempted_queries: int
    successful_responses: int
    failed_responses: int
    detected_mentions: int
    detected_citations: int
    detected_gaps: int
    mention_rate: float | None = None
    citation_rate: float | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime


class MonitoringRunResultItem(BaseModel):
    response_id: int
    query_id: int
    query_text: str | None = None
    intent: str | None = None
    topic: str | None = None
    priority: str | None = None
    provider: str
    model: str | None = None
    status: str
    latency_ms: int | None = None
    total_tokens: int | None = None
    target_mentioned: bool = False
    target_cited: bool = False
    first_party_cited: bool = False
    relevant_answer: str = "UNKNOWN"
    competitors_present: bool = False
    competitor_signals: list[dict[str, Any]] = []
    mentions_count: int = 0
    citations_count: int = 0
    gaps: list[dict[str, Any]] = []


class MonitoringRunDetailResponse(BaseModel):
    run_id: int
    website_id: int
    query_set_id: int
    provider: str
    model: str | None = None
    status: str
    total_queries: int
    attempted_queries: int
    successful_responses: int
    failed_responses: int
    detected_mentions: int
    detected_citations: int
    detected_gaps: int
    mention_rate: float | None = None
    citation_rate: float | None = None
    error_message: str | None = None
    metrics: dict[str, Any] = {}
    errors: list[dict[str, Any]] = []
    items: list[MonitoringRunResultItem] = []
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str






