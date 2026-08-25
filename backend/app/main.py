from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .models import Scan
from .schemas import (
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
    ScanResponse,
    ScanStatusUpdate,
    WebsiteCreate,
    WebsiteResponse,
)
from .services import (
    create_scan,
    create_website,
    get_page_extraction,
    get_page_headings,
    get_page_images,
    get_page_indexability,
    get_page_intelligence,
    get_page_links,
    get_page_metadata,
    get_page_structured_data,
    get_scan_page_intelligence,
    get_scan_pages,
    run_scan,
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