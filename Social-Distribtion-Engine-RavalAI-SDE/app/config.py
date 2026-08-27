"""Application configuration using Pydantic v2 settings."""

from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Core application settings loaded from environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # === Environment ===
    ENV: Literal["development", "staging", "production", "testing"] = Field(
        default="development",
        description="Environment name",
    )
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO",
        description="Logging level",
    )

    # === PostgreSQL Database ===
    POSTGRES_USER: str = Field(
        default="sde",
        description="PostgreSQL username",
    )
    POSTGRES_PASSWORD: str = Field(
        description="PostgreSQL password (required in production)",
    )
    POSTGRES_DB: str = Field(
        default="raval_sde",
        description="PostgreSQL database name",
    )
    POSTGRES_HOST: str = Field(
        default="localhost",
        description="PostgreSQL host",
    )
    POSTGRES_PORT: int = Field(
        default=5432,
        description="PostgreSQL port",
    )

    # Computed database URLs
    DATABASE_URL: str | None = Field(
        default=None,
        description="Full PostgreSQL async connection string; auto-computed if not set",
    )
    DATABASE_URL_SYNC: str | None = Field(
        default=None,
        description="Full PostgreSQL sync connection string; auto-computed if not set",
    )

    # === Redis ===
    REDIS_URL: str = Field(
        default="redis://localhost:6379/0",
        description="Redis connection string for Celery broker",
    )

    # === SDE API Authentication ===
    SDE_API_TOKEN: str = Field(
        description="Bearer token for API access",
    )
    SDE_SIGNING_SECRET: str = Field(
        description="HMAC secret for request signing (32+ bytes recommended)",
    )

    # === Encryption ===
    FERNET_KEY: str = Field(
        description="Fernet key for token encryption (generate with Fernet.generate_key())",
    )

    # === API Server ===
    API_HOST: str = Field(
        default="0.0.0.0",
        description="API server listen address",
    )
    API_PORT: int = Field(
        default=8000,
        description="API server listen port",
    )

    # === Celery ===
    CELERY_BROKER_URL: str | None = Field(
        default=None,
        description="Celery broker URL (defaults to REDIS_URL if not set)",
    )
    CELERY_RESULT_BACKEND: str | None = Field(
        default=None,
        description="Celery result backend (defaults to REDIS_URL if not set)",
    )

    # === Workspace & Brand Defaults ===
    DEFAULT_WORKSPACE_ID: str = Field(
        default="workspace_001",
        description="Default workspace ID for testing",
    )
    DEFAULT_BRAND_ID: str = Field(
        default="brand_001",
        description="Default brand ID for testing",
    )

    # === OAuth Providers ===
    TWITTER_CLIENT_ID: str = Field(
        default="",
        description="Twitter/X OAuth client ID",
    )
    TWITTER_CLIENT_SECRET: str = Field(
        default="",
        description="Twitter/X OAuth client secret",
    )
    TWITTER_CALLBACK_URL: str = Field(
        default="http://localhost:8000/api/v1/oauth/x/callback",
        description="Twitter/X OAuth callback URL",
    )

    LINKEDIN_CLIENT_ID: str = Field(
        default="",
        description="LinkedIn OAuth client ID",
    )
    LINKEDIN_CLIENT_SECRET: str = Field(
        default="",
        description="LinkedIn OAuth client secret",
    )
    LINKEDIN_CALLBACK_URL: str = Field(
        default="http://localhost:8000/api/v1/oauth/linkedin/callback",
        description="LinkedIn OAuth callback URL",
    )

    FACEBOOK_CLIENT_ID: str = Field(
        default="",
        description="Facebook OAuth client ID",
    )
    FACEBOOK_CLIENT_SECRET: str = Field(
        default="",
        description="Facebook OAuth client secret",
    )
    FACEBOOK_CALLBACK_URL: str = Field(
        default="http://localhost:8000/api/v1/oauth/facebook/callback",
        description="Facebook OAuth callback URL",
    )

    # === Webhook Configuration ===
    WEBHOOK_DEFAULT_SECRET: str = Field(
        default="dev-webhook-secret",
        description="Default webhook signing secret",
    )

    # === Rate Limiting & Retry ===
    MAX_RETRIES: int = Field(
        default=5,
        description="Maximum retry attempts for transient failures",
    )
    RETRY_DELAY_SECONDS: int = Field(
        default=60,
        description="Initial retry delay in seconds",
    )
    MAX_RETRY_DELAY_SECONDS: int = Field(
        default=3600,
        description="Maximum retry delay (exponential backoff cap)",
    )

    # === Scheduling ===
    BEAT_INTERVAL_SECONDS: int = Field(
        default=30,
        description="Celery beat schedule check interval",
    )
    TOKEN_REFRESH_HOUR: int = Field(
        default=3,
        description="UTC hour (0-23) to check token expiration",
    )

    # === Database Connection Pool ===
    DB_POOL_SIZE: int = Field(
        default=20,
        description="SQLAlchemy connection pool size",
    )
    DB_MAX_OVERFLOW: int = Field(
        default=0,
        description="SQLAlchemy max overflow connections",
    )
    DB_POOL_RECYCLE: int = Field(
        default=3600,
        description="SQLAlchemy pool recycle timeout (seconds)",
    )
    DB_POOL_PRE_PING: bool = Field(
        default=True,
        description="Enable pool pre-ping to test connections",
    )

    # === Monitoring & Observability ===
    SENTRY_DSN: str = Field(
        default="",
        description="Sentry error tracking DSN (optional)",
    )
    OTEL_ENABLED: bool = Field(
        default=False,
        description="Enable OpenTelemetry tracing",
    )
    OTEL_EXPORTER_OTLP_ENDPOINT: str = Field(
        default="http://localhost:4317",
        description="OpenTelemetry OTLP exporter endpoint",
    )

    @field_validator("POSTGRES_PASSWORD", mode="before")
    @classmethod
    def validate_postgres_password(cls, v: str) -> str:
        """Ensure POSTGRES_PASSWORD is set and non-empty."""
        if not v:
            raise ValueError("POSTGRES_PASSWORD is required")
        return v

    @field_validator("SDE_API_TOKEN", mode="before")
    @classmethod
    def validate_api_token(cls, v: str) -> str:
        """Ensure SDE_API_TOKEN is set and non-empty."""
        if not v:
            raise ValueError("SDE_API_TOKEN is required")
        if len(v) < 16:
            raise ValueError("SDE_API_TOKEN must be at least 16 characters")
        return v

    @field_validator("SDE_SIGNING_SECRET", mode="before")
    @classmethod
    def validate_signing_secret(cls, v: str) -> str:
        """Ensure SDE_SIGNING_SECRET is set and non-empty."""
        if not v:
            raise ValueError("SDE_SIGNING_SECRET is required")
        if len(v) < 32:
            raise ValueError("SDE_SIGNING_SECRET must be at least 32 bytes")
        return v

    @field_validator("FERNET_KEY", mode="before")
    @classmethod
    def validate_fernet_key(cls, v: str) -> str:
        """Ensure FERNET_KEY is a valid Fernet key."""
        if not v:
            raise ValueError("FERNET_KEY is required")
        # Fernet keys are base64-encoded 32 bytes, typically 44 chars
        if len(v) < 40:
            raise ValueError("FERNET_KEY appears invalid (too short)")
        return v

    def __init__(self, **data: Any) -> None:
        """Initialize settings and compute derived URLs."""
        super().__init__(**data)

        # Compute async database URL if not provided
        if not self.DATABASE_URL:
            self.DATABASE_URL = (
                f"postgresql+asyncpg://{self.POSTGRES_USER}:"
                f"{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:"
                f"{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
            )

        # Compute sync database URL if not provided
        if not self.DATABASE_URL_SYNC:
            self.DATABASE_URL_SYNC = (
                f"postgresql+psycopg://{self.POSTGRES_USER}:"
                f"{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:"
                f"{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
            )

        # Default Celery URLs to REDIS_URL if not set
        if not self.CELERY_BROKER_URL:
            self.CELERY_BROKER_URL = self.REDIS_URL
        if not self.CELERY_RESULT_BACKEND:
            self.CELERY_RESULT_BACKEND = self.REDIS_URL


# Global settings instance
settings: Settings | None = None


def get_settings() -> Settings:
    """Get or create the global settings instance."""
    global settings
    if settings is None:
        settings = Settings()
        _log_config_summary(settings)
    return settings


def _log_config_summary(cfg: Settings) -> None:
    """Log a summary of loaded configuration (sanitize secrets)."""
    logger = logging.getLogger(__name__)
    logger.info("Configuration loaded successfully")
    logger.debug(f"ENV={cfg.ENV}")
    logger.debug(f"LOG_LEVEL={cfg.LOG_LEVEL}")
    logger.debug(f"DATABASE_URL={cfg.DATABASE_URL}")
    logger.debug(f"REDIS_URL={cfg.REDIS_URL}")
    logger.debug(f"API_HOST={cfg.API_HOST}:{cfg.API_PORT}")
    logger.debug(
        f"Database pool: size={cfg.DB_POOL_SIZE}, "
        f"overflow={cfg.DB_MAX_OVERFLOW}, "
        f"recycle={cfg.DB_POOL_RECYCLE}s"
    )
