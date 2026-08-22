from datetime import datetime

from pydantic import BaseModel, ConfigDict, HttpUrl


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
    created_at: datetime