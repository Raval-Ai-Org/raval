from datetime import datetime
import re
from urllib.parse import urlparse

from sqlalchemy.orm import Session


from crawler.config import CrawlerConfig
from crawler.crawler import Crawler

from .models import (
    AIRun,
    AIResult,
    Citation,
    Entity,
    Finding,
    PageExtraction,
    PageHeading,
    PageImage,
    PageIndexabilityEvidence,
    PageLink,
    PageResult,
    PageStructuredData,
    Question,
    QuestionSet,
    Recommendation,
    Scan,
    Website,
)
from .answer_analyzer import analyze_answers
from .content_gap_analyzer import analyze_content_gaps
from .content_intelligence_analyzer import analyze_content_intelligence
from .content_quality_checks import run_content_quality_checks
from .content_structure_analyzer import analyze_content_structure
from .entity_analyzer import analyze_entities
from .intent_analyzer import analyze_intent
from .quality_analyzer import analyze_quality
from .question_analyzer import analyze_questions
from .readiness_analyzer import analyze_readiness
from .semantic_coverage_analyzer import analyze_semantic_coverage
from .topic_analyzer import analyze_topic_semantics
from .page_extractor import extract_page, extract_scan_pages
from .schemas import (
    AIRunCreate,
    AIResultCreate,
    EntityCreate,
    EntityUpdate,
    FindingCreate,
    QuestionCreate,
    QuestionSetCreate,
    RecommendationCreate,
)


ALLOWED_STATES = {
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
}


ALLOWED_TRANSITIONS = {
    "queued": {
        "running",
        "cancelled",
    },
    "running": {
        "completed",
        "failed",
        "cancelled",
    },
    "completed": set(),
    "failed": set(),
    "cancelled": set(),
}

ALLOWED_FINDING_SEVERITIES = {
    "info",
    "low",
    "medium",
    "high",
    "critical",
}

ALLOWED_FINDING_STATUSES = {
    "open",
    "acknowledged",
    "resolved",
    "ignored",
    "closed",
}

ALLOWED_RECOMMENDATION_PRIORITIES = {
    "info",
    "low",
    "medium",
    "high",
    "critical",
}

ALLOWED_RECOMMENDATION_STATUSES = {
    "open",
    "in_progress",
    "implemented",
    "dismissed",
    "rejected",
}


def create_website(
    db: Session,
    name: str,
    url: str,
) -> Website:

    website = Website(
        name=name,
        url=url,
    )

    db.add(website)
    db.commit()
    db.refresh(website)

    return website


def create_scan(
    db: Session,
    website_id: int,
) -> Scan:

    website = db.get(
        Website,
        website_id,
    )

    if website is None:
        raise ValueError(
            "Website not found"
        )

    scan = Scan(
        website_id=website_id,
        status="queued",
    )

    db.add(scan)
    db.commit()
    db.refresh(scan)

    return scan


def update_scan_status(
    db: Session,
    scan: Scan,
    new_status: str,
    error_message: str | None = None,
) -> Scan:

    if new_status not in ALLOWED_STATES:
        raise ValueError(
            "Invalid scan status"
        )

    allowed = ALLOWED_TRANSITIONS.get(
        scan.status,
        set(),
    )

    if new_status not in allowed:
        raise ValueError(
            f"Invalid transition: "
            f"{scan.status} -> {new_status}"
        )

    now = datetime.utcnow()

    if new_status == "running":
        scan.started_at = now

    if new_status in {
        "completed",
        "failed",
        "cancelled",
    }:
        scan.completed_at = now

    if new_status == "failed":
        scan.error_message = error_message

    scan.status = new_status

    db.commit()
    db.refresh(scan)

    return scan


def run_scan(
    db: Session,
    scan: Scan,
) -> object:
    website = db.get(
        Website,
        scan.website_id,
    )

    if website is None:
        raise ValueError(
            "Website not found"
        )

    update_scan_status(
        db,
        scan,
        "running",
    )

    try:
        hostname = urlparse(
            website.url
        ).hostname

        allowed_domains = []

        if hostname:
            allowed_domains.append(
                hostname
            )

        config = CrawlerConfig(
            max_pages=50,
            max_depth=3,
            allowed_domains=allowed_domains,
            respect_robots_txt=True,
        )

        crawler = Crawler(config)

        result = crawler.crawl(
            website.url
        )

        scan.pages_crawled = result.pages_crawled
        scan.pages_failed = result.pages_failed
        scan.pages_skipped = result.pages_skipped

        pages = getattr(result, "pages", [])
        if isinstance(pages, (list, tuple)):
            for page in pages:
                page_result = PageResult(
                    scan_id=scan.id,
                    url=page.url,
                    final_url=getattr(page, "final_url", None),
                    status_code=page.status_code,
                    content_type=page.content_type,
                    content=getattr(page, "content", None),
                    depth=page.depth,
                    parent_url=getattr(page, "parent_url", None),
                    error=page.error,
                    robots_txt_allowed=getattr(page, "robots_txt_allowed", True),
                )
                db.add(page_result)

        db.commit()
        db.refresh(scan)

        # Trigger Task 4 page extraction pipeline for crawled pages
        try:
            from .page_extractor import extract_scan_pages
            extract_scan_pages(db, scan.id)
        except Exception:
            # Error isolation: ensure extraction issue does not fail a successful crawl
            pass

        update_scan_status(
            db,
            scan,
            "completed",
        )

        return result

    except Exception as exc:
        update_scan_status(
            db,
            scan,
            "failed",
            str(exc),
        )

        raise


def get_scan_pages(
    db: Session,
    scan_id: int,
) -> list[PageResult]:
    scan = db.get(
        Scan,
        scan_id,
    )

    if scan is None:
        raise ValueError(
            "Scan not found"
        )

    return (
        db.query(PageResult)
        .filter(PageResult.scan_id == scan_id)
        .order_by(PageResult.id)
        .all()
    )


def get_page_result(
    db: Session,
    page_result_id: int,
) -> PageResult:
    page_result = db.get(
        PageResult,
        page_result_id,
    )

    if page_result is None:
        raise ValueError(
            "Page not found"
        )

    return page_result


def get_page_extraction(
    db: Session,
    page_result_id: int,
) -> PageExtraction | None:
    page_result = get_page_result(
        db,
        page_result_id,
    )

    return page_result.extraction


def get_page_intelligence(
    db: Session,
    page_result_id: int,
) -> dict:
    page_result = get_page_result(
        db,
        page_result_id,
    )
    extraction = page_result.extraction

    return {
        "page_result_id": page_result.id,
        "scan_id": page_result.scan_id,
        "url": page_result.url,
        "final_url": page_result.final_url,
        "status_code": page_result.status_code,
        "content_type": page_result.content_type,
        "created_at": page_result.created_at,
        "extraction": extraction,
        "meta_descriptions": extraction.meta_descriptions if extraction else [],
        "headings": extraction.headings if extraction else [],
        "canonicals": extraction.canonicals if extraction else [],
        "robots": extraction.robots if extraction else None,
        "social_metadata": extraction.social_metadata if extraction else [],
        "structured_data": extraction.structured_data if extraction else [],
        "microdata": extraction.microdata if extraction else [],
        "breadcrumbs": extraction.breadcrumbs if extraction else [],
        "images": extraction.images if extraction else [],
        "links": extraction.links if extraction else [],
        "language": extraction.language if extraction else None,
        "hreflang": extraction.hreflang if extraction else [],
        "indexability_evidence": extraction.indexability_evidence if extraction else None,
    }


def get_page_metadata(
    db: Session,
    page_result_id: int,
) -> dict:
    page_result = get_page_result(
        db,
        page_result_id,
    )
    extraction = page_result.extraction

    if extraction is None:
        raise ValueError(
            "Page extraction not found"
        )

    return {
        "page_result_id": page_result.id,
        "page_extraction_id": extraction.id,
        "detected_language": extraction.detected_language,
        "title_present": extraction.title_present,
        "title_text": extraction.title_text,
        "title_length": extraction.title_length,
        "title_word_count": extraction.title_word_count,
        "title_empty": extraction.title_empty,
        "title_duplicate": extraction.title_duplicate,
        "title_too_short": extraction.title_too_short,
        "title_too_long": extraction.title_too_long,
        "meta_descriptions": extraction.meta_descriptions,
        "social_metadata": extraction.social_metadata,
        "language": extraction.language,
        "hreflang": extraction.hreflang,
        "canonicals": extraction.canonicals,
        "robots": extraction.robots,
    }


def get_page_headings(
    db: Session,
    page_result_id: int,
) -> list[PageHeading]:
    page_result = get_page_result(
        db,
        page_result_id,
    )
    extraction = page_result.extraction

    if extraction is None:
        raise ValueError(
            "Page extraction not found"
        )

    return extraction.headings


def get_page_structured_data(
    db: Session,
    page_result_id: int,
) -> list[PageStructuredData]:
    page_result = get_page_result(
        db,
        page_result_id,
    )
    extraction = page_result.extraction

    if extraction is None:
        raise ValueError(
            "Page extraction not found"
        )

    return extraction.structured_data


def get_page_links(
    db: Session,
    page_result_id: int,
) -> list[PageLink]:
    page_result = get_page_result(
        db,
        page_result_id,
    )
    extraction = page_result.extraction

    if extraction is None:
        raise ValueError(
            "Page extraction not found"
        )

    return extraction.links


def get_page_images(
    db: Session,
    page_result_id: int,
) -> list[PageImage]:
    page_result = get_page_result(
        db,
        page_result_id,
    )
    extraction = page_result.extraction

    if extraction is None:
        raise ValueError(
            "Page extraction not found"
        )

    return extraction.images


def get_page_indexability(
    db: Session,
    page_result_id: int,
) -> PageIndexabilityEvidence | None:
    page_result = get_page_result(
        db,
        page_result_id,
    )
    extraction = page_result.extraction

    if extraction is None:
        raise ValueError(
            "Page extraction not found"
        )

    return extraction.indexability_evidence


def get_scan_page_intelligence(
    db: Session,
    scan_id: int,
) -> list[dict]:
    scan = db.get(
        Scan,
        scan_id,
    )

    if scan is None:
        raise ValueError(
            "Scan not found"
        )

    pages = (
        db.query(PageResult)
        .filter(PageResult.scan_id == scan_id)
        .order_by(PageResult.id)
        .all()
    )

    results = []
    for page in pages:
        extraction = page.extraction
        results.append({
            "page_result_id": page.id,
            "scan_id": page.scan_id,
            "url": page.url,
            "final_url": page.final_url,
            "status_code": page.status_code,
            "content_type": page.content_type,
            "created_at": page.created_at,
            "extraction": extraction,
            "meta_descriptions": extraction.meta_descriptions if extraction else [],
            "headings": extraction.headings if extraction else [],
            "canonicals": extraction.canonicals if extraction else [],
            "robots": extraction.robots if extraction else None,
            "social_metadata": extraction.social_metadata if extraction else [],
            "structured_data": extraction.structured_data if extraction else [],
            "microdata": extraction.microdata if extraction else [],
            "breadcrumbs": extraction.breadcrumbs if extraction else [],
            "images": extraction.images if extraction else [],
            "links": extraction.links if extraction else [],
            "language": extraction.language if extraction else None,
            "hreflang": extraction.hreflang if extraction else [],
            "indexability_evidence": extraction.indexability_evidence if extraction else None,
        })

    return results


def create_finding(
    db: Session,
    scan_id: int,
    finding_data: FindingCreate | dict,
) -> Finding:
    scan = db.get(
        Scan,
        scan_id,
    )
    if scan is None:
        raise ValueError("Scan not found")

    if isinstance(finding_data, dict):
        page_id = finding_data.get("page_id")
        finding_type = finding_data.get("finding_type") or finding_data.get("type")
        category = finding_data.get("category", "seo")
        title = finding_data.get("title")
        description = finding_data.get("description")
        severity = finding_data.get("severity", "medium")
        status = finding_data.get("status", "open")
        evidence = finding_data.get("evidence")
    else:
        page_id = finding_data.page_id
        finding_type = finding_data.finding_type
        category = finding_data.category
        title = finding_data.title
        description = finding_data.description
        severity = finding_data.severity
        status = finding_data.status
        evidence = finding_data.evidence

    if page_id is not None:
        page = db.get(
            PageResult,
            page_id,
        )
        if page is None:
            raise ValueError("Page not found")
        if page.scan_id != scan_id:
            raise ValueError("Page does not belong to the specified scan")

    if not severity or str(severity).lower() not in ALLOWED_FINDING_SEVERITIES:
        raise ValueError(
            f"Invalid severity: '{severity}'. Allowed values: {sorted(ALLOWED_FINDING_SEVERITIES)}"
        )
    severity = str(severity).lower()

    if not status or str(status).lower() not in ALLOWED_FINDING_STATUSES:
        raise ValueError(
            f"Invalid status: '{status}'. Allowed values: {sorted(ALLOWED_FINDING_STATUSES)}"
        )
    status = str(status).lower()

    if not finding_type or not str(finding_type).strip():
        raise ValueError("Finding type must not be empty")

    if not title or not str(title).strip():
        raise ValueError("Title must not be empty")

    if not description or not str(description).strip():
        raise ValueError("Description must not be empty")

    finding = Finding(
        website_id=scan.website_id,
        scan_id=scan_id,
        page_id=page_id,
        finding_type=str(finding_type).strip(),
        category=str(category).strip() if category else "seo",
        title=str(title).strip(),
        description=str(description).strip(),
        severity=severity,
        status=status,
        evidence=evidence,
    )

    db.add(finding)
    db.commit()
    db.refresh(finding)

    return finding


def get_scan_findings(
    db: Session,
    scan_id: int,
) -> list[Finding]:
    scan = db.get(
        Scan,
        scan_id,
    )
    if scan is None:
        raise ValueError("Scan not found")

    return (
        db.query(Finding)
        .filter(Finding.scan_id == scan_id)
        .order_by(Finding.id)
        .all()
    )


def get_page_findings(
    db: Session,
    page_result_id: int,
) -> list[Finding]:
    page = db.get(
        PageResult,
        page_result_id,
    )
    if page is None:
        raise ValueError("Page not found")

    return (
        db.query(Finding)
        .filter(Finding.page_id == page_result_id)
        .order_by(Finding.id)
        .all()
    )


def get_finding(
    db: Session,
    finding_id: int,
) -> Finding:
    finding = db.get(
        Finding,
        finding_id,
    )
    if finding is None:
        raise ValueError("Finding not found")

    return finding


def get_website_findings(
    db: Session,
    website_id: int,
) -> list[Finding]:
    website = db.get(
        Website,
        website_id,
    )
    if website is None:
        raise ValueError("Website not found")

    return (
        db.query(Finding)
        .filter(Finding.website_id == website_id)
        .order_by(Finding.id)
        .all()
    )


def create_recommendation(
    db: Session,
    finding_id: int,
    rec_data: RecommendationCreate | dict,
) -> Recommendation:
    finding = db.get(
        Finding,
        finding_id,
    )
    if finding is None:
        raise ValueError("Finding not found")

    if isinstance(rec_data, dict):
        title = rec_data.get("title")
        description = rec_data.get("description")
        priority = rec_data.get("priority", "medium")
        status = rec_data.get("status", "open")
        impact = rec_data.get("impact")
        action_type = rec_data.get("action_type")
        payload = rec_data.get("payload")
    else:
        title = rec_data.title
        description = rec_data.description
        priority = rec_data.priority
        status = rec_data.status
        impact = rec_data.impact
        action_type = rec_data.action_type
        payload = rec_data.payload

    if not priority or str(priority).lower() not in ALLOWED_RECOMMENDATION_PRIORITIES:
        raise ValueError(
            f"Invalid priority: '{priority}'. Allowed values: {sorted(ALLOWED_RECOMMENDATION_PRIORITIES)}"
        )
    priority = str(priority).lower()

    if not status or str(status).lower() not in ALLOWED_RECOMMENDATION_STATUSES:
        raise ValueError(
            f"Invalid status: '{status}'. Allowed values: {sorted(ALLOWED_RECOMMENDATION_STATUSES)}"
        )
    status = str(status).lower()

    if not title or not str(title).strip():
        raise ValueError("Title must not be empty")

    if not description or not str(description).strip():
        raise ValueError("Description must not be empty")

    recommendation = Recommendation(
        finding_id=finding_id,
        title=str(title).strip(),
        description=str(description).strip(),
        priority=priority,
        status=status,
        impact=str(impact).strip() if impact else None,
        action_type=str(action_type).strip() if action_type else None,
        payload=payload,
    )

    db.add(recommendation)
    db.commit()
    db.refresh(recommendation)

    return recommendation


def get_recommendation(
    db: Session,
    recommendation_id: int,
) -> Recommendation:
    rec = db.get(
        Recommendation,
        recommendation_id,
    )
    if rec is None:
        raise ValueError("Recommendation not found")

    return rec


def get_finding_recommendations(
    db: Session,
    finding_id: int,
) -> list[Recommendation]:
    finding = db.get(
        Finding,
        finding_id,
    )
    if finding is None:
        raise ValueError("Finding not found")

    return (
        db.query(Recommendation)
        .filter(Recommendation.finding_id == finding_id)
        .order_by(Recommendation.id)
        .all()
    )


def get_website_recommendations(
    db: Session,
    website_id: int,
) -> list[Recommendation]:
    website = db.get(
        Website,
        website_id,
    )
    if website is None:
        raise ValueError("Website not found")

    return (
        db.query(Recommendation)
        .join(Finding, Recommendation.finding_id == Finding.id)
        .filter(Finding.website_id == website_id)
        .order_by(Recommendation.id)
        .all()
    )


def get_scan_recommendations(
    db: Session,
    scan_id: int,
) -> list[Recommendation]:
    scan = db.get(
        Scan,
        scan_id,
    )
    if scan is None:
        raise ValueError("Scan not found")

    return (
        db.query(Recommendation)
        .join(Finding, Recommendation.finding_id == Finding.id)
        .filter(Finding.scan_id == scan_id)
        .order_by(Recommendation.id)
        .all()
    )


def create_question_set(
    db: Session,
    website_id: int,
    qs_data: QuestionSetCreate | dict,
) -> QuestionSet:
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")

    if isinstance(qs_data, dict):
        name = qs_data.get("name")
        version = qs_data.get("version", "1.0")
        description = qs_data.get("description")
    else:
        name = qs_data.name
        version = qs_data.version
        description = qs_data.description

    if not name or not str(name).strip():
        raise ValueError("Question set name must not be empty")

    qs = QuestionSet(
        website_id=website_id,
        name=str(name).strip(),
        version=str(version).strip() if version else "1.0",
        description=str(description).strip() if description else None,
    )
    db.add(qs)
    db.commit()
    db.refresh(qs)
    return qs


def get_question_set(
    db: Session,
    question_set_id: int,
) -> QuestionSet:
    qs = db.get(QuestionSet, question_set_id)
    if qs is None:
        raise ValueError("Question set not found")
    return qs


def get_website_question_sets(
    db: Session,
    website_id: int,
) -> list[QuestionSet]:
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")
    return (
        db.query(QuestionSet)
        .filter(QuestionSet.website_id == website_id)
        .order_by(QuestionSet.id)
        .all()
    )


def create_question(
    db: Session,
    question_set_id: int,
    q_data: QuestionCreate | dict,
) -> Question:
    qs = db.get(QuestionSet, question_set_id)
    if qs is None:
        raise ValueError("Question set not found")

    if isinstance(q_data, dict):
        text = q_data.get("text")
        intent = q_data.get("intent")
        topic = q_data.get("topic")
    else:
        text = q_data.text
        intent = q_data.intent
        topic = q_data.topic

    if not text or not str(text).strip():
        raise ValueError("Question text must not be empty")

    question = Question(
        question_set_id=question_set_id,
        text=str(text).strip(),
        intent=str(intent).strip() if intent else None,
        topic=str(topic).strip() if topic else None,
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


def get_question(
    db: Session,
    question_id: int,
) -> Question:
    q = db.get(Question, question_id)
    if q is None:
        raise ValueError("Question not found")
    return q


def get_question_set_questions(
    db: Session,
    question_set_id: int,
) -> list[Question]:
    qs = db.get(QuestionSet, question_set_id)
    if qs is None:
        raise ValueError("Question set not found")
    return (
        db.query(Question)
        .filter(Question.question_set_id == question_set_id)
        .order_by(Question.id)
        .all()
    )


def create_ai_run(
    db: Session,
    website_id: int,
    run_data: AIRunCreate | dict,
) -> AIRun:
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")

    if isinstance(run_data, dict):
        question_id = run_data.get("question_id")
        provider = run_data.get("provider")
        model = run_data.get("model")
        environment = run_data.get("environment", "production")
    else:
        question_id = run_data.question_id
        provider = run_data.provider
        model = run_data.model
        environment = run_data.environment

    if question_id is None:
        raise ValueError("question_id is required")

    question = db.get(Question, question_id)
    if question is None:
        raise ValueError("Question not found")

    if question.question_set.website_id != website_id:
        raise ValueError("Question does not belong to the specified website")

    if not provider or not str(provider).strip():
        raise ValueError("Provider must not be empty")

    if not model or not str(model).strip():
        raise ValueError("Model must not be empty")

    if not environment or not str(environment).strip():
        raise ValueError("Environment must not be empty")

    run = AIRun(
        website_id=website_id,
        question_id=question_id,
        provider=str(provider).strip(),
        model=str(model).strip(),
        environment=str(environment).strip(),
        status="queued",
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def get_ai_run(
    db: Session,
    run_id: int,
) -> AIRun:
    run = db.get(AIRun, run_id)
    if run is None:
        raise ValueError("AI run not found")
    return run


def get_website_ai_runs(
    db: Session,
    website_id: int,
) -> list[AIRun]:
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")
    return (
        db.query(AIRun)
        .filter(AIRun.website_id == website_id)
        .order_by(AIRun.id)
        .all()
    )


def update_ai_run_status(
    db: Session,
    run: AIRun,
    new_status: str,
    error_message: str | None = None,
) -> AIRun:
    if new_status not in ALLOWED_STATES:
        raise ValueError(
            f"Invalid status: {new_status}"
        )

    allowed = ALLOWED_TRANSITIONS.get(
        run.status,
        set(),
    )

    if new_status not in allowed:
        raise ValueError(
            f"Invalid state transition from '{run.status}' to '{new_status}'"
        )

    now = datetime.utcnow()
    run.status = new_status

    if new_status == "running":
        run.started_at = now

    elif new_status in {
        "completed",
        "failed",
        "cancelled",
    }:
        run.completed_at = now

    if error_message is not None:
        run.error_message = error_message

    db.commit()
    db.refresh(run)
    return run


def create_ai_result(
    db: Session,
    run_id: int,
    result_data: AIResultCreate | dict,
) -> AIResult:
    run = db.get(AIRun, run_id)
    if run is None:
        raise ValueError("AI run not found")

    if run.result is not None:
        raise ValueError("AI result already exists for this run")

    if isinstance(result_data, dict):
        answer = result_data.get("answer")
        mentions_brand = result_data.get("mentions_brand", False)
        mentions_competitors = result_data.get("mentions_competitors")
        metrics = result_data.get("metrics")
        citations_data = result_data.get("citations", [])
    else:
        answer = result_data.answer
        mentions_brand = result_data.mentions_brand
        mentions_competitors = result_data.mentions_competitors
        metrics = result_data.metrics
        citations_data = result_data.citations

    if not answer or not str(answer).strip():
        raise ValueError("Answer must not be empty")

    result = AIResult(
        ai_run_id=run_id,
        answer=str(answer).strip(),
        mentions_brand=bool(mentions_brand),
        mentions_competitors=mentions_competitors,
        metrics=metrics,
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    for item in citations_data:
        if isinstance(item, dict):
            c_url = item.get("url")
            c_domain = item.get("domain")
            c_title = item.get("title")
            c_snippet = item.get("snippet")
            c_pos = item.get("position", 1)
        else:
            c_url = item.url
            c_domain = item.domain
            c_title = item.title
            c_snippet = item.snippet
            c_pos = item.position

        if c_url and str(c_url).strip():
            citation = Citation(
                ai_result_id=result.id,
                url=str(c_url).strip(),
                domain=str(c_domain).strip() if c_domain else None,
                title=str(c_title).strip() if c_title else None,
                snippet=str(c_snippet).strip() if c_snippet else None,
                position=int(c_pos),
            )
            db.add(citation)

    db.commit()
    db.refresh(result)
    return result


def get_ai_run_result(
    db: Session,
    run_id: int,
) -> AIResult:
    run = db.get(AIRun, run_id)
    if run is None:
        raise ValueError("AI run not found")

    if run.result is None:
        raise ValueError("AI result not found")

    return run.result


def get_ai_result_citations(
    db: Session,
    result_id: int,
) -> list[Citation]:
    result = db.get(AIResult, result_id)
    if result is None:
        raise ValueError("AI result not found")

    return (
        db.query(Citation)
        .filter(Citation.ai_result_id == result_id)
        .order_by(Citation.position, Citation.id)
        .all()
    )


def create_entity(
    db: Session,
    website_id: int,
    entity_data: EntityCreate | dict,
) -> Entity:
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")

    if isinstance(entity_data, dict):
        name = entity_data.get("name")
        entity_type = entity_data.get("entity_type")
        page_id = entity_data.get("page_id")
        scan_id = entity_data.get("scan_id")
        description = entity_data.get("description")
        confidence = entity_data.get("confidence", 1.0)
        same_as = entity_data.get("same_as")
        properties = entity_data.get("properties")
        relationships = entity_data.get("relationships")
        evidence = entity_data.get("evidence")
    else:
        name = entity_data.name
        entity_type = entity_data.entity_type
        page_id = entity_data.page_id
        scan_id = entity_data.scan_id
        description = entity_data.description
        confidence = entity_data.confidence
        same_as = entity_data.same_as
        properties = entity_data.properties
        relationships = entity_data.relationships
        evidence = entity_data.evidence

    if not name or not str(name).strip():
        raise ValueError("Entity name must not be empty")

    if not entity_type or not str(entity_type).strip():
        raise ValueError("Entity type must not be empty")

    try:
        conf_val = float(confidence)
        if conf_val < 0.0 or conf_val > 1.0:
            raise ValueError("Confidence must be between 0.0 and 1.0")
    except (TypeError, ValueError) as exc:
        raise ValueError("Confidence must be between 0.0 and 1.0") from exc

    if scan_id is not None:
        scan = db.get(Scan, scan_id)
        if scan is None:
            raise ValueError("Scan not found")
        if scan.website_id != website_id:
            raise ValueError("Scan does not belong to the specified website")

    if page_id is not None:
        page = db.get(PageResult, page_id)
        if page is None:
            raise ValueError("Page not found")
        if page.scan.website_id != website_id:
            raise ValueError("Page does not belong to the specified website")
        if scan_id is not None and page.scan_id != scan_id:
            raise ValueError("Page does not belong to the specified scan")

    entity = Entity(
        website_id=website_id,
        page_id=page_id,
        scan_id=scan_id,
        name=str(name).strip(),
        entity_type=str(entity_type).strip().lower(),
        description=str(description).strip() if description else None,
        confidence=conf_val,
        same_as=same_as,
        properties=properties,
        relationships=relationships,
        evidence=evidence,
    )
    db.add(entity)
    db.commit()
    db.refresh(entity)
    return entity


def get_entity(
    db: Session,
    entity_id: int,
) -> Entity:
    entity = db.get(Entity, entity_id)
    if entity is None:
        raise ValueError("Entity not found")
    return entity


def get_website_entities(
    db: Session,
    website_id: int,
    entity_type: str | None = None,
) -> list[Entity]:
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")

    query = db.query(Entity).filter(Entity.website_id == website_id)
    if entity_type and str(entity_type).strip():
        query = query.filter(Entity.entity_type == str(entity_type).strip().lower())

    return query.order_by(Entity.id).all()


def get_page_entities(
    db: Session,
    page_id: int,
) -> list[Entity]:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    return (
        db.query(Entity)
        .filter(Entity.page_id == page_id)
        .order_by(Entity.id)
        .all()
    )


def get_scan_entities(
    db: Session,
    scan_id: int,
) -> list[Entity]:
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError("Scan not found")

    return (
        db.query(Entity)
        .filter(Entity.scan_id == scan_id)
        .order_by(Entity.id)
        .all()
    )


def update_entity(
    db: Session,
    entity_id: int,
    update_data: EntityUpdate | dict,
) -> Entity:
    entity = db.get(Entity, entity_id)
    if entity is None:
        raise ValueError("Entity not found")

    if isinstance(update_data, dict):
        name = update_data.get("name")
        entity_type = update_data.get("entity_type")
        page_id = update_data.get("page_id")
        scan_id = update_data.get("scan_id")
        description = update_data.get("description")
        confidence = update_data.get("confidence")
        same_as = update_data.get("same_as")
        properties = update_data.get("properties")
        relationships = update_data.get("relationships")
        evidence = update_data.get("evidence")
    else:
        name = update_data.name
        entity_type = update_data.entity_type
        page_id = update_data.page_id
        scan_id = update_data.scan_id
        description = update_data.description
        confidence = update_data.confidence
        same_as = update_data.same_as
        properties = update_data.properties
        relationships = update_data.relationships
        evidence = update_data.evidence

    if name is not None:
        if not str(name).strip():
            raise ValueError("Entity name must not be empty")
        entity.name = str(name).strip()

    if entity_type is not None:
        if not str(entity_type).strip():
            raise ValueError("Entity type must not be empty")
        entity.entity_type = str(entity_type).strip().lower()

    if confidence is not None:
        try:
            conf_val = float(confidence)
            if conf_val < 0.0 or conf_val > 1.0:
                raise ValueError("Confidence must be between 0.0 and 1.0")
            entity.confidence = conf_val
        except (TypeError, ValueError) as exc:
            raise ValueError("Confidence must be between 0.0 and 1.0") from exc

    if scan_id is not None:
        scan = db.get(Scan, scan_id)
        if scan is None:
            raise ValueError("Scan not found")
        if scan.website_id != entity.website_id:
            raise ValueError("Scan does not belong to the specified website")
        entity.scan_id = scan_id

    if page_id is not None:
        page = db.get(PageResult, page_id)
        if page is None:
            raise ValueError("Page not found")
        if page.scan.website_id != entity.website_id:
            raise ValueError("Page does not belong to the specified website")
        entity.page_id = page_id

    if description is not None:
        entity.description = str(description).strip() if description else None

    if same_as is not None:
        entity.same_as = same_as

    if properties is not None:
        entity.properties = properties

    if relationships is not None:
        entity.relationships = relationships

    if evidence is not None:
        entity.evidence = evidence

    entity.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(entity)
    return entity


def delete_entity(
    db: Session,
    entity_id: int,
) -> None:
    entity = db.get(Entity, entity_id)
    if entity is None:
        raise ValueError("Entity not found")

    db.delete(entity)
    db.commit()


def analyze_page_content_structure(
    db: Session,
    page_id: int,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    title = None
    fallback_headings = None
    if page.extraction:
        title = page.extraction.title_text
        if page.extraction.headings:
            fallback_headings = page.extraction.headings

    raw_html = page.content or ""
    evidence = analyze_content_structure(
        raw_html,
        title=title,
        headings_fallback=fallback_headings,
    )
    return evidence.to_dict()


def _get_page_text_and_headings(page: PageResult) -> tuple[str, str | None, list[Any]]:
    title = None
    headings = []
    if page.extraction:
        title = page.extraction.title_text
        if page.extraction.headings:
            headings = [{"level": h.level, "text": h.text} for h in page.extraction.headings]

    raw_html = page.content or ""
    # Strip script/style and HTML tags to get readable text
    clean_html = re.sub(r"(?is)<(script|style|svg|noscript).*?>.*?</\1>", " ", raw_html)
    text_content = re.sub(r"<[^>]+>", " ", clean_html)
    text_content = re.sub(r"\s+", " ", text_content).strip()

    # If headings weren't populated in extraction, parse them from raw_html if any
    if not headings and raw_html:
        structure = analyze_content_structure(raw_html)
        headings = [
            {"level": s["heading_level"], "text": s["heading_text"]}
            for s in structure.sections
            if s.get("heading_level") is not None and s.get("heading_text")
        ]


    return text_content, title, headings


def analyze_page_topics(
    db: Session,
    page_id: int,
    persist_findings: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    text_content, title, headings = _get_page_text_and_headings(page)
    evidence = analyze_topic_semantics(
        text_content=text_content,
        title=title,
        headings=headings,
    )

    if persist_findings and evidence.findings:
        scan = db.get(Scan, page.scan_id)
        website_id = scan.website_id if scan else 1
        for f in evidence.findings:
            create_finding(
                db,
                page.scan_id,
                FindingCreate(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    type=f.get("type", "topic_analysis"),
                    severity=f.get("severity", "info"),
                    title=f.get("title", "Topic Finding"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence"),
                    payload=f,
                ),
            )

    return evidence.to_dict()


def analyze_page_entities(
    db: Session,
    page_id: int,
    persist_entities: bool = False,
    persist_findings: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    text_content, title, headings = _get_page_text_and_headings(page)

    structured_data_blocks = []
    microdata_items = []
    if page.extraction:
        if page.extraction.structured_data:
            structured_data_blocks = page.extraction.structured_data
        if page.extraction.microdata:
            microdata_items = page.extraction.microdata

    evidence = analyze_entities(
        text_content=text_content,
        title=title,
        headings=headings,
        structured_data_blocks=structured_data_blocks,
        microdata_items=microdata_items,
    )

    scan = db.get(Scan, page.scan_id)
    website_id = scan.website_id if scan else 1

    if persist_entities and evidence.entities:
        for ent in evidence.entities:
            existing = (
                db.query(Entity)
                .filter(
                    Entity.website_id == website_id,
                    Entity.page_id == page.id,
                    Entity.name == ent["name"],
                )
                .first()
            )
            if not existing:
                create_entity(
                    db,
                    website_id,
                    EntityCreate(
                        website_id=website_id,
                        scan_id=page.scan_id,
                        page_id=page.id,
                        name=ent["name"],
                        entity_type=ent["entity_type"],
                        description=ent.get("description"),
                        confidence=ent.get("confidence", 0.8),
                        same_as=ent.get("same_as"),
                        properties={"sources": ent.get("sources", [])},
                        evidence=ent,
                    ),
                )

    if persist_findings and evidence.findings:
        for f in evidence.findings:
            create_finding(
                db,
                page.scan_id,
                FindingCreate(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    type=f.get("type", "entity_analysis"),
                    severity=f.get("severity", "info"),
                    title=f.get("title", "Entity Finding"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence"),
                    payload=f,
                ),
            )

    return evidence.to_dict()


def analyze_page_questions(
    db: Session,
    page_id: int,
    persist_findings: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    text_content, title, headings = _get_page_text_and_headings(page)

    structured_data_blocks = []
    if page.extraction and page.extraction.structured_data:
        structured_data_blocks = page.extraction.structured_data

    sections = None
    if page.content:
        struct = analyze_content_structure(page.content)
        sections = struct.sections

    evidence = analyze_questions(
        text_content=text_content,
        headings=headings,
        structured_data_blocks=structured_data_blocks,
        sections=sections,
    )

    if persist_findings and evidence.findings:
        scan = db.get(Scan, page.scan_id)
        website_id = scan.website_id if scan else 1
        for f in evidence.findings:
            create_finding(
                db,
                page.scan_id,
                FindingCreate(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    type=f.get("type", "question_analysis"),
                    severity=f.get("severity", "info"),
                    title=f.get("title", "Question Finding"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence"),
                    payload=f,
                ),
            )

    return evidence.to_dict()


def analyze_page_answers(
    db: Session,
    page_id: int,
    persist_findings: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    text_content, title, headings = _get_page_text_and_headings(page)

    structured_data_blocks = []
    if page.extraction and page.extraction.structured_data:
        structured_data_blocks = page.extraction.structured_data

    sections = None
    if page.content:
        struct = analyze_content_structure(page.content)
        sections = struct.sections

    evidence = analyze_answers(
        headings=headings,
        sections=sections,
        structured_data_blocks=structured_data_blocks,
        text_content=text_content,
    )

    if persist_findings and evidence.findings:
        scan = db.get(Scan, page.scan_id)
        website_id = scan.website_id if scan else 1
        for f in evidence.findings:
            create_finding(
                db,
                page.scan_id,
                FindingCreate(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    type=f.get("type", "answer_analysis"),
                    severity=f.get("severity", "info"),
                    title=f.get("title", "Answer Finding"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence"),
                    payload=f,
                ),
            )

    return evidence.to_dict()


def analyze_page_readiness(
    db: Session,
    page_id: int,
    persist_findings: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    # Run component analyses
    struct_evidence = None
    if page.content:
        struct_evidence = analyze_content_structure(page.content)

    topic_evidence = analyze_page_topics(db, page_id)
    entity_evidence = analyze_page_entities(db, page_id)
    q_evidence = analyze_page_questions(db, page_id)
    a_evidence = analyze_page_answers(db, page_id)

    readiness = analyze_readiness(
        content_structure=struct_evidence,
        topic_semantics=topic_evidence,
        entity_evidence=entity_evidence,
        question_evidence=q_evidence,
        answer_evidence=a_evidence,
    )

    if persist_findings and readiness.findings:
        scan = db.get(Scan, page.scan_id)
        website_id = scan.website_id if scan else 1
        for f in readiness.findings:
            create_finding(
                db,
                page.scan_id,
                FindingCreate(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    type=f.get("type", "answer_readiness"),
                    severity=f.get("severity", "info"),
                    title=f.get("title", "Answer Readiness Finding"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence"),
                    payload=f,
                ),
            )

    return readiness.to_dict()


def analyze_page_content_gaps(
    db: Session,
    page_id: int,
    persist_findings: bool = False,
    persist_recommendations: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    struct_evidence = None
    if page.content:
        struct_evidence = analyze_content_structure(page.content)

    topic_evidence = analyze_page_topics(db, page_id)
    entity_evidence = analyze_page_entities(db, page_id)
    q_evidence = analyze_page_questions(db, page_id)
    a_evidence = analyze_page_answers(db, page_id)

    gap_evidence = analyze_content_gaps(
        content_structure=struct_evidence,
        topic_semantics=topic_evidence,
        entity_evidence=entity_evidence,
        question_evidence=q_evidence,
        answer_evidence=a_evidence,
    )

    scan = db.get(Scan, page.scan_id)
    website_id = scan.website_id if scan else 1

    if (persist_findings or persist_recommendations) and gap_evidence.findings:
        for f in gap_evidence.findings:
            finding = create_finding(
                db,
                page.scan_id,
                FindingCreate(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    type=f.get("type", "content_gap"),
                    severity=f.get("severity", "medium"),
                    title=f.get("title", "Content Gap Finding"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence"),
                    payload=f,
                ),
            )
            if persist_recommendations:
                # Priority mapping from severity
                sev = f.get("severity", "medium")
                pri = "high" if sev == "high" else ("medium" if sev == "medium" else "low")
                create_recommendation(
                    db,
                    finding.id,
                    RecommendationCreate(
                        title=f"Address {finding.title}",
                        description=finding.description,
                        priority=pri,
                        action_type="content_update",
                        payload={"gap_evidence": f.get("evidence")},
                    ),
                )

    return gap_evidence.to_dict()


def analyze_page_quality(
    db: Session,
    page_id: int,
    persist_findings: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    text_content, _, headings = _get_page_text_and_headings(page)

    links = []
    if page.extraction and page.extraction.links:
        links = page.extraction.links

    sections = None
    if page.content:
        struct = analyze_content_structure(page.content)
        sections = struct.sections

    evidence = analyze_quality(
        text_content=text_content,
        headings=headings,
        sections=sections,
        links=links,
    )

    if persist_findings and evidence.findings:
        scan = db.get(Scan, page.scan_id)
        website_id = scan.website_id if scan else 1
        for f in evidence.findings:
            create_finding(
                db,
                page.scan_id,
                FindingCreate(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    type=f.get("type", "quality_analysis"),
                    severity=f.get("severity", "info"),
                    title=f.get("title", "Quality Finding"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence"),
                    payload=f,
                ),
            )

    return evidence.to_dict()


def analyze_page_intent(
    db: Session,
    page_id: int,
    persist_findings: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    text_content, title, headings = _get_page_text_and_headings(page)

    # Get question metrics
    q_data = analyze_page_questions(db, page_id)
    q_count = q_data.get("question_count", 0)
    faq_schema = q_data.get("faq_schema_present", False)

    evidence = analyze_intent(
        text_content=text_content,
        title=title,
        headings=headings,
        question_count=q_count,
        faq_schema_present=faq_schema,
    )

    if persist_findings and evidence.findings:
        scan = db.get(Scan, page.scan_id)
        website_id = scan.website_id if scan else 1
        for f in evidence.findings:
            create_finding(
                db,
                page.scan_id,
                FindingCreate(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    type=f.get("type", "intent_analysis"),
                    severity=f.get("severity", "info"),
                    title=f.get("title", "Intent Finding"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence"),
                    payload=f,
                ),
            )

    return evidence.to_dict()


def analyze_page_semantic_coverage(
    db: Session,
    page_id: int,
    persist_findings: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    text_content, _, headings = _get_page_text_and_headings(page)

    struct_evidence = None
    if page.content:
        struct_evidence = analyze_content_structure(page.content)

    topic_evidence = analyze_page_topics(db, page_id)
    entity_evidence = analyze_page_entities(db, page_id)
    q_evidence = analyze_page_questions(db, page_id)
    a_evidence = analyze_page_answers(db, page_id)
    intent_evidence = analyze_page_intent(db, page_id)

    evidence = analyze_semantic_coverage(
        topic_evidence=topic_evidence,
        entity_evidence=entity_evidence,
        question_evidence=q_evidence,
        answer_evidence=a_evidence,
        intent_evidence=intent_evidence,
        content_structure=struct_evidence,
        headings=headings,
        text_content=text_content,
    )

    if persist_findings and evidence.findings:
        scan = db.get(Scan, page.scan_id)
        website_id = scan.website_id if scan else 1
        for f in evidence.findings:
            create_finding(
                db,
                page.scan_id,
                FindingCreate(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    type=f.get("type", "semantic_coverage"),
                    severity=f.get("severity", "info"),
                    title=f.get("title", "Semantic Coverage Finding"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence"),
                    payload=f,
                ),
            )

    return evidence.to_dict()


def analyze_page_content_intelligence(
    db: Session,
    page_id: int,
    persist_findings: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    text_content, title, headings = _get_page_text_and_headings(page)

    structured_data_blocks = []
    microdata_items = []
    links = []
    if page.extraction:
        if page.extraction.structured_data:
            structured_data_blocks = page.extraction.structured_data
        if page.extraction.microdata:
            microdata_items = page.extraction.microdata
        if page.extraction.links:
            links = page.extraction.links

    summary = analyze_content_intelligence(
        text_content=text_content,
        raw_html=page.content,
        title=title,
        headings=headings,
        structured_data_blocks=structured_data_blocks,
        microdata_items=microdata_items,
        links=links,
        page_id=page.id,
        url=page.url,
    )

    if persist_findings and summary.findings:
        scan = db.get(Scan, page.scan_id)
        website_id = scan.website_id if scan else 1
        for f in summary.findings:
            create_finding(
                db,
                page.scan_id,
                FindingCreate(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    type=f.get("type", "content_intelligence"),
                    severity=f.get("severity", "info"),
                    title=f.get("title", "Content Intelligence Finding"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence"),
                    payload=f,
                ),
            )

    return summary.to_dict()


def run_page_content_quality_checks(
    db: Session,
    page_id: int,
    persist_findings: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    text_content, title, headings = _get_page_text_and_headings(page)

    checks_result = run_content_quality_checks(
        raw_html=page.content,
        text_content=text_content,
        title=title,
        headings=headings,
    )

    if persist_findings and checks_result.findings:
        scan = db.get(Scan, page.scan_id)
        website_id = scan.website_id if scan else 1
        for f in checks_result.findings:
            create_finding(
                db,
                page.scan_id,
                FindingCreate(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    type=f.get("type", "content_quality_check"),
                    severity=f.get("severity", "high"),
                    title=f.get("title", "Quality Check Finding"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence"),
                    payload=f,
                ),
            )

    return checks_result.to_dict()


def analyze_scan_content_intelligence(
    db: Session,
    scan_id: int,
    persist_findings: bool = False,
) -> dict:
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError("Scan not found")

    pages = db.query(PageResult).filter(PageResult.scan_id == scan_id).all()
    analyzed_pages = []

    for p in pages:
        res = analyze_page_content_intelligence(db, p.id, persist_findings=persist_findings)
        analyzed_pages.append(res)

    total_pages = len(analyzed_pages)
    avg_score = 0.0
    optimal_count = 0
    needs_imp_count = 0
    deficient_count = 0

    if total_pages > 0:
        avg_score = round(sum(p["overall_content_score"] for p in analyzed_pages) / total_pages, 2)
        optimal_count = sum(1 for p in analyzed_pages if p["content_status"] == "optimal")
        needs_imp_count = sum(1 for p in analyzed_pages if p["content_status"] == "needs_improvement")
        deficient_count = sum(1 for p in analyzed_pages if p["content_status"] == "deficient")

    return {
        "scan_id": scan_id,
        "total_pages_analyzed": total_pages,
        "average_content_score": avg_score,
        "optimal_pages_count": optimal_count,
        "needs_improvement_pages_count": needs_imp_count,
        "deficient_pages_count": deficient_count,
        "pages": analyzed_pages,
    }


def run_full_page_content_pipeline(
    db: Session,
    page_id: int,
    persist_all: bool = False,
) -> dict:
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError("Page not found")

    quality_checks = run_page_content_quality_checks(db, page_id, persist_findings=persist_all)
    content_intel = analyze_page_content_intelligence(db, page_id, persist_findings=persist_all)

    persisted_count = 0
    if persist_all:
        persisted_count = len(quality_checks.get("findings", [])) + len(content_intel.get("findings", []))

    return {
        "page_id": page.id,
        "url": page.url,
        "content_intelligence": content_intel,
        "quality_checks": quality_checks,
        "findings_persisted_count": persisted_count,
    }