from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
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

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    scan = relationship(
        "Scan",
        back_populates="page_results",
    )