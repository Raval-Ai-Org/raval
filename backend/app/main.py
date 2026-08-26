from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from .content_intelligence_rules import get_content_aeo_rules
from .database import Base, engine, get_db
from .models import AIRun, Entity, Scan
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
    IntentAnalysisResponse,
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
    RecommendationCreate,
    RecommendationResponse,
    ScanContentIntelligenceSummaryResponse,
    ScanResponse,
    ScanStatusUpdate,
    SemanticCoverageResponse,
    TopicAnalysisResponse,
    WebsiteCreate,
    WebsiteResponse,
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
)


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