"""Platform adapters for social media publishing."""

from __future__ import annotations


def register_default_adapters() -> None:
    """Register the platform adapters into the global registry (idempotent).

    Called from the FastAPI lifespan AND from ``app.celery_app`` so that both
    the API and the Celery worker can publish to real platforms. The worker
    does not run the FastAPI lifespan, so without this it only ever had the
    DryRun adapter and silently fell back to it for real accounts.
    """
    from app.adapters.base import ADAPTER_REGISTRY
    from app.adapters.dryrun import DryRunAdapter
    from app.adapters.instagram import InstagramAdapter
    from app.adapters.linkedin import LinkedInAdapter
    from app.adapters.meta import FacebookAdapter
    from app.adapters.twitter import TwitterAdapter

    for name, adapter_cls in (
        ("dryrun", DryRunAdapter),
        ("twitter", TwitterAdapter),
        ("linkedin", LinkedInAdapter),
        ("facebook", FacebookAdapter),
        ("instagram", InstagramAdapter),
    ):
        if not ADAPTER_REGISTRY.is_registered(name):
            ADAPTER_REGISTRY.register(name, adapter_cls)
