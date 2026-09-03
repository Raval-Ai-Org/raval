from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Website(Base):
    __tablename__ = "websites"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    scans = relationship(
        "Scan",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    findings = relationship(
        "Finding",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    question_sets = relationship(
        "QuestionSet",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    ai_runs = relationship(
        "AIRun",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    entities = relationship(
        "Entity",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    opportunities = relationship(
        "Opportunity",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    fix_plans = relationship(
        "FixPlan",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    validations = relationship(
        "ValidationResult",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    monitoring_records = relationship(
        "MonitoringRecord",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    query_sets = relationship(
        "QuerySet",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    queries = relationship(
        "Query",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    ai_responses = relationship(
        "AIResponse",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    mentions = relationship(
        "AIMention",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    citations = relationship(
        "AICitation",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    visibility_observations = relationship(
        "AIVisibilityObservation",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    visibility_gaps = relationship(
        "AIVisibilityGap",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    visibility_snapshots = relationship(
        "AIVisibilitySnapshot",
        back_populates="website",
        cascade="all, delete-orphan",
    )

    monitoring_runs = relationship(
        "AIMonitoringRun",
        back_populates="website",
        cascade="all, delete-orphan",
    )










class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="queued",
        nullable=False,
    )

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    pages_crawled: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    pages_failed: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    pages_skipped: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    website = relationship(
        "Website",
        back_populates="scans",
    )

    page_results = relationship(
        "PageResult",
        back_populates="scan",
        cascade="all, delete-orphan",
    )

    page_extractions = relationship(
        "PageExtraction",
        back_populates="scan",
        cascade="all, delete-orphan",
    )

    findings = relationship(
        "Finding",
        back_populates="scan",
        cascade="all, delete-orphan",
    )

    entities = relationship(
        "Entity",
        back_populates="scan",
        cascade="all, delete-orphan",
    )

    opportunities = relationship(
        "Opportunity",
        back_populates="scan",
        cascade="all, delete-orphan",
    )

    fix_plans = relationship(
        "FixPlan",
        back_populates="scan",
        cascade="all, delete-orphan",
    )

    validations = relationship(
        "ValidationResult",
        back_populates="scan",
        cascade="all, delete-orphan",
    )

    monitoring_records = relationship(
        "MonitoringRecord",
        back_populates="scan",
        cascade="all, delete-orphan",
    )

    query_sets = relationship(
        "QuerySet",
        back_populates="scan",
        cascade="all, delete-orphan",
    )



class PageResult(Base):
    __tablename__ = "page_results"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    scan_id: Mapped[int] = mapped_column(
        ForeignKey("scans.id"),
        nullable=False,
    )

    url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
    )

    final_url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    status_code: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    content_type: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    content: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    depth: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    parent_url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    error: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    robots_txt_allowed: Mapped[bool | None] = mapped_column(
        nullable=True,
        default=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    scan = relationship(
        "Scan",
        back_populates="page_results",
    )

    extraction = relationship(
        "PageExtraction",
        back_populates="page_result",
        uselist=False,
        cascade="all, delete-orphan",
    )

    findings = relationship(
        "Finding",
        back_populates="page_result",
    )

    entities = relationship(
        "Entity",
        back_populates="page_result",
        cascade="all, delete-orphan",
    )

    opportunities = relationship(
        "Opportunity",
        back_populates="page_result",
        cascade="all, delete-orphan",
    )

    fix_plans = relationship(
        "FixPlan",
        back_populates="page_result",
        cascade="all, delete-orphan",
    )

    validations = relationship(
        "ValidationResult",
        back_populates="page_result",
        cascade="all, delete-orphan",
    )

    queries = relationship(
        "Query",
        back_populates="page_result",
    )

    citations = relationship(
        "AICitation",
        back_populates="page_result",
    )




class PageExtraction(Base):
    __tablename__ = "page_extractions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_result_id: Mapped[int] = mapped_column(
        ForeignKey("page_results.id"),
        nullable=False,
        unique=True,
    )

    scan_id: Mapped[int] = mapped_column(
        ForeignKey("scans.id"),
        nullable=False,
    )

    html_available: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    content_size_bytes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    clean_text_available: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    word_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    paragraph_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    main_content_candidate: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    main_content_confidence: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    detected_language: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    extraction_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="success",
    )

    extraction_error: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    extracted_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Title evidence
    title_present: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    title_text: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    title_length: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    title_word_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    title_empty: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    title_duplicate: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    title_too_short: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    title_too_long: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    title_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    # Meta description summary evidence
    meta_description_present: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    meta_description_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    # Heading hierarchy evidence
    h1_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    missing_h1: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    multiple_h1: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    heading_hierarchy_issue: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    heading_hierarchy_details: Mapped[list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    # Canonical summary evidence
    canonical_present: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    canonical_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    canonical_multiple: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    canonical_conflict: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    # Image summary evidence
    image_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    images_without_alt: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    page_result = relationship(
        "PageResult",
        back_populates="extraction",
    )

    scan = relationship(
        "Scan",
        back_populates="page_extractions",
    )

    meta_descriptions = relationship(
        "PageMetaDescription",
        back_populates="page_extraction",
        cascade="all, delete-orphan",
        order_by="PageMetaDescription.position",
    )

    headings = relationship(
        "PageHeading",
        back_populates="page_extraction",
        cascade="all, delete-orphan",
        order_by="PageHeading.position",
    )

    canonicals = relationship(
        "PageCanonical",
        back_populates="page_extraction",
        cascade="all, delete-orphan",
        order_by="PageCanonical.position",
    )

    robots = relationship(
        "PageRobots",
        back_populates="page_extraction",
        uselist=False,
        cascade="all, delete-orphan",
    )

    social_metadata = relationship(
        "PageSocialMetadata",
        back_populates="page_extraction",
        cascade="all, delete-orphan",
        order_by="PageSocialMetadata.position",
    )

    structured_data = relationship(
        "PageStructuredData",
        back_populates="page_extraction",
        cascade="all, delete-orphan",
        order_by="PageStructuredData.block_position",
    )

    microdata = relationship(
        "PageMicrodata",
        back_populates="page_extraction",
        cascade="all, delete-orphan",
        order_by="PageMicrodata.item_position",
    )

    breadcrumbs = relationship(
        "PageBreadcrumb",
        back_populates="page_extraction",
        cascade="all, delete-orphan",
        order_by="PageBreadcrumb.position",
    )

    images = relationship(
        "PageImage",
        back_populates="page_extraction",
        cascade="all, delete-orphan",
        order_by="PageImage.position",
    )

    links = relationship(
        "PageLink",
        back_populates="page_extraction",
        cascade="all, delete-orphan",
        order_by="PageLink.position",
    )

    language = relationship(
        "PageLanguage",
        back_populates="page_extraction",
        uselist=False,
        cascade="all, delete-orphan",
    )

    hreflang = relationship(
        "PageHreflang",
        back_populates="page_extraction",
        cascade="all, delete-orphan",
        order_by="PageHreflang.position",
    )

    indexability_evidence = relationship(
        "PageIndexabilityEvidence",
        back_populates="page_extraction",
        uselist=False,
        cascade="all, delete-orphan",
    )


class PageMetaDescription(Base):
    __tablename__ = "page_meta_descriptions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    text: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    length: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    word_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    empty: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    duplicate_within_page: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    duplicate_in_scan: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    too_short: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    too_long: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="meta_descriptions",
    )


class PageHeading(Base):
    __tablename__ = "page_headings"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
    )

    level: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    text: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    empty: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="headings",
    )


class PageCanonical(Base):
    __tablename__ = "page_canonicals"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    empty: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    valid: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    self_reference: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    cross_page: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="canonicals",
    )


class PageRobots(Base):
    __tablename__ = "page_robots"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
        unique=True,
    )

    raw_content: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    index: Mapped[bool | None] = mapped_column(
        nullable=True,
    )

    follow: Mapped[bool | None] = mapped_column(
        nullable=True,
    )

    noindex: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    nofollow: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    noarchive: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    nosnippet: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    other_directives: Mapped[list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="robots",
    )


class PageSocialMetadata(Base):
    __tablename__ = "page_social_metadata"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
    )

    platform: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )

    property_name: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )

    content: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    empty: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    duplicate: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="social_metadata",
    )


class PageStructuredData(Base):
    __tablename__ = "page_structured_data"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
    )

    block_position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    raw_block: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    parsed_json: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    context: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    types: Mapped[list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    entity_names: Mapped[list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    entity_urls: Mapped[list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    parse_error: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="structured_data",
    )


class PageMicrodata(Base):
    __tablename__ = "page_microdata"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
    )

    item_position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    item_type: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    item_id: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    properties: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    raw_snippet: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="microdata",
    )


class PageBreadcrumb(Base):
    __tablename__ = "page_breadcrumbs"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    detection_method: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )

    name: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="breadcrumbs",
    )


class PageImage(Base):
    __tablename__ = "page_images"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    alt: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    alt_missing: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    alt_empty: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    width: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    height: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    file_type: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    loading: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    lazy_loaded: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="images",
    )


class PageLink(Base):
    __tablename__ = "page_links"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    source_url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    destination_url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    anchor_text: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    rel_raw: Mapped[str | None] = mapped_column(
        String(1024),
        nullable=True,
    )

    nofollow: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    sponsored: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    ugc: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    link_type: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="internal",
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="links",
    )


class PageLanguage(Base):
    __tablename__ = "page_languages"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
        unique=True,
    )

    html_lang: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    detected_language: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="language",
    )


class PageHreflang(Base):
    __tablename__ = "page_hreflang"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    language_region: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    target_url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    duplicate_declaration: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    conflicting_declaration: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="hreflang",
    )


class PageIndexabilityEvidence(Base):
    __tablename__ = "page_indexability_evidence"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    page_extraction_id: Mapped[int] = mapped_column(
        ForeignKey("page_extractions.id"),
        nullable=False,
        unique=True,
    )

    http_status: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    robots_txt_allowed: Mapped[bool | None] = mapped_column(
        nullable=True,
    )

    page_noindex: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    page_nofollow: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    canonical_url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    redirected: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    final_url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    content_type: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    evidence_summary: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    page_extraction = relationship(
        "PageExtraction",
        back_populates="indexability_evidence",
    )


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
    )

    scan_id: Mapped[int] = mapped_column(
        ForeignKey("scans.id"),
        nullable=False,
    )

    page_id: Mapped[int | None] = mapped_column(
        ForeignKey("page_results.id"),
        nullable=True,
    )

    finding_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    category: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="seo",
    )

    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    severity: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="medium",
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="open",
    )

    evidence: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    website = relationship(
        "Website",
        back_populates="findings",
    )

    scan = relationship(
        "Scan",
        back_populates="findings",
    )

    page_result = relationship(
        "PageResult",
        back_populates="findings",
    )

    recommendations = relationship(
        "Recommendation",
        back_populates="finding",
        cascade="all, delete-orphan",
    )

    ai_gap_links = relationship(
        "AIGapFindingLink",
        back_populates="finding",
        cascade="all, delete-orphan",
    )


    opportunities = relationship(
        "Opportunity",
        back_populates="finding",
        cascade="all, delete-orphan",
    )

    fix_plans = relationship(
        "FixPlan",
        back_populates="finding",
        cascade="all, delete-orphan",
    )

    validations = relationship(
        "ValidationResult",
        back_populates="finding",
        cascade="all, delete-orphan",
    )

    @property
    def type(self) -> str:
        return self.finding_type


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    finding_id: Mapped[int] = mapped_column(
        ForeignKey("findings.id"),
        nullable=False,
    )

    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    priority: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="medium",
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="open",
    )

    impact: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    action_type: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    payload: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    finding = relationship(
        "Finding",
        back_populates="recommendations",
    )

    opportunities = relationship(
        "Opportunity",
        back_populates="recommendation",
        cascade="all, delete-orphan",
    )

    fix_plans = relationship(
        "FixPlan",
        back_populates="recommendation",
        cascade="all, delete-orphan",
    )

    validations = relationship(
        "ValidationResult",
        back_populates="recommendation",
        cascade="all, delete-orphan",
    )

    @property
    def category(self) -> str:
        if isinstance(self.payload, dict) and "category" in self.payload:
            return self.payload["category"]
        if self.finding:
            return self.finding.category
        return "seo"

    @property
    def effort(self) -> str:
        if isinstance(self.payload, dict) and "effort" in self.payload:
            return self.payload["effort"]
        return "medium"

    @property
    def rationale(self) -> str | None:
        if isinstance(self.payload, dict) and "rationale" in self.payload:
            return self.payload["rationale"]
        return None

    @property
    def opportunity_id(self) -> int | None:
        if isinstance(self.payload, dict) and "opportunity_id" in self.payload:
            return self.payload["opportunity_id"]
        if self.opportunities:
            return self.opportunities[0].id
        return None


class QuestionSet(Base):
    __tablename__ = "question_sets"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    version: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="1.0",
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    website = relationship(
        "Website",
        back_populates="question_sets",
    )

    questions = relationship(
        "Question",
        back_populates="question_set",
        cascade="all, delete-orphan",
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    question_set_id: Mapped[int] = mapped_column(
        ForeignKey("question_sets.id"),
        nullable=False,
    )

    text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    intent: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    topic: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    question_set = relationship(
        "QuestionSet",
        back_populates="questions",
    )

    ai_runs = relationship(
        "AIRun",
        back_populates="question",
        cascade="all, delete-orphan",
    )


class AIRun(Base):
    __tablename__ = "ai_runs"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
    )

    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id"),
        nullable=False,
    )

    provider: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    model: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    environment: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="production",
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="queued",
    )

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    website = relationship(
        "Website",
        back_populates="ai_runs",
    )

    question = relationship(
        "Question",
        back_populates="ai_runs",
    )

    result = relationship(
        "AIResult",
        back_populates="ai_run",
        uselist=False,
        cascade="all, delete-orphan",
    )

    monitoring_records = relationship(
        "MonitoringRecord",
        back_populates="ai_run",
        cascade="all, delete-orphan",
    )


class AIResult(Base):
    __tablename__ = "ai_results"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    ai_run_id: Mapped[int] = mapped_column(
        ForeignKey("ai_runs.id"),
        nullable=False,
        unique=True,
    )

    answer: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    mentions_brand: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )

    mentions_competitors: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    metrics: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    ai_run = relationship(
        "AIRun",
        back_populates="result",
    )


    citations = relationship(
        "Citation",
        back_populates="ai_result",
        cascade="all, delete-orphan",
    )


class Citation(Base):
    __tablename__ = "citations"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    ai_result_id: Mapped[int] = mapped_column(
        ForeignKey("ai_results.id"),
        nullable=False,
    )

    url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
    )

    domain: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    title: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    snippet: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    ai_result = relationship(
        "AIResult",
        back_populates="citations",
    )


class Entity(Base):
    __tablename__ = "entities"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
    )

    page_id: Mapped[int | None] = mapped_column(
        ForeignKey("page_results.id"),
        nullable=True,
    )

    scan_id: Mapped[int | None] = mapped_column(
        ForeignKey("scans.id"),
        nullable=True,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    entity_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        default=1.0,
        nullable=False,
    )

    same_as: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    properties: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    relationships: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    evidence: Mapped[dict | list | str | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    website = relationship(
        "Website",
        back_populates="entities",
    )

    page_result = relationship(
        "PageResult",
        back_populates="entities",
    )

    scan = relationship(
        "Scan",
        back_populates="entities",
    )

    queries = relationship(
        "Query",
        back_populates="entity",
    )

    mentions = relationship(
        "AIMention",
        back_populates="entity",
    )



class Opportunity(Base):
    __tablename__ = "opportunities"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    scan_id: Mapped[int | None] = mapped_column(
        ForeignKey("scans.id"),
        nullable=True,
        index=True,
    )

    page_id: Mapped[int | None] = mapped_column(
        ForeignKey("page_results.id"),
        nullable=True,
        index=True,
    )

    finding_id: Mapped[int | None] = mapped_column(
        ForeignKey("findings.id"),
        nullable=True,
        index=True,
    )

    recommendation_id: Mapped[int | None] = mapped_column(
        ForeignKey("recommendations.id"),
        nullable=True,
        index=True,
    )

    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    opportunity_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    category: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="seo",
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="identified",
        index=True,
    )

    impact: Mapped[float] = mapped_column(
        Float,
        default=0.5,
        nullable=False,
    )

    effort: Mapped[float] = mapped_column(
        Float,
        default=0.5,
        nullable=False,
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        default=0.8,
        nullable=False,
    )

    priority_score: Mapped[float] = mapped_column(
        Float,
        default=0.5,
        nullable=False,
        index=True,
    )

    priority: Mapped[str] = mapped_column(
        String(20),
        default="MEDIUM",
        nullable=False,
        index=True,
    )

    rationale: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    evidence: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    website = relationship(
        "Website",
        back_populates="opportunities",
    )

    scan = relationship(
        "Scan",
        back_populates="opportunities",
    )

    page_result = relationship(
        "PageResult",
        back_populates="opportunities",
    )

    finding = relationship(
        "Finding",
        back_populates="opportunities",
    )

    recommendation = relationship(
        "Recommendation",
        back_populates="opportunities",
    )

    fix_plans = relationship(
        "FixPlan",
        back_populates="opportunity",
        cascade="all, delete-orphan",
    )

    validations = relationship(
        "ValidationResult",
        back_populates="opportunity",
        cascade="all, delete-orphan",
    )


class FixPlan(Base):
    __tablename__ = "fix_plans"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    recommendation_id: Mapped[int] = mapped_column(
        ForeignKey("recommendations.id"),
        nullable=False,
        index=True,
    )

    finding_id: Mapped[int | None] = mapped_column(
        ForeignKey("findings.id"),
        nullable=True,
        index=True,
    )

    opportunity_id: Mapped[int | None] = mapped_column(
        ForeignKey("opportunities.id"),
        nullable=True,
        index=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    scan_id: Mapped[int | None] = mapped_column(
        ForeignKey("scans.id"),
        nullable=True,
        index=True,
    )

    page_id: Mapped[int | None] = mapped_column(
        ForeignKey("page_results.id"),
        nullable=True,
        index=True,
    )

    fix_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    problem_statement: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    proposed_action: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    expected_outcome: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    estimated_effort: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="medium",
    )

    risk_level: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="low",
    )

    priority: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="medium",
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="draft",
        index=True,
    )

    diff_payload: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    safety_checks: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    recommendation = relationship(
        "Recommendation",
        back_populates="fix_plans",
    )

    finding = relationship(
        "Finding",
        back_populates="fix_plans",
    )

    opportunity = relationship(
        "Opportunity",
        back_populates="fix_plans",
    )

    website = relationship(
        "Website",
        back_populates="fix_plans",
    )

    scan = relationship(
        "Scan",
        back_populates="fix_plans",
    )

    page_result = relationship(
        "PageResult",
        back_populates="fix_plans",
    )

    validations = relationship(
        "ValidationResult",
        back_populates="fix_plan",
        cascade="all, delete-orphan",
    )


class ValidationResult(Base):
    __tablename__ = "validation_results"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    fix_plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("fix_plans.id"),
        nullable=True,
        index=True,
    )

    recommendation_id: Mapped[int | None] = mapped_column(
        ForeignKey("recommendations.id"),
        nullable=True,
        index=True,
    )

    finding_id: Mapped[int | None] = mapped_column(
        ForeignKey("findings.id"),
        nullable=True,
        index=True,
    )

    opportunity_id: Mapped[int | None] = mapped_column(
        ForeignKey("opportunities.id"),
        nullable=True,
        index=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    scan_id: Mapped[int | None] = mapped_column(
        ForeignKey("scans.id"),
        nullable=True,
        index=True,
    )

    page_id: Mapped[int | None] = mapped_column(
        ForeignKey("page_results.id"),
        nullable=True,
        index=True,
    )

    validation_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="completed",
        index=True,
    )

    result: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        index=True,
    )

    validation_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.0,
    )

    before_state: Mapped[dict | list | str | None] = mapped_column(
        JSON,
        nullable=True,
    )

    after_state: Mapped[dict | list | str | None] = mapped_column(
        JSON,
        nullable=True,
    )

    expected_result: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    actual_result: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    explanation: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    feedback: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    fix_plan = relationship(
        "FixPlan",
        back_populates="validations",
    )

    recommendation = relationship(
        "Recommendation",
        back_populates="validations",
    )

    finding = relationship(
        "Finding",
        back_populates="validations",
    )

    opportunity = relationship(
        "Opportunity",
        back_populates="validations",
    )

    website = relationship(
        "Website",
        back_populates="validations",
    )

    scan = relationship(
        "Scan",
        back_populates="validations",
    )

    page_result = relationship(
        "PageResult",
        back_populates="validations",
    )


class MonitoringRecord(Base):
    __tablename__ = "monitoring_records"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    scan_id: Mapped[int | None] = mapped_column(
        ForeignKey("scans.id"),
        nullable=True,
        index=True,
    )

    ai_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_runs.id"),
        nullable=True,
        index=True,
    )

    target_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    target_id: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    metric_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    metric_category: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="intelligence",
    )

    previous_value: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    current_value: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    delta: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    change_detected: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="active",
    )

    event_type: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    summary: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    details: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    website = relationship(
        "Website",
        back_populates="monitoring_records",
    )

    scan = relationship(
        "Scan",
        back_populates="monitoring_records",
    )

    ai_run = relationship(
        "AIRun",
        back_populates="monitoring_records",
    )


class QuerySet(Base):
    __tablename__ = "query_sets"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    scan_id: Mapped[int | None] = mapped_column(
        ForeignKey("scans.id"),
        nullable=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    version: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="1.0",
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="active",
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    website = relationship(
        "Website",
        back_populates="query_sets",
    )

    scan = relationship(
        "Scan",
        back_populates="query_sets",
    )

    queries = relationship(
        "Query",
        back_populates="query_set",
        cascade="all, delete-orphan",
    )

    responses = relationship(
        "AIResponse",
        back_populates="query_set",
        cascade="all, delete-orphan",
    )

    visibility_observations = relationship(
        "AIVisibilityObservation",
        back_populates="query_set",
        cascade="all, delete-orphan",
    )

    visibility_gaps = relationship(
        "AIVisibilityGap",
        back_populates="query_set",
        cascade="all, delete-orphan",
    )

    visibility_snapshots = relationship(
        "AIVisibilitySnapshot",
        back_populates="query_set",
        cascade="all, delete-orphan",
    )

    monitoring_runs = relationship(
        "AIMonitoringRun",
        back_populates="query_set",
        cascade="all, delete-orphan",
    )






class Query(Base):
    __tablename__ = "queries"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    query_set_id: Mapped[int] = mapped_column(
        ForeignKey("query_sets.id"),
        nullable=False,
        index=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    query_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    intent: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="INFORMATIONAL",
        index=True,
    )

    topic_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    topic: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
    )

    entity_id: Mapped[int | None] = mapped_column(
        ForeignKey("entities.id"),
        nullable=True,
        index=True,
    )

    entity_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    page_id: Mapped[int | None] = mapped_column(
        ForeignKey("page_results.id"),
        nullable=True,
        index=True,
    )

    generation_source: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="TOPIC_INTELLIGENCE",
        index=True,
    )

    priority: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="MEDIUM",
        index=True,
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.0,
    )

    version: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="1.0",
        index=True,
    )

    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        index=True,
    )

    metadata_json: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    query_set = relationship(
        "QuerySet",
        back_populates="queries",
    )

    website = relationship(
        "Website",
        back_populates="queries",
    )

    entity = relationship(
        "Entity",
        back_populates="queries",
    )

    page_result = relationship(
        "PageResult",
        back_populates="queries",
    )

    responses = relationship(
        "AIResponse",
        back_populates="query",
        cascade="all, delete-orphan",
    )

    mentions = relationship(
        "AIMention",
        back_populates="query",
        cascade="all, delete-orphan",
    )

    citations = relationship(
        "AICitation",
        back_populates="query",
        cascade="all, delete-orphan",
    )

    visibility_observations = relationship(
        "AIVisibilityObservation",
        back_populates="query",
        cascade="all, delete-orphan",
    )

    visibility_gaps = relationship(
        "AIVisibilityGap",
        back_populates="query",
        cascade="all, delete-orphan",
    )



    @property
    def question_text(self) -> str:
        return self.query_text


class AIResponse(Base):
    __tablename__ = "ai_responses"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    query_id: Mapped[int] = mapped_column(
        ForeignKey("queries.id"),
        nullable=False,
        index=True,
    )

    query_set_id: Mapped[int] = mapped_column(
        ForeignKey("query_sets.id"),
        nullable=False,
        index=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    provider: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    model: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    model_version: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="SUCCESS",
        index=True,
    )

    response_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    latency_ms: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    error_type: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    input_tokens: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    output_tokens: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    total_tokens: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    request_timestamp: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    response_timestamp: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    metadata_json: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    query = relationship(
        "Query",
        back_populates="responses",
    )

    query_set = relationship(
        "QuerySet",
        back_populates="responses",
    )

    website = relationship(
        "Website",
        back_populates="ai_responses",
    )

    mentions = relationship(
        "AIMention",
        back_populates="response",
        cascade="all, delete-orphan",
    )

    citations = relationship(
        "AICitation",
        back_populates="response",
        cascade="all, delete-orphan",
    )

    visibility_observation = relationship(
        "AIVisibilityObservation",
        back_populates="response",
        uselist=False,
        cascade="all, delete-orphan",
    )

    visibility_gaps = relationship(
        "AIVisibilityGap",
        back_populates="response",
        cascade="all, delete-orphan",
    )




class AIMention(Base):
    __tablename__ = "ai_mentions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    response_id: Mapped[int] = mapped_column(
        ForeignKey("ai_responses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    query_id: Mapped[int] = mapped_column(
        ForeignKey("queries.id"),
        nullable=False,
        index=True,
    )

    entity_id: Mapped[int | None] = mapped_column(
        ForeignKey("entities.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    matched_text: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    match_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )

    normalized_text: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    start_pos: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    end_pos: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    context_snippet: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.0,
    )

    metadata_json: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    response = relationship(
        "AIResponse",
        back_populates="mentions",
    )

    website = relationship(
        "Website",
        back_populates="mentions",
    )

    query = relationship(
        "Query",
        back_populates="mentions",
    )

    entity = relationship(
        "Entity",
        back_populates="mentions",
    )


class AICitation(Base):
    __tablename__ = "ai_citations"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    response_id: Mapped[int] = mapped_column(
        ForeignKey("ai_responses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    query_id: Mapped[int] = mapped_column(
        ForeignKey("queries.id"),
        nullable=False,
        index=True,
    )

    page_id: Mapped[int | None] = mapped_column(
        ForeignKey("page_results.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
    )

    normalized_url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
        index=True,
    )

    domain: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    is_target_domain: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        index=True,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
    )

    context_snippet: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.0,
    )

    metadata_json: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    response = relationship(
        "AIResponse",
        back_populates="citations",
    )

    website = relationship(
        "Website",
        back_populates="citations",
    )

    query = relationship(
        "Query",
        back_populates="citations",
    )

    page_result = relationship(
        "PageResult",
        back_populates="citations",
    )


class AIVisibilityObservation(Base):
    __tablename__ = "ai_visibility_observations"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    response_id: Mapped[int] = mapped_column(
        ForeignKey("ai_responses.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    query_id: Mapped[int] = mapped_column(
        ForeignKey("queries.id"),
        nullable=False,
        index=True,
    )

    query_set_id: Mapped[int] = mapped_column(
        ForeignKey("query_sets.id"),
        nullable=False,
        index=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    provider: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    model: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    target_mentioned: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        index=True,
    )

    target_cited: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        index=True,
    )

    first_party_cited: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        index=True,
    )

    relevant_answer: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        default="UNKNOWN",
        index=True,
    )

    observable_mention_position: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    observable_citation_position: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.0,
    )

    competitor_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    competitors_present: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        index=True,
    )

    competitor_signals_json: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    evidence_summary_json: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    response = relationship(
        "AIResponse",
        back_populates="visibility_observation",
    )

    query = relationship(
        "Query",
        back_populates="visibility_observations",
    )

    query_set = relationship(
        "QuerySet",
        back_populates="visibility_observations",
    )

    website = relationship(
        "Website",
        back_populates="visibility_observations",
    )

    gaps = relationship(
        "AIVisibilityGap",
        back_populates="observation",
        cascade="all, delete-orphan",
    )


class AIVisibilityGap(Base):
    __tablename__ = "ai_visibility_gaps"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    response_id: Mapped[int] = mapped_column(
        ForeignKey("ai_responses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    observation_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_visibility_observations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    query_id: Mapped[int] = mapped_column(
        ForeignKey("queries.id"),
        nullable=False,
        index=True,
    )

    query_set_id: Mapped[int] = mapped_column(
        ForeignKey("query_sets.id"),
        nullable=False,
        index=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    gap_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    severity: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="MEDIUM",
        index=True,
    )

    reason: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    evidence_json: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    response = relationship(
        "AIResponse",
        back_populates="visibility_gaps",
    )

    observation = relationship(
        "AIVisibilityObservation",
        back_populates="gaps",
    )

    query = relationship(
        "Query",
        back_populates="visibility_gaps",
    )

    query_set = relationship(
        "QuerySet",
        back_populates="visibility_gaps",
    )

    website = relationship(
        "Website",
        back_populates="visibility_gaps",
    )

    finding_links = relationship(
        "AIGapFindingLink",
        back_populates="gap",
        cascade="all, delete-orphan",
    )


class AIGapFindingLink(Base):
    __tablename__ = "ai_gap_finding_links"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    gap_id: Mapped[int] = mapped_column(
        ForeignKey("ai_visibility_gaps.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    finding_id: Mapped[int] = mapped_column(
        ForeignKey("findings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    match_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.0,
    )

    reasons_json: Mapped[list | dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    gap = relationship(
        "AIVisibilityGap",
        back_populates="finding_links",
    )

    finding = relationship(
        "Finding",
        back_populates="ai_gap_links",
    )


class AIVisibilitySnapshot(Base):
    __tablename__ = "ai_visibility_snapshots"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    query_set_id: Mapped[int | None] = mapped_column(
        ForeignKey("query_sets.id"),
        nullable=True,
        index=True,
    )

    provider: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    period_start: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
    )

    period_end: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
    )

    evaluable_responses: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    total_attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    mention_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    citation_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    first_party_citation_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    competitor_appearance_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    mention_rate: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    citation_rate: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    first_party_citation_rate: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    competitor_appearance_rate: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    metrics_json: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    website = relationship(
        "Website",
        back_populates="visibility_snapshots",
    )

    query_set = relationship(
        "QuerySet",
        back_populates="visibility_snapshots",
    )


class AIMonitoringRun(Base):
    __tablename__ = "ai_monitoring_runs"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    query_set_id: Mapped[int] = mapped_column(
        ForeignKey("query_sets.id"),
        nullable=False,
        index=True,
    )

    provider: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="mock",
    )

    model: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="CREATED",
        index=True,
    )

    total_queries: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    attempted_queries: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    successful_responses: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    failed_responses: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    detected_mentions: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    detected_citations: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    detected_gaps: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    mention_rate: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    citation_rate: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    execution_metadata_json: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    website = relationship(
        "Website",
        back_populates="monitoring_runs",
    )

    query_set = relationship(
        "QuerySet",
        back_populates="monitoring_runs",
    )




