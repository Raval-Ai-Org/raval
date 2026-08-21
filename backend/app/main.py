from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .models import Scan
from .schemas import (
    ScanResponse,
    ScanStatusUpdate,
    WebsiteCreate,
    WebsiteResponse,
)
from .services import (
    create_scan,
    create_website,
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