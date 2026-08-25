from datetime import datetime
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from crawler.config import CrawlerConfig
from crawler.crawler import Crawler

from .models import (
    PageExtraction,
    PageHeading,
    PageImage,
    PageIndexabilityEvidence,
    PageLink,
    PageResult,
    PageStructuredData,
    Scan,
    Website,
)
from .page_extractor import extract_page, extract_scan_pages


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