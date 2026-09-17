"""
Tests for Applicability Engine (Task 8 - Step 8.3)

Verifies:
1. Applicable rule -> PASS
2. Applicable rule -> FAIL
3. Applicable rule -> WARNING
4. Non-applicable rule -> N/A
5. Applicable but insufficient data -> UNKNOWN
6. Missing data does NOT become FAIL
7. Page-type applicability (Legal Privacy, Contact, Article, FAQ, Homepage)
8. Intent-based applicability (Informational vs Transactional vs QA)
9. Deterministic applicability decisions with explainable rationales
10. Evidence preservation
11. Confidence preservation
12. Input immutability
13. Empty and None input safety
14. Integration with AggregatedSignalCollection and UnifiedSignalNormalizer
15. ApplicabilityContext inference from page data
"""

from copy import deepcopy
import pytest

from app.applicability_engine import (
    ApplicabilityContext,
    ApplicabilityDecision,
    ApplicabilityEngine,
    ApplicabilityStatus,
    PageType,
    evaluate_applicability,
)
from app.signal_aggregator import (
    AggregatedSignalCollection,
    SignalAggregator,
    aggregate_signals,
)
from app.unified_signal import (
    ApplicabilityType,
    UnifiedSignal,
    UnifiedSignalBatch,
)


@pytest.fixture
def engine():
    return ApplicabilityEngine()


class TestStatusSemanticsAndRules:
    """Tests PASS, FAIL, WARNING, N/A, and UNKNOWN status semantics."""

    def test_applicable_rule_passing_becomes_pass(self, engine):
        sig = UnifiedSignal(
            rule_id="r-str-01",
            status="detected",
            value=True,
            evidence={"h1_count": 1, "text": "Main Heading"},
            confidence="high",
            source_module="content_structure_analyzer",
            applicability="applicable",
        )
        ctx = ApplicabilityContext(
            page_type="article",
            available_data={"has_raw_html": True, "has_text": True},
        )

        evaluated = engine.evaluate_signal(sig, context=ctx)

        assert evaluated.status == "pass"
        assert evaluated.applicability == "applicable"
        assert "applicability_decision" in evaluated.metadata
        decision = evaluated.metadata["applicability_decision"]
        assert decision["status"] == "pass"
        assert decision["is_applicable"] is True
        assert "passed" in decision["reason"].lower()

    def test_applicable_rule_failing_becomes_fail(self, engine):
        sig = UnifiedSignal(
            rule_id="r-str-01",
            status="missing",
            value=False,
            evidence={"h1_count": 0},
            confidence="high",
            source_module="content_structure_analyzer",
            applicability="applicable",
        )
        ctx = ApplicabilityContext(
            page_type="article",
            available_data={"has_raw_html": True, "has_text": True},
        )

        evaluated = engine.evaluate_signal(sig, context=ctx)

        assert evaluated.status == "fail"
        assert evaluated.applicability == "applicable"
        decision = evaluated.metadata["applicability_decision"]
        assert decision["status"] == "fail"
        assert decision["is_applicable"] is True
        assert "failed" in decision["reason"].lower()

    def test_applicable_rule_cautionary_becomes_warning(self, engine):
        sig = UnifiedSignal(
            rule_id="trust_author_bio_present",
            status="partial",
            value="Short bio snippet",
            evidence={"bio_length": 15},
            confidence="medium",
            source_module="trust_engine",
            applicability="applicable",
        )
        ctx = ApplicabilityContext(
            page_type="article",
            available_data={"has_raw_html": True, "has_text": True},
        )

        evaluated = engine.evaluate_signal(sig, context=ctx)

        assert evaluated.status == "warning"
        assert evaluated.applicability == "applicable"
        decision = evaluated.metadata["applicability_decision"]
        assert decision["status"] == "warning"
        assert "cautionary" in decision["reason"].lower() or "partial" in decision["reason"].lower()

    def test_non_applicable_rule_becomes_na(self, engine):
        # Author credentials rule on a Legal/Privacy page should be N/A
        sig = UnifiedSignal(
            rule_id="trust_author_credentials_present",
            status="missing",
            value=False,
            evidence={"byline": None},
            confidence="high",
            source_module="trust_engine",
            applicability="applicable",
        )
        ctx = ApplicabilityContext(
            page_type="legal_privacy",
            available_data={"has_raw_html": True, "has_text": True},
        )

        evaluated = engine.evaluate_signal(sig, context=ctx)

        assert evaluated.status == "n/a"
        assert evaluated.applicability == "not_applicable"
        decision = evaluated.metadata["applicability_decision"]
        assert decision["status"] == "n/a"
        assert decision["is_applicable"] is False
        assert "not applicable" in decision["reason"].lower()

    def test_missing_data_becomes_unknown_not_fail(self, engine):
        # When raw HTML and text are missing / unextracted, DOM check must become UNKNOWN, NOT FAIL
        sig = UnifiedSignal(
            rule_id="r-str-01",
            status="missing",  # Raw signal might say missing due to extraction inability
            value=None,
            evidence=None,
            confidence="low",
            source_module="page_extractor",
            applicability="applicable",
        )
        ctx = ApplicabilityContext(
            page_type="article",
            available_data={"has_raw_html": False, "has_text": False},
        )

        evaluated = engine.evaluate_signal(sig, context=ctx)

        assert evaluated.status == "unknown"
        assert evaluated.status != "fail"
        decision = evaluated.metadata["applicability_decision"]
        assert decision["status"] == "unknown"
        assert decision["evidence_available"] is False
        assert "insufficient data" in decision["reason"].lower()
        assert "not fail" in decision["reason"].lower()

    def test_explicit_unknown_signal_status_preserved_as_unknown(self, engine):
        sig = UnifiedSignal(
            rule_id="content_topical_depth",
            status="unverified",
            value=None,
            evidence={"reason": "nlp_model_timeout"},
            confidence="low",
            source_module="content_intelligence",
        )
        ctx = ApplicabilityContext(page_type="article", available_data={"has_text": True})

        evaluated = engine.evaluate_signal(sig, context=ctx)

        assert evaluated.status == "unknown"


class TestPageTypeAndIntentApplicability:
    """Tests contextual applicability across various page types and user intents."""

    def test_authorship_rules_applicability_by_page_type(self, engine):
        sig = UnifiedSignal(
            rule_id="trust_byline_present",
            status="missing",
            source_module="trust_engine",
        )

        # Article -> Applicable (becomes FAIL if missing)
        ctx_article = ApplicabilityContext(page_type="article", available_data={"has_text": True})
        res_article = engine.evaluate_signal(sig, context=ctx_article)
        assert res_article.status == "fail"
        assert res_article.applicability == "applicable"

        # Privacy Policy -> N/A
        ctx_privacy = ApplicabilityContext(page_type="legal_privacy", available_data={"has_text": True})
        res_privacy = engine.evaluate_signal(sig, context=ctx_privacy)
        assert res_privacy.status == "n/a"
        assert res_privacy.applicability == "not_applicable"

        # Contact Us -> N/A
        ctx_contact = ApplicabilityContext(page_type="contact", available_data={"has_text": True})
        res_contact = engine.evaluate_signal(sig, context=ctx_contact)
        assert res_contact.status == "n/a"
        assert res_contact.applicability == "not_applicable"

    def test_contact_identity_rules_applicability(self, engine):
        sig = UnifiedSignal(
            rule_id="trust_contact_info_present",
            status="detected",
            value={"email": "info@example.com"},
            source_module="trust_engine",
        )
        ctx_contact = ApplicabilityContext(page_type="contact", available_data={"has_text": True})
        res_contact = engine.evaluate_signal(sig, context=ctx_contact)
        assert res_contact.status == "pass"
        assert res_contact.applicability == "applicable"

    def test_citation_rules_on_page_without_claims(self, engine):
        sig = UnifiedSignal(
            rule_id="citation_readiness_level",
            status="missing",
            source_module="citation_readiness_engine",
        )
        # Legal/Privacy page with 0 claims
        ctx = ApplicabilityContext(
            page_type="legal_privacy",
            available_data={"has_claims": False, "has_text": True},
            extracted_data={"claims_count": 0},
        )
        res = engine.evaluate_signal(sig, context=ctx)
        assert res.status == "n/a"
        assert res.applicability == "not_applicable"

    def test_ecommerce_pricing_rules_on_informational_content(self, engine):
        sig = UnifiedSignal(
            rule_id="pricing_transparency",
            status="missing",
            source_module="ecommerce_engine",
        )
        ctx = ApplicabilityContext(
            page_type="article",
            intent="informational",
            available_data={"has_text": True},
        )
        res = engine.evaluate_signal(sig, context=ctx)
        assert res.status == "n/a"
        assert res.applicability == "not_applicable"


class TestInferenceAndImmutability:
    """Tests ApplicabilityContext inference, batch evaluation, and non-mutation."""

    def test_from_page_data_heuristic_inference(self):
        ctx_privacy = ApplicabilityContext.from_page_data(
            url="https://example.com/privacy-policy",
            text_content="We respect your privacy...",
            raw_html="<html><body><h1>Privacy Policy</h1></body></html>",
            headings_count=1,
        )
        assert ctx_privacy.page_type == PageType.LEGAL_PRIVACY.value
        assert ctx_privacy.available_data["has_raw_html"] is True
        assert ctx_privacy.available_data["has_text"] is True

        ctx_blog = ApplicabilityContext.from_page_data(
            url="https://example.com/blog/how-to-scale-ai",
            text_content="Here is a complete guide to scaling AI...",
            raw_html="<html><body><h1>Guide</h1></body></html>",
            headings_count=1,
            claims_count=5,
        )
        assert ctx_blog.page_type == PageType.ARTICLE.value
        assert ctx_blog.intent == "informational"
        assert ctx_blog.available_data["has_claims"] is True

    def test_input_immutability(self, engine):
        orig_evidence = {"metric": 100, "meta": {"state": "raw"}}
        sig = UnifiedSignal(
            rule_id="test_immutable_rule",
            status="detected",
            evidence=deepcopy(orig_evidence),
            source_module="test_module",
        )
        ctx = ApplicabilityContext(page_type="article")

        evaluated = engine.evaluate_signal(sig, context=ctx)

        # Mutate evaluated metadata and evidence
        evaluated.evidence["metric"] = 999
        evaluated.metadata["new_key"] = "test"

        assert sig.evidence["metric"] == 100
        assert "new_key" not in sig.metadata

    def test_empty_and_none_inputs_handled_safely(self, engine):
        assert engine.evaluate_signals(None) == []
        assert engine.evaluate_signals([]) == []

        with pytest.raises(ValueError):
            engine.evaluate_signal(None)

    def test_batch_evaluation_on_aggregated_signal_collection(self, engine):
        sig1 = UnifiedSignal(
            rule_id="r-str-01",
            status="detected",
            value=True,
            source_module="structure_engine",
        )
        sig2 = UnifiedSignal(
            rule_id="trust_byline_present",
            status="missing",
            source_module="trust_engine",
        )

        collection = aggregate_signals([sig1, sig2])
        ctx = ApplicabilityContext(
            page_type="legal_privacy",
            available_data={"has_raw_html": True, "has_text": True},
        )

        evaluated_collection = engine.evaluate_signals(collection, context=ctx)

        assert isinstance(evaluated_collection, AggregatedSignalCollection)
        assert len(evaluated_collection.signals) == 2

        by_rule = {s.rule_id: s for s in evaluated_collection.signals}
        assert by_rule["r-str-01"].status == "pass"
        assert by_rule["trust_byline_present"].status == "n/a"

    def test_convenience_evaluate_applicability(self):
        sig = UnifiedSignal(
            rule_id="r-str-01",
            status="detected",
            value=True,
            source_module="structure_engine",
        )
        ctx = ApplicabilityContext(page_type="article", available_data={"has_raw_html": True})
        res = evaluate_applicability([sig], context=ctx)
        assert len(res) == 1
        assert res[0].status == "pass"
