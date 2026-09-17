"""
Applicability Engine (Task 8 - Step 8.3)

Evaluates normalized and aggregated intelligence signals against the contextual
reality of the target page (page type, search/content intent, available source data,
and structural telemetry).

Core Principles & Invariants:
1. STATUS SEMANTICS:
   - PASS: Applicable rule was evaluated and passed.
   - FAIL: Applicable rule was evaluated and failed.
   - WARNING: Applicable rule applies but indicates a partial, weak, or cautionary condition.
   - N/A: The rule genuinely does not apply to the current page/context.
   - UNKNOWN: The rule may apply, but there is insufficient reliable information to evaluate it.
2. MISSING DATA INVARIANT:
   - Missing data MUST NOT automatically become FAIL.
   - Distinguish explicitly between N/A (rule does not apply), UNKNOWN (insufficient data),
     and FAIL (actual verified failure condition).
3. DETERMINISTIC & EXPLAINABLE:
   - Every applicability decision attaches an explainable rationale and traceable metadata.
4. NON-MUTATING & PURE:
   - Input signals and collections are never modified in place; returns new deep-copied instances.
"""

from copy import deepcopy
from datetime import datetime, timezone
from enum import Enum
import re
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field

from .signal_aggregator import AggregatedSignalCollection
from .unified_signal import (
    ApplicabilityType,
    UnifiedSignal,
    UnifiedSignalBatch,
)


class ApplicabilityStatus(str, Enum):
    """Canonical applicability evaluation statuses."""
    PASS = "pass"
    FAIL = "fail"
    WARNING = "warning"
    NA = "n/a"
    UNKNOWN = "unknown"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            val_lower = value.lower().strip()
            for member in cls:
                if member.value == val_lower:
                    return member
            # Aliases
            if val_lower in ("not_applicable", "na", "inapplicable", "not applicable"):
                return cls.NA
            if val_lower in ("passed", "success", "ok", "valid", "verified", "detected", "supported"):
                return cls.PASS
            if val_lower in ("failed", "error", "missing", "broken", "unsupported"):
                return cls.FAIL
            if val_lower in ("warn", "caution", "partial", "adequate", "moderate", "weak", "deficient"):
                return cls.WARNING
            if val_lower in ("indeterminate", "unverified", "insufficient_data", "missing_data"):
                return cls.UNKNOWN
        return cls.UNKNOWN


class PageType(str, Enum):
    """Standardized page classifications for contextual applicability."""
    HOMEPAGE = "homepage"
    ARTICLE = "article"
    BLOG_POST = "blog_post"
    PRODUCT = "product"
    CATEGORY = "category"
    ABOUT = "about"
    CONTACT = "contact"
    LEGAL_PRIVACY = "legal_privacy"
    FAQ = "faq"
    DOCUMENTATION = "documentation"
    LANDING_PAGE = "landing_page"
    GENERAL = "general"
    UNKNOWN = "unknown"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            val_lower = value.lower().strip()
            for member in cls:
                if member.value == val_lower:
                    return member
            if val_lower in ("home", "index", "root"):
                return cls.HOMEPAGE
            if val_lower in ("post", "news", "guide", "tutorial", "story"):
                return cls.ARTICLE
            if val_lower in ("privacy", "terms", "tos", "policy", "legal", "disclaimer", "cookie_policy"):
                return cls.LEGAL_PRIVACY
            if val_lower in ("item", "service", "offering"):
                return cls.PRODUCT
            if val_lower in ("support", "help", "qna"):
                return cls.FAQ
            if val_lower in ("docs", "doc", "api", "reference", "manual"):
                return cls.DOCUMENTATION
        return cls.GENERAL


class ApplicabilityContext(BaseModel):
    """
    Contextual reality of the analyzed target used to determine rule applicability.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    page_type: str = Field(
        default=PageType.GENERAL.value,
        description="Canonical page classification (homepage, article, product, legal_privacy, etc.)",
    )
    intent: str | None = Field(
        default=None,
        description="Search or content intent (informational, transactional, navigational, commercial_investigation, qa)",
    )
    available_data: dict[str, bool] = Field(
        default_factory=dict,
        description="Data availability flags (has_raw_html, has_text, has_headings, has_structured_data, has_claims, etc.)",
    )
    extracted_data: dict[str, Any] = Field(
        default_factory=dict,
        description="Auxiliary structural metrics and telemetry (word_count, heading_count, schema_types, etc.)",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional context metadata",
    )

    @classmethod
    def from_page_data(
        cls,
        url: str | None = None,
        raw_html: str | None = None,
        text_content: str | None = None,
        intent: str | None = None,
        page_type: str | None = None,
        claims_count: int | None = None,
        questions_count: int | None = None,
        links_count: int | None = None,
        headings_count: int | None = None,
        schema_types: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> "ApplicabilityContext":
        """
        Infers an ApplicabilityContext from available page data and structural indicators.
        """
        # Determine data availability flags
        has_html = bool(raw_html and raw_html.strip())
        has_text = bool(text_content and text_content.strip())
        has_headings = bool(headings_count and headings_count > 0)
        has_links = bool(links_count and links_count > 0)
        has_schemas = bool(schema_types and len(schema_types) > 0)
        has_claims = bool(claims_count and claims_count > 0)
        has_questions = bool(questions_count and questions_count > 0)

        # Infer page_type if not explicitly provided
        inferred_page_type = page_type
        if not inferred_page_type:
            inferred_page_type = cls._infer_page_type(url=url, text=text_content, schema_types=schema_types)

        # Infer intent if not provided
        inferred_intent = intent
        if not inferred_intent:
            inferred_intent = cls._infer_intent(url=url, text=text_content, page_type=inferred_page_type)

        available_data = {
            "has_raw_html": has_html,
            "has_text": has_text,
            "has_headings": has_headings,
            "has_links": has_links,
            "has_structured_data": has_schemas,
            "has_claims": has_claims,
            "has_questions": has_questions,
        }

        extracted_data = {
            "word_count": len(text_content.split()) if text_content else 0,
            "claims_count": claims_count or 0,
            "questions_count": questions_count or 0,
            "links_count": links_count or 0,
            "headings_count": headings_count or 0,
            "schema_types": schema_types or [],
        }

        return cls(
            page_type=inferred_page_type,
            intent=inferred_intent,
            available_data=available_data,
            extracted_data=extracted_data,
            metadata=metadata or {},
        )

    @staticmethod
    def _infer_page_type(url: str | None, text: str | None, schema_types: list[str] | None) -> str:
        """Heuristic inference of page type from URL and schema markers."""
        if schema_types:
            schemas_lower = [s.lower() for s in schema_types]
            if any("article" in s or "blogposting" in s or "newsarticle" in s for s in schemas_lower):
                return PageType.ARTICLE.value
            if any("product" in s or "offer" in s for s in schemas_lower):
                return PageType.PRODUCT.value
            if any("faqpage" in s or "qapage" in s for s in schemas_lower):
                return PageType.FAQ.value
            if any("aboutpage" in s for s in schemas_lower):
                return PageType.ABOUT.value
            if any("contactpage" in s for s in schemas_lower):
                return PageType.CONTACT.value

        if url:
            path = urlparse(url).path.lower().strip("/")
            if not path or path in ("", "index.html", "index.php"):
                return PageType.HOMEPAGE.value
            if any(p in path for p in ("privacy", "terms", "tos", "policy", "legal", "disclaimer", "cookie")):
                return PageType.LEGAL_PRIVACY.value
            if any(p in path for p in ("contact", "contact-us", "reach-us")):
                return PageType.CONTACT.value
            if any(p in path for p in ("about", "about-us", "team", "our-story")):
                return PageType.ABOUT.value
            if any(p in path for p in ("faq", "frequently-asked-questions", "help", "support")):
                return PageType.FAQ.value
            if any(p in path for p in ("docs", "documentation", "api-ref", "guide")):
                return PageType.DOCUMENTATION.value
            if any(p in path for p in ("blog", "article", "post", "news")):
                return PageType.ARTICLE.value
            if any(p in path for p in ("product", "item", "p/", "shop/")):
                return PageType.PRODUCT.value
            if any(p in path for p in ("category", "c/", "collections/")):
                return PageType.CATEGORY.value

        return PageType.GENERAL.value

    @staticmethod
    def _infer_intent(url: str | None, text: str | None, page_type: str) -> str:
        """Infers primary intent based on page type or URL."""
        if page_type in (PageType.ARTICLE.value, PageType.BLOG_POST.value, PageType.DOCUMENTATION.value):
            return "informational"
        if page_type in (PageType.PRODUCT.value, PageType.CATEGORY.value):
            return "transactional"
        if page_type in (PageType.FAQ.value,):
            return "qa"
        if page_type in (PageType.LEGAL_PRIVACY.value, PageType.CONTACT.value, PageType.ABOUT.value):
            return "navigational"
        return "informational"


class ApplicabilityDecision(BaseModel):
    """Detailed record of an applicability and status decision for a signal."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    rule_id: str
    status: str
    is_applicable: bool
    applicability_type: str
    reason: str
    confidence: str = "high"
    source_module: str
    evidence_available: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class ApplicabilityEngine:
    """
    Applicability Engine (Step 8.3).

    Evaluates whether individual intelligence rules are applicable given the
    page context, determines canonical PASS, FAIL, WARNING, N/A, or UNKNOWN status,
    and guarantees that missing data never automatically turns into a FAIL.
    """

    def evaluate_signal(
        self,
        signal: UnifiedSignal,
        context: ApplicabilityContext | dict[str, Any] | None = None,
    ) -> UnifiedSignal:
        """
        Evaluates the applicability of a single UnifiedSignal against the provided context.
        Returns a new UnifiedSignal instance with updated status, applicability, and decision metadata.
        """
        if signal is None:
            raise ValueError("signal cannot be None")

        app_context = self._resolve_context(context)

        # 1. Determine whether the rule is applicable to this context
        is_applicable, applicability_reason, app_type = self.is_rule_applicable(
            rule_id=signal.rule_id,
            signal=signal,
            context=app_context,
        )

        # 2. Determine canonical status (PASS, FAIL, WARNING, N/A, UNKNOWN) and rationale
        canonical_status, status_reason, has_sufficient_data = self.determine_status(
            signal=signal,
            is_applicable=is_applicable,
            context=app_context,
        )

        # 3. Formulate complete decision record
        decision = ApplicabilityDecision(
            rule_id=signal.rule_id,
            status=canonical_status.value,
            is_applicable=is_applicable,
            applicability_type=app_type.value,
            reason=f"{applicability_reason} {status_reason}".strip(),
            confidence=signal.confidence,
            source_module=signal.source_module,
            evidence_available=has_sufficient_data,
            metadata={
                "evaluated_at": datetime.now(timezone.utc).isoformat(),
                "page_type": app_context.page_type,
                "intent": app_context.intent,
            },
        )

        # 4. Construct updated UnifiedSignal non-mutatively
        updated_metadata = deepcopy(signal.metadata)
        updated_metadata["applicability_decision"] = decision.model_dump()

        return UnifiedSignal(
            rule_id=signal.rule_id,
            status=canonical_status.value,
            value=deepcopy(signal.value),
            evidence=deepcopy(signal.evidence),
            confidence=signal.confidence,
            source_module=signal.source_module,
            applicability=app_type.value,
            title=signal.title,
            description=signal.description,
            category=signal.category,
            severity=signal.severity,
            metadata=updated_metadata,
        )

    def evaluate_signals(
        self,
        signals: list[UnifiedSignal] | AggregatedSignalCollection | UnifiedSignalBatch | Any,
        context: ApplicabilityContext | dict[str, Any] | None = None,
    ) -> list[UnifiedSignal] | AggregatedSignalCollection:
        """
        Batch evaluates applicability across a list of signals or an AggregatedSignalCollection.
        """
        if signals is None:
            return []

        app_context = self._resolve_context(context)

        # Handle AggregatedSignalCollection
        if isinstance(signals, AggregatedSignalCollection):
            evaluated_signals = [self.evaluate_signal(s, context=app_context) for s in signals.signals]
            return AggregatedSignalCollection(
                total_input_signals=signals.total_input_signals,
                total_unique_signals=len(evaluated_signals),
                duplicate_count=signals.duplicate_count,
                conflict_count=signals.conflict_count,
                signals=evaluated_signals,
                source_modules=signals.source_modules,
                categories=signals.categories,
                metadata=deepcopy(signals.metadata),
            )

        # Handle UnifiedSignalBatch
        if isinstance(signals, UnifiedSignalBatch):
            evaluated_signals = [self.evaluate_signal(s, context=app_context) for s in signals.signals]
            return evaluated_signals

        # Handle List of signals
        if isinstance(signals, (list, tuple)):
            results = []
            for item in signals:
                if isinstance(item, UnifiedSignal):
                    results.append(self.evaluate_signal(item, context=app_context))
                else:
                    results.append(item)
            return results

        # Single signal
        if isinstance(signals, UnifiedSignal):
            return [self.evaluate_signal(signals, context=app_context)]

        return []

    def is_rule_applicable(
        self,
        rule_id: str,
        signal: UnifiedSignal | None = None,
        context: ApplicabilityContext | None = None,
    ) -> tuple[bool, str, ApplicabilityType]:
        """
        Determines if a rule applies to the given page type, intent, and available telemetry.
        Returns: (is_applicable: bool, reason: str, applicability_type: ApplicabilityType)
        """
        if not context:
            context = ApplicabilityContext()

        rule_id_clean = (rule_id or "").strip().lower()
        page_type = (context.page_type or PageType.GENERAL.value).lower()
        intent = (context.intent or "").lower()

        # 1. If signal already has explicit not_applicable from existing Task 5-7 contract
        if signal and signal.applicability == ApplicabilityType.NOT_APPLICABLE.value:
            return False, "Signal was explicitly marked as not applicable by originating module.", ApplicabilityType.NOT_APPLICABLE

        # 2. Authorship, Byline, and Editorial Credentials
        # Inapplicable on: legal privacy pages, contact pages, utility pages
        if any(term in rule_id_clean for term in ("author_credentials", "byline_present", "author_bio", "editorial_credentials")):
            if page_type in (PageType.LEGAL_PRIVACY.value, PageType.CONTACT.value):
                return (
                    False,
                    f"Author credentials and byline rules are not applicable to {page_type.replace('_', ' ')} pages.",
                    ApplicabilityType.NOT_APPLICABLE,
                )

        # 3. Company Contact / Business Identity / Legal Transparency
        # Highly applicable to homepage, about, contact; informational on deep sub-articles
        if any(term in rule_id_clean for term in ("contact_info", "email_present", "phone_present", "address_present")):
            if page_type in (PageType.CONTACT.value, PageType.HOMEPAGE.value, PageType.ABOUT.value):
                return (
                    True,
                    f"Contact and business identity verification is directly applicable to {page_type} pages.",
                    ApplicabilityType.APPLICABLE,
                )

        # 4. Citation Readiness & Claim Verification
        # Inapplicable if page has 0 factual claims asserted
        if any(term in rule_id_clean for term in ("claim_support", "citation_readiness", "source_association")):
            claims_count = context.extracted_data.get("claims_count", 0)
            has_claims_flag = context.available_data.get("has_claims", False)
            if not has_claims_flag and claims_count == 0 and page_type in (PageType.LEGAL_PRIVACY.value, PageType.CONTACT.value):
                return (
                    False,
                    "Citation readiness and claim verification rules are not applicable when no factual claims are asserted.",
                    ApplicabilityType.NOT_APPLICABLE,
                )

        # 5. FAQ & Question Answering Rules
        # Inapplicable on legal privacy or purely navigational pages with 0 questions
        if any(term in rule_id_clean for term in ("question_answering", "content_question", "content_answer", "faq_schema")):
            questions_count = context.extracted_data.get("questions_count", 0)
            has_questions_flag = context.available_data.get("has_questions", False)
            if not has_questions_flag and questions_count == 0 and page_type in (PageType.LEGAL_PRIVACY.value, PageType.CONTACT.value):
                return (
                    False,
                    "FAQ and question-answering rules are not applicable to pages without question or FAQ structures.",
                    ApplicabilityType.NOT_APPLICABLE,
                )

        # 6. E-Commerce / Commercial Transaction Rules
        # Inapplicable on informational blog posts, documentation, and legal policy pages
        if any(term in rule_id_clean for term in ("pricing_transparency", "checkout_policy", "product_availability")):
            if page_type in (PageType.ARTICLE.value, PageType.DOCUMENTATION.value, PageType.LEGAL_PRIVACY.value) and intent == "informational":
                return (
                    False,
                    "Commercial transaction rules are not applicable to informational content and policy documentation.",
                    ApplicabilityType.NOT_APPLICABLE,
                )

        # 7. Structural Document Rules (Headings, Main Content, Word Count)
        # Applicable to almost all document pages
        if any(term in rule_id_clean for term in ("heading_structure", "word_count", "main_content", "r-str-")):
            return (
                True,
                "Structural document quality rules are applicable to standard web documents.",
                ApplicabilityType.APPLICABLE,
            )

        # Default: Applicable
        return True, "Rule applies to the target page context.", ApplicabilityType.APPLICABLE

    def determine_status(
        self,
        signal: UnifiedSignal,
        is_applicable: bool,
        context: ApplicabilityContext,
    ) -> tuple[ApplicabilityStatus, str, bool]:
        """
        Determines the canonical status (PASS, FAIL, WARNING, N/A, UNKNOWN) and explanation.

        Crucial Rule:
        - If not applicable -> N/A
        - If applicable but source data is missing/insufficient -> UNKNOWN (NEVER FAIL!)
        - If applicable with sufficient data:
          - Positive observation -> PASS
          - Cautionary / weak / partial -> WARNING
          - Negative / violated -> FAIL
        """
        # 1. Inapplicable rules are always N/A
        if not is_applicable:
            return (
                ApplicabilityStatus.NA,
                "Rule was marked as N/A because it does not apply to this page type or context.",
                True,
            )

        # 2. Check for missing / insufficient data
        has_sufficient_data, data_reason = self._check_data_sufficiency(signal, context)
        if not has_sufficient_data:
            return (
                ApplicabilityStatus.UNKNOWN,
                f"Insufficient data to evaluate rule: {data_reason}. Status is UNKNOWN (not FAIL).",
                False,
            )

        # 3. If signal was already explicitly marked as unknown / unverified
        raw_status = (signal.status or "").strip().lower()
        if raw_status in ("unknown", "unverified", "indeterminate", "missing_data", "insufficient_data"):
            return (
                ApplicabilityStatus.UNKNOWN,
                "Originating engine reported insufficient evidence to verify this condition.",
                False,
            )

        # 4. Map known passing states -> PASS
        if raw_status in ("pass", "passed", "verified", "detected", "supported", "optimal", "strong"):
            return (
                ApplicabilityStatus.PASS,
                f"Applicable rule passed based on verified evidence ('{raw_status}').",
                True,
            )

        # 5. Map cautionary / partial states -> WARNING
        if raw_status in ("warn", "warning", "partial", "moderate", "adequate", "caution", "weak", "deficient"):
            return (
                ApplicabilityStatus.WARNING,
                f"Applicable rule indicates a partial or cautionary condition ('{raw_status}').",
                True,
            )

        # 6. Map verified negative states -> FAIL
        if raw_status in ("fail", "failed", "missing", "broken", "unsupported", "violated", "open", "in_progress"):
            return (
                ApplicabilityStatus.FAIL,
                f"Applicable rule failed due to verified missing requirement or defect ('{raw_status}').",
                True,
            )

        # 7. Fallback based on value if boolean
        if isinstance(signal.value, bool):
            if signal.value is True:
                return (
                    ApplicabilityStatus.PASS,
                    "Rule passed based on observed positive value.",
                    True,
                )
            else:
                return (
                    ApplicabilityStatus.FAIL,
                    "Rule failed based on observed negative value.",
                    True,
                )

        # 8. Safe default when no definitive evaluation can be derived
        return (
            ApplicabilityStatus.UNKNOWN,
            f"Observed state ('{raw_status}') could not be deterministically resolved; assigned UNKNOWN.",
            True,
        )

    def _check_data_sufficiency(
        self,
        signal: UnifiedSignal,
        context: ApplicabilityContext,
    ) -> tuple[bool, str]:
        """
        Validates whether necessary source data is present to evaluate the signal.
        """
        rule_id_clean = (signal.rule_id or "").strip().lower()
        available = context.available_data

        # If raw HTML is explicitly required for DOM checks but unavailable
        if any(term in rule_id_clean for term in ("r-str-", "heading_structure", "html_integrity", "dom_")):
            if available.get("has_raw_html") is False and available.get("has_text") is False:
                return False, "raw HTML and text content are missing"

        # If main text content is missing for content quality / word count
        if any(term in rule_id_clean for term in ("word_count", "topical_depth", "readability", "content_gap")):
            if available.get("has_text") is False and context.extracted_data.get("word_count", 0) == 0:
                return False, "main body text content is empty or unextracted"

        # If structured data check requires schema extraction
        if "schema" in rule_id_clean and available.get("has_structured_data") is False:
            if not context.extracted_data.get("schema_types"):
                # Note: If structured data extraction was never performed, it's unknown.
                # If extraction was performed and 0 schemas found, it's sufficient data with missing schemas.
                if available.get("has_raw_html") is False:
                    return False, "structured data could not be inspected due to missing HTML"

        return True, "sufficient data available"

    @staticmethod
    def _resolve_context(context: ApplicabilityContext | dict[str, Any] | None) -> ApplicabilityContext:
        """Normalizes user input into an ApplicabilityContext instance."""
        if context is None:
            return ApplicabilityContext()
        if isinstance(context, ApplicabilityContext):
            return context
        if isinstance(context, dict):
            return ApplicabilityContext(**context)
        return ApplicabilityContext()


# Global singleton instance & convenience function
_DEFAULT_APPLICABILITY_ENGINE = ApplicabilityEngine()


def evaluate_applicability(
    signals: list[UnifiedSignal] | AggregatedSignalCollection | Any,
    context: ApplicabilityContext | dict[str, Any] | None = None,
) -> list[UnifiedSignal] | AggregatedSignalCollection:
    """Convenience function to evaluate applicability across signals."""
    return _DEFAULT_APPLICABILITY_ENGINE.evaluate_signals(signals=signals, context=context)
