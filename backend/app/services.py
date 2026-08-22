from datetime import datetime
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from crawler.config import CrawlerConfig
from crawler.crawler import Crawler

from .models import PageResult, Scan, Website


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