from datetime import datetime

from sqlalchemy.orm import Session

from .models import Scan, Website


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