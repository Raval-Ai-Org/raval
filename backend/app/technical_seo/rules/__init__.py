"""Rule modules for the technical-SEO engine.

Importing this package imports every rule module, which runs the ``@register``
decorators and populates ``base.RULE_REGISTRY``. The engine imports this package
for exactly that side effect — if a new rule module is added it MUST be listed
here or its rules will never run.
"""

from . import (  # noqa: F401
    canonical,
    duplicates,
    headings,
    http,
    images,
    indexability,
    language,
    links,
    meta,
    robots,
    social,
    structured_data,
    title,
)

__all__ = [
    "canonical",
    "duplicates",
    "headings",
    "http",
    "images",
    "indexability",
    "language",
    "links",
    "meta",
    "robots",
    "social",
    "structured_data",
    "title",
]
