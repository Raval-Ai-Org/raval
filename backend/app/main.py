from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from .content_intelligence_rules import get_content_aeo_rules
from .database import Base, engine, get_db
from .models import (
    AIRun,
    Entity,
    Finding,
    FixPlan,
    Opportunity,
    PageResult,
    Recommendation,
    Scan,
    ValidationResult,
    MonitoringRecord,
    Website,
)
from .schemas import (
    AIRunCreate,
    AIRunResponse,
    AIRunStatusUpdate,
    AIResultCreate,
    AIResultResponse,
    AnswerAnalysisResponse,
    AnswerReadinessResponse,
    CitationResponse,
    ContentAEORulesResponse,
    ContentGapResponse,
    ContentIntelligenceResponse,
    ContentPipelineResultResponse,
    ContentQualityChecksResponse,
    ContentStructureResponse,
    EntityAnalysisResponse,
    EntityCreate,
    EntityResponse,
    EntityUpdate,
    FindingCreate,
    FindingResponse,
    FixPlanBatchGenerateResponse,
    FixPlanCreate,
    FixPlanResponse,
    FixPlanStatusTransition,
    FixPlanUpdate,
    IntentAnalysisResponse,
    OpportunityBatchGenerateResponse,
    OpportunityCreate,
    OpportunityResponse,
    OpportunityUpdate,
    MonitoringRecordCreate,
    MonitoringRecordResponse,
    MonitoringTimelineResponse,
    WebsiteHealthSummaryResponse,
    PipelineRunRequest,
    PipelineRunResponse,
    PipelineStageCounts,
    PipelineSummaryResponse,
    DirectAuthorityCitationAnalysisRequest,
    PageBreadcrumbResponse,
    PageCanonicalResponse,
    PageExtractionResponse,
    PageHeadingResponse,
    PageHreflangResponse,
    PageImageResponse,
    PageIndexabilityEvidenceResponse,
    PageIntelligenceResponse,
    PageLanguageResponse,
    PageLinkResponse,
    PageMetaDescriptionResponse,
    PageMetadataResponse,
    PageMicrodataResponse,
    PageResultResponse,
    PageRobotsResponse,
    PageSocialMetadataResponse,
    PageStructuredDataResponse,
    QualityAnalysisResponse,
    QuestionAnalysisResponse,
    QuestionCreate,
    QuestionResponse,
    QuestionSetCreate,
    QuestionSetResponse,
    RecommendationBatchGenerateResponse,
    RecommendationCreate,
    RecommendationResponse,
    RecommendationUpdate,
    ScanContentIntelligenceSummaryResponse,
    ScanResponse,
    ScanStatusUpdate,
    SemanticCoverageResponse,
    TopicAnalysisResponse,
    ValidationBatchResponse,
    ValidationCreate,
    ValidationResponse,
    ValidationRunRequest,
    WebsiteCreate,
    WebsiteResponse,
    PrioritizedRecommendationResponse,
    PageRecommendationsListResponse,
    SiteScoreHistoryResponse,
)
from .score_explanation import ScoreExplanationResponse
from .site_aggregator import SiteScoreSummary
from .intelligence_service import (
    evaluate_page_intelligence_score,
    evaluate_site_intelligence_summary,
    get_site_score_history,
)
from .services import (
    analyze_page_answers,
    analyze_page_content_gaps,
    analyze_page_content_intelligence,
    analyze_page_content_structure,
    analyze_page_entities,
    analyze_page_intent,
    analyze_page_quality,
    analyze_page_questions,
    analyze_page_readiness,
    analyze_page_semantic_coverage,
    analyze_page_topics,
    analyze_scan_content_intelligence,
    create_ai_result,
    create_ai_run,
    create_entity,
    create_finding,
    create_question,
    create_question_set,
    create_recommendation,
    create_scan,
    create_website,
    run_full_page_content_pipeline,
    run_page_content_quality_checks,
    delete_entity,
    get_ai_result_citations,
    get_ai_run,
    get_ai_run_result,
    get_entity,
    get_finding,
    get_finding_recommendations,
    get_page_entities,
    get_page_extraction,
    get_page_findings,
    get_page_headings,
    get_page_images,
    get_page_indexability,
    get_page_intelligence,
    get_page_links,
    get_page_metadata,
    get_page_structured_data,
    get_question,
    get_question_set,
    get_question_set_questions,
    get_recommendation,
    get_scan_entities,
    get_scan_findings,
    get_scan_page_intelligence,
    get_scan_pages,
    get_scan_recommendations,
    get_website_ai_runs,
    get_website_entities,
    get_website_findings,
    get_website_question_sets,
    get_website_recommendations,
    run_scan,
    update_ai_run_status,
    update_entity,
    update_scan_status,
    create_opportunity,
    delete_opportunity,
    generate_opportunities_for_scan,
    generate_opportunities_for_website,
    generate_opportunity_from_finding,
    generate_opportunity_from_recommendation,
    get_finding_opportunities,
    get_opportunity,
    get_scan_opportunities,
    get_website_opportunities,
    update_opportunity,
    create_fix_plan,
    delete_fix_plan,
    delete_recommendation,
    generate_fix_plan_from_recommendation,
    generate_fix_plans_for_scan,
    generate_fix_plans_for_website,
    generate_recommendation_from_finding,
    generate_recommendation_from_opportunity,
    generate_recommendations_for_scan,
    generate_recommendations_for_website,
    get_fix_plan,
    list_fix_plans,
    list_recommendations,
    transition_fix_plan_status,
    update_fix_plan,
    update_recommendation,
    validate_fix_plan,
    validate_recommendation,
    create_validation,
    get_validation,
    list_validations,
    batch_validate_scan,
    batch_validate_website,
    run_end_to_end_intelligence_pipeline,
    get_pipeline_summary,
    generate_opportunity_from_page_intelligence,
    generate_opportunity_from_ai_run,
    list_opportunities,
    record_metric,
    evaluate_scan_monitoring,
    evaluate_website_monitoring,
    get_monitoring_timeline,
    get_website_health_status,
    analyze_page_authority_citation_trust,
    analyze_scan_authority_citation_trust,
    analyze_website_authority_citation_trust,
    analyze_direct_authority_citation_trust,
)
from .authority_citation_schemas import AuthorityCitationTrustResult


Base.metadata.create_all(
    bind=engine
)


app = FastAPI(
    title="Raval GEO Intelligence",
)


@app.get("/health")
def health():
    return {
        "status": "ok"
    }


@app.post(
    "/api/v1/websites",
    response_model=WebsiteResponse,
)
def create_website_endpoint(
    payload: WebsiteCreate,
    db: Session = Depends(get_db),
):
    return create_website(
        db,
        payload.name,
        str(payload.url),
    )


@app.post(
    "/api/v1/websites/{website_id}/scans",
    response_model=ScanResponse,
)
def create_scan_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    try:
        return create_scan(
            db,
            website_id,
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/scans/{scan_id}",
    response_model=ScanResponse,
)
def get_scan(
    scan_id: int,
    db: Session = Depends(get_db),
):

    scan = db.get(
        Scan,
        scan_id,
    )

    if scan is None:
        raise HTTPException(
            status_code=404,
            detail="Scan not found",
        )

    return scan


@app.get(
    "/api/v1/scans/{scan_id}/pages",
    response_model=list[PageResultResponse],
)
def get_scan_pages_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_scan_pages(
            db,
            scan_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/scans/{scan_id}/page-intelligence",
    response_model=list[PageIntelligenceResponse],
)
def get_scan_page_intelligence_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_scan_page_intelligence(
            db,
            scan_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.patch(
    "/api/v1/scans/{scan_id}/status",
    response_model=ScanResponse,
)
def update_scan_status_endpoint(
    scan_id: int,
    payload: ScanStatusUpdate,
    db: Session = Depends(get_db),
):

    scan = db.get(
        Scan,
        scan_id,
    )

    if scan is None:
        raise HTTPException(
            status_code=404,
            detail="Scan not found",
        )

    try:
        return update_scan_status(
            db,
            scan,
            payload.status,
            payload.error_message,
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        )


@app.post(
    "/api/v1/scans/{scan_id}/run",
    response_model=ScanResponse,
)
def run_scan_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    scan = db.get(
        Scan,
        scan_id,
    )

    if scan is None:
        raise HTTPException(
            status_code=404,
            detail="Scan not found",
        )

    try:
        run_scan(
            db,
            scan,
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        )

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )

    return scan


@app.get(
    "/api/v1/pages/{page_id}/intelligence",
    response_model=PageIntelligenceResponse,
)
def get_page_intelligence_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_page_intelligence(
            db,
            page_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/pages/{page_id}/extraction",
    response_model=PageExtractionResponse,
)
def get_page_extraction_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        extraction = get_page_extraction(
            db,
            page_id,
        )
        if extraction is None:
            raise HTTPException(
                status_code=404,
                detail="Page extraction not found",
            )
        return extraction
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/pages/{page_id}/metadata",
    response_model=PageMetadataResponse,
)
def get_page_metadata_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_page_metadata(
            db,
            page_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/pages/{page_id}/headings",
    response_model=list[PageHeadingResponse],
)
def get_page_headings_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_page_headings(
            db,
            page_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/pages/{page_id}/structured-data",
    response_model=list[PageStructuredDataResponse],
)
def get_page_structured_data_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_page_structured_data(
            db,
            page_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/pages/{page_id}/links",
    response_model=list[PageLinkResponse],
)
def get_page_links_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_page_links(
            db,
            page_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/pages/{page_id}/images",
    response_model=list[PageImageResponse],
)
def get_page_images_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_page_images(
            db,
            page_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/pages/{page_id}/indexability",
    response_model=PageIndexabilityEvidenceResponse | None,
)
def get_page_indexability_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_page_indexability(
            db,
            page_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/scans/{scan_id}/findings",
    response_model=list[FindingResponse],
)
def get_scan_findings_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_scan_findings(
            db,
            scan_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.post(
    "/api/v1/scans/{scan_id}/findings",
    response_model=FindingResponse,
    status_code=201,
)
def create_finding_endpoint(
    scan_id: int,
    payload: FindingCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_finding(
            db,
            scan_id,
            payload,
        )
    except ValueError as exc:
        err = str(exc)
        if "not found" in err.lower():
            raise HTTPException(
                status_code=404,
                detail=err,
            )
        raise HTTPException(
            status_code=400,
            detail=err,
        )


@app.get(
    "/api/v1/pages/{page_id}/findings",
    response_model=list[FindingResponse],
)
def get_page_findings_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_page_findings(
            db,
            page_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/findings/{finding_id}",
    response_model=FindingResponse,
)
def get_finding_endpoint(
    finding_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_finding(
            db,
            finding_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/websites/{website_id}/findings",
    response_model=list[FindingResponse],
)
def get_website_findings_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_website_findings(
            db,
            website_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.post(
    "/api/v1/findings/{finding_id}/recommendations",
    response_model=RecommendationResponse,
    status_code=201,
)
def create_recommendation_endpoint(
    finding_id: int,
    payload: RecommendationCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_recommendation(
            db,
            finding_id,
            payload,
        )
    except ValueError as exc:
        err = str(exc)
        if "not found" in err.lower():
            raise HTTPException(
                status_code=404,
                detail=err,
            )
        raise HTTPException(
            status_code=400,
            detail=err,
        )


@app.get(
    "/api/v1/findings/{finding_id}/recommendations",
    response_model=list[RecommendationResponse],
)
def get_finding_recommendations_endpoint(
    finding_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_finding_recommendations(
            db,
            finding_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/recommendations/{recommendation_id}",
    response_model=RecommendationResponse,
)
def get_recommendation_endpoint(
    recommendation_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_recommendation(
            db,
            recommendation_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/websites/{website_id}/recommendations",
    response_model=list[RecommendationResponse],
)
def get_website_recommendations_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_website_recommendations(
            db,
            website_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.get(
    "/api/v1/scans/{scan_id}/recommendations",
    response_model=list[RecommendationResponse],
)
def get_scan_recommendations_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_scan_recommendations(
            db,
            scan_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@app.post(
    "/api/v1/websites/{website_id}/question-sets",
    response_model=QuestionSetResponse,
    status_code=201,
)
def create_question_set_endpoint(
    website_id: int,
    payload: QuestionSetCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_question_set(
            db,
            website_id,
            payload,
        )
    except ValueError as exc:
        err = str(exc)
        if "not found" in err.lower():
            raise HTTPException(status_code=404, detail=err)
        raise HTTPException(status_code=400, detail=err)


@app.get(
    "/api/v1/websites/{website_id}/question-sets",
    response_model=list[QuestionSetResponse],
)
def get_website_question_sets_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_website_question_sets(
            db,
            website_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/question-sets/{question_set_id}/questions",
    response_model=QuestionResponse,
    status_code=201,
)
def create_question_endpoint(
    question_set_id: int,
    payload: QuestionCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_question(
            db,
            question_set_id,
            payload,
        )
    except ValueError as exc:
        err = str(exc)
        if "not found" in err.lower():
            raise HTTPException(status_code=404, detail=err)
        raise HTTPException(status_code=400, detail=err)


@app.get(
    "/api/v1/question-sets/{question_set_id}/questions",
    response_model=list[QuestionResponse],
)
def get_question_set_questions_endpoint(
    question_set_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_question_set_questions(
            db,
            question_set_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/websites/{website_id}/ai-runs",
    response_model=AIRunResponse,
    status_code=201,
)
def create_ai_run_endpoint(
    website_id: int,
    payload: AIRunCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_ai_run(
            db,
            website_id,
            payload,
        )
    except ValueError as exc:
        err = str(exc)
        if "not found" in err.lower():
            raise HTTPException(status_code=404, detail=err)
        raise HTTPException(status_code=400, detail=err)


@app.get(
    "/api/v1/websites/{website_id}/ai-runs",
    response_model=list[AIRunResponse],
)
def get_website_ai_runs_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_website_ai_runs(
            db,
            website_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/ai-runs/{run_id}",
    response_model=AIRunResponse,
)
def get_ai_run_endpoint(
    run_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_ai_run(
            db,
            run_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.patch(
    "/api/v1/ai-runs/{run_id}/status",
    response_model=AIRunResponse,
)
def update_ai_run_status_endpoint(
    run_id: int,
    payload: AIRunStatusUpdate,
    db: Session = Depends(get_db),
):
    run = db.get(AIRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="AI run not found")

    try:
        return update_ai_run_status(
            db,
            run,
            payload.status,
            payload.error_message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.post(
    "/api/v1/ai-runs/{run_id}/result",
    response_model=AIResultResponse,
    status_code=201,
)
def create_ai_result_endpoint(
    run_id: int,
    payload: AIResultCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_ai_result(
            db,
            run_id,
            payload,
        )
    except ValueError as exc:
        err = str(exc)
        if "not found" in err.lower():
            raise HTTPException(status_code=404, detail=err)
        if "already exists" in err.lower():
            raise HTTPException(status_code=409, detail=err)
        raise HTTPException(status_code=400, detail=err)


@app.get(
    "/api/v1/ai-runs/{run_id}/result",
    response_model=AIResultResponse,
)
def get_ai_run_result_endpoint(
    run_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_ai_run_result(
            db,
            run_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/ai-results/{result_id}/citations",
    response_model=list[CitationResponse],
)
def get_ai_result_citations_endpoint(
    result_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_ai_result_citations(
            db,
            result_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/websites/{website_id}/entities",
    response_model=EntityResponse,
    status_code=201,
)
def create_entity_endpoint(
    website_id: int,
    payload: EntityCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_entity(
            db,
            website_id,
            payload,
        )
    except ValueError as exc:
        err = str(exc)
        if "not found" in err.lower():
            raise HTTPException(status_code=404, detail=err)
        raise HTTPException(status_code=400, detail=err)


@app.get(
    "/api/v1/websites/{website_id}/entities",
    response_model=list[EntityResponse],
)
def get_website_entities_endpoint(
    website_id: int,
    entity_type: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        return get_website_entities(
            db,
            website_id,
            entity_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/entities/{entity_id}",
    response_model=EntityResponse,
)
def get_entity_endpoint(
    entity_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_entity(
            db,
            entity_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.patch(
    "/api/v1/entities/{entity_id}",
    response_model=EntityResponse,
)
def update_entity_endpoint(
    entity_id: int,
    payload: EntityUpdate,
    db: Session = Depends(get_db),
):
    try:
        return update_entity(
            db,
            entity_id,
            payload,
        )
    except ValueError as exc:
        err = str(exc)
        if "not found" in err.lower():
            raise HTTPException(status_code=404, detail=err)
        raise HTTPException(status_code=400, detail=err)


@app.delete(
    "/api/v1/entities/{entity_id}",
)
def delete_entity_endpoint(
    entity_id: int,
    db: Session = Depends(get_db),
):
    try:
        delete_entity(
            db,
            entity_id,
        )
        return {"status": "deleted", "id": entity_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/entities",
    response_model=list[EntityResponse],
)
def get_page_entities_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_page_entities(
            db,
            page_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/scans/{scan_id}/entities",
    response_model=list[EntityResponse],
)
def get_scan_entities_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_scan_entities(
            db,
            scan_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/content-structure",
    response_model=ContentStructureResponse,
)
def get_page_content_structure_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        return analyze_page_content_structure(
            db,
            page_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/topic-analysis",
    response_model=TopicAnalysisResponse,
)
def get_page_topic_analysis_endpoint(
    page_id: int,
    persist_findings: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return analyze_page_topics(
            db,
            page_id,
            persist_findings=persist_findings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/entity-analysis",
    response_model=EntityAnalysisResponse,
)
def get_page_entity_analysis_endpoint(
    page_id: int,
    persist_entities: bool = False,
    persist_findings: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return analyze_page_entities(
            db,
            page_id,
            persist_entities=persist_entities,
            persist_findings=persist_findings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/question-analysis",
    response_model=QuestionAnalysisResponse,
)
def get_page_question_analysis_endpoint(
    page_id: int,
    persist_findings: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return analyze_page_questions(
            db,
            page_id,
            persist_findings=persist_findings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/answer-analysis",
    response_model=AnswerAnalysisResponse,
)
def get_page_answer_analysis_endpoint(
    page_id: int,
    persist_findings: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return analyze_page_answers(
            db,
            page_id,
            persist_findings=persist_findings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/answer-readiness",
    response_model=AnswerReadinessResponse,
)
def get_page_answer_readiness_endpoint(
    page_id: int,
    persist_findings: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return analyze_page_readiness(
            db,
            page_id,
            persist_findings=persist_findings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/content-gaps",
    response_model=ContentGapResponse,
)
def get_page_content_gaps_endpoint(
    page_id: int,
    persist_findings: bool = False,
    persist_recommendations: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return analyze_page_content_gaps(
            db,
            page_id,
            persist_findings=persist_findings,
            persist_recommendations=persist_recommendations,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/quality-analysis",
    response_model=QualityAnalysisResponse,
)
def get_page_quality_analysis_endpoint(
    page_id: int,
    persist_findings: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return analyze_page_quality(
            db,
            page_id,
            persist_findings=persist_findings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/intent-analysis",
    response_model=IntentAnalysisResponse,
)
def get_page_intent_analysis_endpoint(
    page_id: int,
    persist_findings: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return analyze_page_intent(
            db,
            page_id,
            persist_findings=persist_findings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/semantic-coverage",
    response_model=SemanticCoverageResponse,
)
def get_page_semantic_coverage_endpoint(
    page_id: int,
    persist_findings: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return analyze_page_semantic_coverage(
            db,
            page_id,
            persist_findings=persist_findings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/content-intelligence",
    response_model=ContentIntelligenceResponse,
)
def get_page_content_intelligence_endpoint(
    page_id: int,
    persist_findings: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return analyze_page_content_intelligence(
            db,
            page_id,
            persist_findings=persist_findings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/pages/{page_id}/content-quality-checks",
    response_model=ContentQualityChecksResponse,
)
def get_page_content_quality_checks_endpoint(
    page_id: int,
    persist_findings: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return run_page_content_quality_checks(
            db,
            page_id,
            persist_findings=persist_findings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/scans/{scan_id}/content-intelligence",
    response_model=ScanContentIntelligenceSummaryResponse,
)
def get_scan_content_intelligence_endpoint(
    scan_id: int,
    persist_findings: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return analyze_scan_content_intelligence(
            db,
            scan_id,
            persist_findings=persist_findings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/pages/{page_id}/run-content-pipeline",
    response_model=ContentPipelineResultResponse,
)
def run_page_content_pipeline_endpoint(
    page_id: int,
    persist_all: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return run_full_page_content_pipeline(
            db,
            page_id,
            persist_all=persist_all,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/content-intelligence/rules",
    response_model=ContentAEORulesResponse,
)
def get_content_aeo_rules_endpoint(
    category: str | None = None,
):
    rules = get_content_aeo_rules(category=category)
    categories = sorted(list({r["category"] for r in rules}))
    return {
        "total_rules": len(rules),
        "categories": categories,
        "rules": rules,
    }


# ==========================================
# Task 6 Opportunity Engine & Prioritization Endpoints
# ==========================================

@app.post(
    "/api/v1/opportunities",
    response_model=OpportunityResponse,
)
def create_opportunity_endpoint(
    payload: OpportunityCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_opportunity(db, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.get(
    "/api/v1/opportunities/{opportunity_id}",
    response_model=OpportunityResponse,
)
def get_opportunity_endpoint(
    opportunity_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_opportunity(db, opportunity_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.patch(
    "/api/v1/opportunities/{opportunity_id}",
    response_model=OpportunityResponse,
)
def update_opportunity_endpoint(
    opportunity_id: int,
    payload: OpportunityUpdate,
    db: Session = Depends(get_db),
):
    try:
        return update_opportunity(db, opportunity_id, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.delete(
    "/api/v1/opportunities/{opportunity_id}",
)
def delete_opportunity_endpoint(
    opportunity_id: int,
    db: Session = Depends(get_db),
):
    try:
        delete_opportunity(db, opportunity_id)
        return {"status": "success", "deleted_id": opportunity_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/opportunities",
    response_model=list[OpportunityResponse],
)
def list_opportunities_endpoint(
    website_id: int | None = None,
    scan_id: int | None = None,
    category: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    opportunity_type: str | None = None,
    db: Session = Depends(get_db),
):
    if website_id is not None:
        try:
            return get_website_opportunities(
                db,
                website_id,
                scan_id=scan_id,
                category=category,
                status=status,
                priority=priority,
                opportunity_type=opportunity_type,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

    from .models import Opportunity
    query = db.query(Opportunity)
    if scan_id is not None:
        query = query.filter(Opportunity.scan_id == scan_id)
    if category:
        query = query.filter(Opportunity.category == category.lower())
    if status:
        query = query.filter(Opportunity.status == status.lower())
    if priority:
        query = query.filter(Opportunity.priority == priority.upper())
    if opportunity_type:
        query = query.filter(Opportunity.opportunity_type == opportunity_type)

    return query.order_by(Opportunity.priority_score.desc(), Opportunity.id.asc()).all()


@app.get(
    "/api/v1/websites/{website_id}/opportunities",
    response_model=list[OpportunityResponse],
)
def get_website_opportunities_endpoint(
    website_id: int,
    scan_id: int | None = None,
    category: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    opportunity_type: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        return get_website_opportunities(
            db,
            website_id,
            scan_id=scan_id,
            category=category,
            status=status,
            priority=priority,
            opportunity_type=opportunity_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/scans/{scan_id}/opportunities",
    response_model=list[OpportunityResponse],
)
def get_scan_opportunities_endpoint(
    scan_id: int,
    category: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        return get_scan_opportunities(
            db,
            scan_id,
            category=category,
            status=status,
            priority=priority,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/findings/{finding_id}/opportunities",
    response_model=list[OpportunityResponse],
)
def get_finding_opportunities_endpoint(
    finding_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_finding_opportunities(db, finding_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/findings/{finding_id}/generate-opportunities",
    response_model=OpportunityResponse,
)
def generate_opportunity_for_finding_endpoint(
    finding_id: int,
    recommendation_id: int | None = None,
    db: Session = Depends(get_db),
):
    try:
        return generate_opportunity_from_finding(
            db,
            finding_id,
            recommendation_id=recommendation_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.post(
    "/api/v1/recommendations/{recommendation_id}/generate-opportunities",
    response_model=OpportunityResponse,
)
def generate_opportunity_for_recommendation_endpoint(
    recommendation_id: int,
    db: Session = Depends(get_db),
):
    try:
        return generate_opportunity_from_recommendation(
            db,
            recommendation_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/scans/{scan_id}/generate-opportunities",
    response_model=OpportunityBatchGenerateResponse,
)
def generate_opportunities_for_scan_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    try:
        scan = db.get(Scan, scan_id)
        if scan is None:
            raise HTTPException(status_code=404, detail="Scan not found")
        ops = generate_opportunities_for_scan(db, scan_id)
        return {
            "website_id": scan.website_id,
            "scan_id": scan_id,
            "generated_count": len(ops),
            "opportunities": ops,
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/websites/{website_id}/generate-opportunities",
    response_model=OpportunityBatchGenerateResponse,
)
def generate_opportunities_for_website_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    try:
        website = db.get(Website, website_id)
        if website is None:
            raise HTTPException(status_code=404, detail="Website not found")
        ops = generate_opportunities_for_website(db, website_id)
        return {
            "website_id": website_id,
            "scan_id": None,
            "generated_count": len(ops),
            "opportunities": ops,
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ==========================================
# Task 6.3 Recommendation Engine Endpoints
# ==========================================

@app.get(
    "/api/v1/recommendations",
    response_model=list[RecommendationResponse],
)
def list_recommendations_endpoint(
    website_id: int | None = None,
    scan_id: int | None = None,
    finding_id: int | None = None,
    opportunity_id: int | None = None,
    status: str | None = None,
    priority: str | None = None,
    action_type: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        return list_recommendations(
            db,
            website_id=website_id,
            scan_id=scan_id,
            finding_id=finding_id,
            opportunity_id=opportunity_id,
            status=status,
            priority=priority,
            action_type=action_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.patch(
    "/api/v1/recommendations/{recommendation_id}",
    response_model=RecommendationResponse,
)
def update_recommendation_endpoint(
    recommendation_id: int,
    payload: RecommendationUpdate,
    db: Session = Depends(get_db),
):
    try:
        return update_recommendation(db, recommendation_id, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.delete(
    "/api/v1/recommendations/{recommendation_id}",
)
def delete_recommendation_endpoint(
    recommendation_id: int,
    db: Session = Depends(get_db),
):
    try:
        delete_recommendation(db, recommendation_id)
        return {"status": "success", "deleted_id": recommendation_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/findings/{finding_id}/generate-recommendations",
    response_model=RecommendationResponse,
)
def generate_recommendation_for_finding_endpoint(
    finding_id: int,
    opportunity_id: int | None = None,
    db: Session = Depends(get_db),
):
    try:
        return generate_recommendation_from_finding(
            db,
            finding_id,
            opportunity_id=opportunity_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.post(
    "/api/v1/opportunities/{opportunity_id}/generate-recommendations",
    response_model=RecommendationResponse,
)
def generate_recommendation_for_opportunity_endpoint(
    opportunity_id: int,
    db: Session = Depends(get_db),
):
    try:
        return generate_recommendation_from_opportunity(
            db,
            opportunity_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/scans/{scan_id}/generate-recommendations",
    response_model=RecommendationBatchGenerateResponse,
)
def generate_recommendations_for_scan_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    try:
        scan = db.get(Scan, scan_id)
        if scan is None:
            raise HTTPException(status_code=404, detail="Scan not found")
        recs = generate_recommendations_for_scan(db, scan_id)
        return {
            "website_id": scan.website_id,
            "scan_id": scan_id,
            "generated_count": len(recs),
            "recommendations": recs,
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/websites/{website_id}/generate-recommendations",
    response_model=RecommendationBatchGenerateResponse,
)
def generate_recommendations_for_website_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    try:
        website = db.get(Website, website_id)
        if website is None:
            raise HTTPException(status_code=404, detail="Website not found")
        recs = generate_recommendations_for_website(db, website_id)
        return {
            "website_id": website_id,
            "scan_id": None,
            "generated_count": len(recs),
            "recommendations": recs,
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/opportunities/{opportunity_id}/recommendations",
    response_model=list[RecommendationResponse],
)
def get_opportunity_recommendations_endpoint(
    opportunity_id: int,
    db: Session = Depends(get_db),
):
    op = db.get(Opportunity, opportunity_id)
    if op is None:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    if op.recommendation:
        return [op.recommendation]
    # Check by finding_id
    if op.finding_id:
        return db.query(Recommendation).filter(Recommendation.finding_id == op.finding_id).all()
    return []


# ==========================================
# Task 6.4 Fix / Action Planning Endpoints
# ==========================================

@app.post(
    "/api/v1/fix-plans",
    response_model=FixPlanResponse,
    status_code=201,
)
def create_fix_plan_endpoint(
    payload: FixPlanCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_fix_plan(db, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.get(
    "/api/v1/fix-plans/{fix_plan_id}",
    response_model=FixPlanResponse,
)
def get_fix_plan_endpoint(
    fix_plan_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_fix_plan(db, fix_plan_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.patch(
    "/api/v1/fix-plans/{fix_plan_id}",
    response_model=FixPlanResponse,
)
def update_fix_plan_endpoint(
    fix_plan_id: int,
    payload: FixPlanUpdate,
    db: Session = Depends(get_db),
):
    try:
        return update_fix_plan(db, fix_plan_id, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.post(
    "/api/v1/fix-plans/{fix_plan_id}/status",
    response_model=FixPlanResponse,
)
def transition_fix_plan_status_endpoint(
    fix_plan_id: int,
    payload: FixPlanStatusTransition,
    db: Session = Depends(get_db),
):
    try:
        return transition_fix_plan_status(
            db,
            fix_plan_id,
            payload.status,
            comment=payload.comment,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.delete(
    "/api/v1/fix-plans/{fix_plan_id}",
)
def delete_fix_plan_endpoint(
    fix_plan_id: int,
    db: Session = Depends(get_db),
):
    try:
        delete_fix_plan(db, fix_plan_id)
        return {"status": "success", "deleted_id": fix_plan_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/fix-plans",
    response_model=list[FixPlanResponse],
)
def list_fix_plans_endpoint(
    website_id: int | None = None,
    scan_id: int | None = None,
    recommendation_id: int | None = None,
    opportunity_id: int | None = None,
    status: str | None = None,
    fix_type: str | None = None,
    priority: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        return list_fix_plans(
            db,
            website_id=website_id,
            scan_id=scan_id,
            recommendation_id=recommendation_id,
            opportunity_id=opportunity_id,
            status=status,
            fix_type=fix_type,
            priority=priority,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post(
    "/api/v1/recommendations/{recommendation_id}/generate-fix-plan",
    response_model=FixPlanResponse,
)
def generate_fix_plan_for_recommendation_endpoint(
    recommendation_id: int,
    db: Session = Depends(get_db),
):
    try:
        return generate_fix_plan_from_recommendation(
            db,
            recommendation_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/recommendations/{recommendation_id}/fix-plans",
    response_model=list[FixPlanResponse],
)
def get_recommendation_fix_plans_endpoint(
    recommendation_id: int,
    db: Session = Depends(get_db),
):
    rec = db.get(Recommendation, recommendation_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return db.query(FixPlan).filter(FixPlan.recommendation_id == recommendation_id).all()


@app.post(
    "/api/v1/scans/{scan_id}/generate-fix-plans",
    response_model=FixPlanBatchGenerateResponse,
)
def generate_fix_plans_for_scan_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    try:
        scan = db.get(Scan, scan_id)
        if scan is None:
            raise HTTPException(status_code=404, detail="Scan not found")
        plans = generate_fix_plans_for_scan(db, scan_id)
        return {
            "website_id": scan.website_id,
            "scan_id": scan_id,
            "generated_count": len(plans),
            "fix_plans": plans,
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/websites/{website_id}/generate-fix-plans",
    response_model=FixPlanBatchGenerateResponse,
)
def generate_fix_plans_for_website_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    try:
        website = db.get(Website, website_id)
        if website is None:
            raise HTTPException(status_code=404, detail="Website not found")
        plans = generate_fix_plans_for_website(db, website_id)
        return {
            "website_id": website_id,
            "scan_id": None,
            "generated_count": len(plans),
            "fix_plans": plans,
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ==========================================
# Task 6.5 & 6.6 — Validation API Endpoints
# ==========================================

@app.post(
    "/api/v1/fix-plans/{fix_plan_id}/validate",
    response_model=ValidationResponse,
)
def validate_fix_plan_endpoint(
    fix_plan_id: int,
    request: ValidationRunRequest | None = None,
    db: Session = Depends(get_db),
):
    try:
        simulated = request.simulated_after_state if request else None
        return validate_fix_plan(db, fix_plan_id, simulated_after_state=simulated)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/recommendations/{recommendation_id}/validate",
    response_model=ValidationResponse,
)
def validate_recommendation_endpoint(
    recommendation_id: int,
    request: ValidationRunRequest | None = None,
    db: Session = Depends(get_db),
):
    try:
        simulated = request.simulated_after_state if request else None
        return validate_recommendation(db, recommendation_id, simulated_after_state=simulated)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/validations",
    response_model=ValidationResponse,
    status_code=201,
)
def create_validation_endpoint(
    payload: ValidationCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_validation(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/validations/{validation_id}",
    response_model=ValidationResponse,
)
def get_validation_endpoint(
    validation_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_validation(db, validation_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get(
    "/api/v1/validations",
    response_model=list[ValidationResponse],
)
def list_validations_endpoint(
    website_id: int | None = None,
    scan_id: int | None = None,
    fix_plan_id: int | None = None,
    recommendation_id: int | None = None,
    finding_id: int | None = None,
    opportunity_id: int | None = None,
    status: str | None = None,
    result: str | None = None,
    validation_type: str | None = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    return list_validations(
        db,
        website_id=website_id,
        scan_id=scan_id,
        fix_plan_id=fix_plan_id,
        recommendation_id=recommendation_id,
        finding_id=finding_id,
        opportunity_id=opportunity_id,
        status=status,
        result=result,
        validation_type=validation_type,
        limit=limit,
        offset=offset,
    )


@app.get(
    "/api/v1/fix-plans/{fix_plan_id}/validations",
    response_model=list[ValidationResponse],
)
def get_fix_plan_validations_endpoint(
    fix_plan_id: int,
    db: Session = Depends(get_db),
):
    plan = db.get(FixPlan, fix_plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="FixPlan not found")
    return db.query(ValidationResult).filter(ValidationResult.fix_plan_id == fix_plan_id).all()


@app.get(
    "/api/v1/recommendations/{recommendation_id}/validations",
    response_model=list[ValidationResponse],
)
def get_recommendation_validations_endpoint(
    recommendation_id: int,
    db: Session = Depends(get_db),
):
    rec = db.get(Recommendation, recommendation_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return db.query(ValidationResult).filter(ValidationResult.recommendation_id == recommendation_id).all()


@app.post(
    "/api/v1/scans/{scan_id}/validate",
    response_model=ValidationBatchResponse,
)
def batch_validate_scan_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    try:
        validations = batch_validate_scan(db, scan_id)
        pass_count = sum(1 for v in validations if v.result == "PASS")
        fail_count = sum(1 for v in validations if v.result == "FAIL")
        partial_count = sum(1 for v in validations if v.result == "PARTIAL")
        return {
            "website_id": None,
            "scan_id": scan_id,
            "total_validated": len(validations),
            "pass_count": pass_count,
            "fail_count": fail_count,
            "partial_count": partial_count,
            "validations": validations,
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post(
    "/api/v1/websites/{website_id}/validate",
    response_model=ValidationBatchResponse,
)
def batch_validate_website_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    try:
        validations = batch_validate_website(db, website_id)
        pass_count = sum(1 for v in validations if v.result == "PASS")
        fail_count = sum(1 for v in validations if v.result == "FAIL")
        partial_count = sum(1 for v in validations if v.result == "PARTIAL")
        return {
            "website_id": website_id,
            "scan_id": None,
            "total_validated": len(validations),
            "pass_count": pass_count,
            "fail_count": fail_count,
            "partial_count": partial_count,
            "validations": validations,
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ====================================================
# Task 6.7 — End-to-End Intelligence Pipeline Endpoints
# ====================================================

@app.post(
    "/api/v1/scans/{scan_id}/run-pipeline",
    response_model=PipelineRunResponse,
)
def run_scan_pipeline_endpoint(
    scan_id: int,
    request: PipelineRunRequest | None = None,
    db: Session = Depends(get_db),
):
    scan = db.get(Scan, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail=f"Scan with id {scan_id} not found")
    run_vals = request.run_validations if request else True
    try:
        return run_end_to_end_intelligence_pipeline(
            db,
            website_id=scan.website_id,
            scan_id=scan_id,
            run_validations=run_vals,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post(
    "/api/v1/websites/{website_id}/run-pipeline",
    response_model=PipelineRunResponse,
)
def run_website_pipeline_endpoint(
    website_id: int,
    request: PipelineRunRequest | None = None,
    db: Session = Depends(get_db),
):
    website = db.get(Website, website_id)
    if not website:
        raise HTTPException(status_code=404, detail=f"Website with id {website_id} not found")
    run_vals = request.run_validations if request else True
    try:
        return run_end_to_end_intelligence_pipeline(
            db,
            website_id=website_id,
            scan_id=None,
            run_validations=run_vals,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get(
    "/api/v1/scans/{scan_id}/pipeline-summary",
    response_model=PipelineSummaryResponse,
)
def get_scan_pipeline_summary_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    scan = db.get(Scan, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail=f"Scan with id {scan_id} not found")
    try:
        return get_pipeline_summary(db, website_id=scan.website_id, scan_id=scan_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get(
    "/api/v1/websites/{website_id}/pipeline-summary",
    response_model=PipelineSummaryResponse,
)
def get_website_pipeline_summary_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    website = db.get(Website, website_id)
    if not website:
        raise HTTPException(status_code=404, detail=f"Website with id {website_id} not found")
    try:
        return get_pipeline_summary(db, website_id=website_id, scan_id=None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ==========================================
# Task 6.8 Page & AI Run Opportunity Endpoints
# ==========================================

@app.post(
    "/api/v1/pages/{page_id}/generate-opportunities",
    response_model=list[OpportunityResponse],
)
def generate_page_opportunities_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    try:
        return generate_opportunity_from_page_intelligence(db, page_id)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400, detail=str(exc))


@app.post(
    "/api/v1/ai-runs/{ai_run_id}/generate-opportunities",
    response_model=OpportunityResponse,
)
def generate_ai_run_opportunities_endpoint(
    ai_run_id: int,
    db: Session = Depends(get_db),
):
    try:
        return generate_opportunity_from_ai_run(db, ai_run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400, detail=str(exc))


# ==========================================
# Task 6.10 Monitoring Engine Endpoints
# ==========================================

@app.post(
    "/api/v1/scans/{scan_id}/monitoring",
    response_model=list[MonitoringRecordResponse],
)
def evaluate_scan_monitoring_endpoint(
    scan_id: int,
    db: Session = Depends(get_db),
):
    try:
        return evaluate_scan_monitoring(db, scan_id)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400, detail=str(exc))


@app.post(
    "/api/v1/websites/{website_id}/monitoring",
    response_model=list[MonitoringRecordResponse],
)
def evaluate_website_monitoring_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    try:
        return evaluate_website_monitoring(db, website_id)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400, detail=str(exc))


@app.get(
    "/api/v1/websites/{website_id}/monitoring-timeline",
    response_model=MonitoringTimelineResponse,
)
def get_monitoring_timeline_endpoint(
    website_id: int,
    metric_name: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    try:
        records = get_monitoring_timeline(db, website_id, metric_name=metric_name, limit=limit)
        return {
            "website_id": website_id,
            "total_records": len(records),
            "records": records,
        }
    except ValueError as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400, detail=str(exc))


@app.get(
    "/api/v1/websites/{website_id}/health-summary",
    response_model=WebsiteHealthSummaryResponse,
)
def get_website_health_summary_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    try:
        return get_website_health_status(db, website_id)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400, detail=str(exc))


# =============================================================================
# Day 8 - Phase B - Step 11: Authority, Citation & Trust Intelligence Endpoints
# =============================================================================

@app.get(
    "/api/v1/pages/{page_id}/authority-citation-trust",
    response_model=AuthorityCitationTrustResult,
)
def get_page_authority_citation_trust_endpoint(
    page_id: int,
    persist: bool = False,
    db: Session = Depends(get_db),
):
    """
    Evaluates trust, authority, source quality, claim support, transparency,
    and structural citation readiness for a specific page.
    """
    try:
        return analyze_page_authority_citation_trust(
            db=db,
            page_id=page_id,
            persist_findings=persist,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.post(
    "/api/v1/pages/{page_id}/authority-citation-trust",
    response_model=AuthorityCitationTrustResult,
)
def post_page_authority_citation_trust_endpoint(
    page_id: int,
    persist: bool = True,
    db: Session = Depends(get_db),
):
    """
    Evaluates and persists findings and actionable recommendations for a specific page.
    """
    try:
        return analyze_page_authority_citation_trust(
            db=db,
            page_id=page_id,
            persist_findings=persist,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.get(
    "/api/v1/scans/{scan_id}/authority-citation-trust",
    response_model=list[AuthorityCitationTrustResult],
)
def get_scan_authority_citation_trust_endpoint(
    scan_id: int,
    persist: bool = False,
    db: Session = Depends(get_db),
):
    """
    Evaluates trust, authority, source quality, claim support, transparency,
    and structural citation readiness across all pages in a scan.
    """
    try:
        return analyze_scan_authority_citation_trust(
            db=db,
            scan_id=scan_id,
            persist_findings=persist,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.post(
    "/api/v1/scans/{scan_id}/authority-citation-trust",
    response_model=list[AuthorityCitationTrustResult],
)
def post_scan_authority_citation_trust_endpoint(
    scan_id: int,
    persist: bool = True,
    db: Session = Depends(get_db),
):
    """
    Evaluates and persists findings and actionable recommendations across all pages in a scan.
    """
    try:
        return analyze_scan_authority_citation_trust(
            db=db,
            scan_id=scan_id,
            persist_findings=persist,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.get(
    "/api/v1/websites/{website_id}/authority-citation-trust",
    response_model=list[AuthorityCitationTrustResult],
)
def get_website_authority_citation_trust_endpoint(
    website_id: int,
    persist: bool = False,
    db: Session = Depends(get_db),
):
    """
    Evaluates trust, authority, source quality, claim support, transparency,
    and structural citation readiness across the latest scan of a website.
    """
    try:
        return analyze_website_authority_citation_trust(
            db=db,
            website_id=website_id,
            persist_findings=persist,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.post(
    "/api/v1/websites/{website_id}/authority-citation-trust",
    response_model=list[AuthorityCitationTrustResult],
)
def post_website_authority_citation_trust_endpoint(
    website_id: int,
    persist: bool = True,
    db: Session = Depends(get_db),
):
    """
    Evaluates and persists findings and actionable recommendations across the latest scan of a website.
    """
    try:
        return analyze_website_authority_citation_trust(
            db=db,
            website_id=website_id,
            persist_findings=persist,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.post(
    "/api/v1/authority-citation-trust/analyze",
    response_model=AuthorityCitationTrustResult,
)
def analyze_direct_authority_citation_trust_endpoint(
    payload: DirectAuthorityCitationAnalysisRequest,
):
    """
    Direct ad-hoc evaluation of Authority, Citation & Trust signals for raw HTML or page properties.
    """
    try:
        return analyze_direct_authority_citation_trust(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# =============================================================================
# Task 8.6 - 8.8 Scoring, Explanation, Recommendation & Site Summary Endpoints
# =============================================================================

@app.get(
    "/api/v1/scores/pages/{page_id}",
    response_model=ScoreExplanationResponse,
)
@app.get(
    "/api/scores/pages/{page_id}",
    response_model=ScoreExplanationResponse,
    include_in_schema=False,
)
def get_page_score_and_explanation_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    """
    Returns the deterministic overall score, category breakdown, point deductions,
    verified passing strengths, N/A rules, and evidence-grounded explanation for a page.
    """
    try:
        _, explanation, _, _ = evaluate_page_intelligence_score(db, page_id=page_id)
        return explanation
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.get(
    "/api/v1/scores/pages/{page_id}/recommendations",
    response_model=PageRecommendationsListResponse,
)
@app.get(
    "/api/scores/pages/{page_id}/recommendations",
    response_model=PageRecommendationsListResponse,
    include_in_schema=False,
)
def get_page_recommendations_endpoint(
    page_id: int,
    db: Session = Depends(get_db),
):
    """
    Returns evidence-backed, prioritized recommendations for a page classified
    into Quick Wins (low effort / immediate impact) and Deep Fixes (content / architecture).
    """
    try:
        _, _, recs, analytics = evaluate_page_intelligence_score(db, page_id=page_id)
        quick_wins = sum(1 for r in recs if r.classification == "quick_win")
        deep_fixes = sum(1 for r in recs if r.classification == "deep_fix")

        return PageRecommendationsListResponse(
            page_id=page_id,
            url=analytics.url,
            total_recommendations=len(recs),
            quick_wins_count=quick_wins,
            deep_fixes_count=deep_fixes,
            recommendations=recs,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.get(
    "/api/v1/scores/websites/{website_id}",
    response_model=SiteScoreSummary,
)
@app.get(
    "/api/scores/websites/{website_id}",
    response_model=SiteScoreSummary,
    include_in_schema=False,
)
def get_site_score_summary_endpoint(
    website_id: int,
    scan_id: int | None = None,
    db: Session = Depends(get_db),
):
    """
    Returns aggregated site-level intelligence, category summaries, top score-impacting
    issues, and historical comparison for a website.
    """
    try:
        return evaluate_site_intelligence_summary(
            db=db,
            website_id=website_id,
            scan_id=scan_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.get(
    "/api/v1/scores/websites/{website_id}/findings",
)
@app.get(
    "/api/scores/websites/{website_id}/findings",
    include_in_schema=False,
)
def get_site_findings_summary_endpoint(
    website_id: int,
    scan_id: int | None = None,
    db: Session = Depends(get_db),
):
    """
    Returns site-level findings grouped by priority, category, and status.
    """
    try:
        summary = evaluate_site_intelligence_summary(
            db=db,
            website_id=website_id,
            scan_id=scan_id,
        )
        return {
            "website_id": website_id,
            "scan_id": summary.scan_id,
            "total_pages": summary.total_pages_analyzed,
            "findings_by_priority": summary.findings_by_priority,
            "findings_by_status": summary.findings_by_status,
            "top_issues": summary.top_issues,
        }
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.get(
    "/api/v1/scores/websites/{website_id}/recommendations",
    response_model=list[PrioritizedRecommendationResponse],
)
@app.get(
    "/api/scores/websites/{website_id}/recommendations",
    response_model=list[PrioritizedRecommendationResponse],
    include_in_schema=False,
)
def get_site_recommendations_endpoint(
    website_id: int,
    classification: str | None = None,
    priority: str | None = None,
    scan_id: int | None = None,
    db: Session = Depends(get_db),
):
    """
    Returns deduplicated site-wide recommendations with optional classification and priority filters.
    """
    try:
        summary = evaluate_site_intelligence_summary(
            db=db,
            website_id=website_id,
            scan_id=scan_id,
        )
        # Construct recommendations from top issues / aggregated recommendations
        recs: list[PrioritizedRecommendationResponse] = []
        for issue in summary.top_issues:
            if classification and issue.classification.lower() != classification.lower():
                continue
            if priority and issue.priority.lower() != priority.lower():
                continue

            recs.append(
                PrioritizedRecommendationResponse(
                    recommendation_id=f"site_rec_{issue.rule_id}",
                    rule_id=issue.rule_id,
                    category=issue.category,
                    priority=issue.priority,
                    classification=issue.classification,
                    title=issue.title,
                    explanation=f"Affects {issue.affected_pages_count} pages with cumulative score impact of {issue.total_score_impact} points.",
                    recommended_action=issue.recommended_action,
                    expected_impact=f"Resolves {issue.title} across {issue.affected_pages_count} pages.",
                    score_impact=issue.total_score_impact,
                    status="open",
                    metadata={"affected_pages_count": issue.affected_pages_count},
                )
            )
        return recs
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )


@app.get(
    "/api/v1/scores/websites/{website_id}/history",
    response_model=SiteScoreHistoryResponse,
)
@app.get(
    "/api/scores/websites/{website_id}/history",
    response_model=SiteScoreHistoryResponse,
    include_in_schema=False,
)
def get_site_score_history_endpoint(
    website_id: int,
    db: Session = Depends(get_db),
):
    """
    Returns the historical score timeline across all scans for a website.
    """
    try:
        history_points = get_site_score_history(db, website_id=website_id)
        return SiteScoreHistoryResponse(
            website_id=website_id,
            total_scans=len(history_points),
            history=history_points,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 400,
            detail=str(exc),
        )
