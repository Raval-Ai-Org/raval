from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text
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
        "TechnicalSeoFinding",
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
        "TechnicalSeoFinding",
        back_populates="page_result",
        cascade="all, delete-orphan",
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


class TechnicalSeoFinding(Base):
    """A single technical-SEO / indexability finding produced by the rule engine.

    Task 5 layer. Each row is one rule firing on one page, backed by the
    Task 4 extraction evidence. Findings are page-anchored (``page_result_id``
    is required) and carry the full explainability payload:
    what is wrong (``message``/``observed_value``), where (page relations),
    why it matters (``reason``), the expected state, a recommendation, and the
    raw evidence dict behind the decision. Idempotency is achieved by
    purge-and-reinsert per scan/page, so there is intentionally no unique
    constraint (one rule may legitimately emit several rows on one page, e.g.
    multiple broken links).
    """

    __tablename__ = "technical_seo_findings"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    website_id: Mapped[int] = mapped_column(
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    scan_id: Mapped[int] = mapped_column(
        ForeignKey("scans.id"),
        nullable=False,
        index=True,
    )

    page_result_id: Mapped[int] = mapped_column(
        ForeignKey("page_results.id"),
        nullable=False,
        index=True,
    )

    rule_id: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    category: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    severity: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="open",
    )

    message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    observed_value: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    expected_state: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    reason: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    recommendation: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    evidence: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    scan = relationship(
        "Scan",
        back_populates="findings",
    )

    page_result = relationship(
        "PageResult",
        back_populates="findings",
    )