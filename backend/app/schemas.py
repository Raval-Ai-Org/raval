from datetime import datetime
from typing import Any

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


class PageExtractionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_result_id: int
    scan_id: int
    html_available: bool
    clean_text_available: bool
    word_count: int
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