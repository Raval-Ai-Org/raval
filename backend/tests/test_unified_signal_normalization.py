"""
Tests for Unified Signal Normalization (Task 8 - Step 8.2)

Verifies:
1. Valid existing signals can be normalized.
2. rule_id is preserved correctly.
3. status is preserved/mapped deterministically.
4. value is preserved across diverse data types.
5. Evidence is preserved without converting evidence into conclusions.
6. Confidence is preserved when available with documented fallbacks.
7. Source module is correctly identified.
8. Applicability is explicitly represented.
9. Missing optional source information is handled safely.
10. Malformed/unsupported input fails safely and predictably.
11. Normalization does not mutate the original source object.
12. Multi-engine batch normalization works seamlessly.
"""

from copy import deepcopy
import pytest

from app.authority_citation_schemas import (
    AuthorityCitationTrustResult,
    AuthoritySignalContract,
    CitationReadinessContract,
    ConfidenceLevel,
    ExternalSourceContract,
    SeverityLevel,
    SourceAssociationContract,
    SupportNeededClaimContract,
    TrustSignalContract,
)
from app.authority_engine import AuthoritySignalEngine, AuthoritySignalResult
from app.citation_readiness_engine import CitationReadinessResult
from app.claim_support_engine import ClaimSupportResult
from app.content_gap_analyzer import ContentGapEvidence, ContentGapItem
from app.content_intelligence_analyzer import ContentIntelligenceSummary
from app.content_quality_checks import ContentQualityChecksResult, QualityCheckItem
from app.content_structure_analyzer import ContentStructureEvidence
from app.entity_analyzer import EntityAnalysisEvidence
from app.intent_analyzer import IntentAnalysisEvidence
from app.quality_analyzer import QualityAnalysisEvidence
from app.question_analyzer import QuestionAnalysisEvidence
from app.answer_analyzer import AnswerAnalysisEvidence
from app.readiness_analyzer import AnswerReadinessEvidence
from app.schemas import FindingCreate, FindingResponse
from app.semantic_coverage_analyzer import SemanticCoverageEvidence
from app.source_engine import ExternalSourceResult, ExternalSourceEngine
from app.source_quality_engine import SourceQualityAssessment, SourceQualityResult
from app.topic_analyzer import TopicAnalysisEvidence
from app.transparency_engine import FirstPartyTransparencyResult
from app.trust_engine import TrustSignalEngine, TrustSignalResult
from app.unified_signal import (
    ApplicabilityType,
    UnifiedSignal,
    UnifiedSignalBatch,
    UnifiedSignalNormalizer,
    normalize_signal,
    normalize_signals,
)


@pytest.fixture
def normalizer():
    return UnifiedSignalNormalizer()


class TestUnifiedSignalContract:
    """Tests core contract schema, field validations, and types."""

    def test_minimal_unified_signal(self):
        sig = UnifiedSignal(
            rule_id="trust_author_credentials_present",
            status="detected",
            value=True,
            evidence={"author": "Dr. Jane Doe"},
            confidence="high",
            source_module="trust_engine",
            applicability="applicable",
        )
        assert sig.rule_id == "trust_author_credentials_present"
        assert sig.status == "detected"
        assert sig.value is True
        assert sig.evidence == {"author": "Dr. Jane Doe"}
        assert sig.confidence == "high"
        assert sig.source_module == "trust_engine"
        assert sig.applicability == "applicable"

    def test_empty_rule_id_raises_validation_error(self):
        with pytest.raises(ValueError, match="rule_id cannot be empty"):
            UnifiedSignal(
                rule_id="",
                status="detected",
                value=None,
                evidence=None,
                confidence="high",
                source_module="trust_engine",
                applicability="applicable",
            )

    def test_confidence_validation_and_numeric_mapping(self):
        sig1 = UnifiedSignal(
            rule_id="test_rule",
            status="detected",
            confidence=0.85,
            source_module="test_mod",
        )
        assert sig1.confidence == "high"

        sig2 = UnifiedSignal(
            rule_id="test_rule",
            status="detected",
            confidence=0.55,
            source_module="test_mod",
        )
        assert sig2.confidence == "medium"

        sig3 = UnifiedSignal(
            rule_id="test_rule",
            status="detected",
            confidence=0.20,
            source_module="test_mod",
        )
        assert sig3.confidence == "low"

    def test_applicability_alias_handling(self):
        sig = UnifiedSignal(
            rule_id="test_rule",
            status="detected",
            source_module="test_mod",
            applicability="n/a",
        )
        assert sig.applicability == "not_applicable"

        sig2 = UnifiedSignal(
            rule_id="test_rule",
            status="detected",
            source_module="test_mod",
            applicability="conditional",
        )
        assert sig2.applicability == "conditional"


class TestTask7SignalNormalization:
    """Tests normalization of Task 7 contracts (Trust, Authority, Citation, Claims, Sources)."""

    def test_normalize_trust_signal_contract(self, normalizer):
        trust_sig = TrustSignalContract(
            signal_id="trust_author_credentials_present",
            category="authorship",
            title="Author Credentials Verified",
            status="detected",
            value=True,
            confidence=ConfidenceLevel.HIGH,
            description="Verified Ph.D. credentials in author byline",
            evidence={"byline": "By Dr. Jane Doe, Ph.D.", "degree": "Ph.D."},
        )
        
        normalized = normalizer.normalize_trust_signal(trust_sig)
        
        assert isinstance(normalized, UnifiedSignal)
        assert normalized.rule_id == "trust_author_credentials_present"
        assert normalized.status == "detected"
        assert normalized.value is True
        assert normalized.evidence == {"byline": "By Dr. Jane Doe, Ph.D.", "degree": "Ph.D."}
        assert normalized.confidence == "high"
        assert normalized.source_module == "trust_engine"
        assert normalized.applicability == "applicable"
        assert normalized.category == "authorship"
        assert normalized.title == "Author Credentials Verified"

    def test_normalize_authority_signal_contract(self, normalizer):
        auth_sig = AuthoritySignalContract(
            signal_id="authority_topical_depth",
            category="topical_depth",
            title="Topical Depth Evaluation",
            status="verified",
            value={"word_count": 1250, "depth": "deep"},
            confidence=ConfidenceLevel.HIGH,
            description="Substantive multi-section treatment",
            evidence={"h2_count": 6, "word_count": 1250},
        )

        normalized = normalizer.normalize_authority_signal(auth_sig)

        assert normalized.rule_id == "authority_topical_depth"
        assert normalized.status == "verified"
        assert normalized.value == {"word_count": 1250, "depth": "deep"}
        assert normalized.evidence == {"h2_count": 6, "word_count": 1250}
        assert normalized.confidence == "high"
        assert normalized.source_module == "authority_engine"
        assert normalized.applicability == "applicable"

    def test_normalize_external_source_contract(self, normalizer):
        source = ExternalSourceContract(
            url="https://doi.org/10.1038/s41586-024-0001",
            domain="doi.org",
            anchor_text="Nature 2024 Study",
            context_text="As reported in the Nature 2024 Study on renewable catalysts",
            link_type="citation",
            is_accessible=True,
            status_code=200,
            availability_status="valid",
            is_citation_candidate=True,
            evidence={"dom_selector": "article > p:nth-child(2) > a"},
        )

        normalized = normalizer.normalize_external_source(source)

        assert normalized.rule_id == "source_external_link_detected"
        assert normalized.status == "valid"
        assert normalized.value["url"] == "https://doi.org/10.1038/s41586-024-0001"
        assert normalized.value["is_citation_candidate"] is True
        assert normalized.evidence["dom_selector"] == "article > p:nth-child(2) > a"
        assert normalized.source_module == "source_engine"

    def test_normalize_support_needed_claim_contract(self, normalizer):
        claim = SupportNeededClaimContract(
            claim_id="claim_stat_01",
            claim_text="Solar efficiency improved by 34.5% in laboratory tests.",
            claim_type="statistical",
            location="Section 2, Paragraph 1",
            reason="Contains explicit percentage metric requiring empirical citation",
            confidence=ConfidenceLevel.MEDIUM,
            has_associated_source=True,
            associated_source_urls=["https://nrel.gov/research/efficiency"],
            evidence={"metric": "34.5%", "sentence_index": 3},
        )

        normalized = normalizer.normalize_claim(claim)

        assert normalized.rule_id == "claim_support_statistical"
        assert normalized.status == "supported"
        assert normalized.value == "Solar efficiency improved by 34.5% in laboratory tests."
        assert normalized.evidence["metric"] == "34.5%"
        assert normalized.confidence == "medium"
        assert normalized.source_module == "claim_support_engine"

    def test_normalize_source_association_contract(self, normalizer):
        assoc = SourceAssociationContract(
            association_id="assoc_01",
            claim_id="claim_stat_01",
            claim_text="Solar efficiency improved by 34.5%",
            source_url="https://nrel.gov/research/efficiency",
            source_domain="nrel.gov",
            association_type="in_text_link",
            confidence=ConfidenceLevel.HIGH,
            explanation="Direct hyperlink attached to the percentage metric",
            evidence={"distance_chars": 12},
        )

        normalized = normalizer.normalize_source_association(assoc)

        assert normalized.rule_id == "source_association_in_text_link"
        assert normalized.status == "associated"
        assert normalized.value["source_url"] == "https://nrel.gov/research/efficiency"
        assert normalized.evidence["distance_chars"] == 12
        assert normalized.source_module == "claim_support_engine"

    def test_normalize_source_quality_assessment(self, normalizer):
        assessment = SourceQualityAssessment(
            url="https://doi.org/10.1038/s41586-024-0001",
            domain="doi.org",
            anchor_text="DOI Reference",
            quality_tier="high",
            is_primary_source=True,
            primary_source_type="doi",
            is_accessible=True,
            anchor_quality="descriptive",
            issues=[],
            evidence={"doi_prefix": "10.1038"},
        )

        normalized = normalizer.normalize_source_quality_assessment(assessment)

        assert normalized.rule_id == "source_quality_assessment"
        assert normalized.status == "high"
        assert normalized.value["is_primary_source"] is True
        assert normalized.value["quality_tier"] == "high"
        assert normalized.source_module == "source_quality_engine"

    def test_normalize_citation_readiness_contract(self, normalizer):
        readiness = CitationReadinessContract(
            readiness_level="high",
            has_verifiable_sources=True,
            total_external_sources=5,
            total_claims_detected=4,
            supported_claims_count=4,
            unsupported_claims_count=0,
            positive_signals=["5 primary sources detected", "100% claim coverage"],
            negative_signals=[],
            structural_indicators={"has_doi": True},
        )

        signals = normalizer.normalize_citation_readiness_contract(readiness)

        assert len(signals) == 3
        rule_ids = [s.rule_id for s in signals]
        assert "citation_readiness_level" in rule_ids
        assert "citation_has_verifiable_sources" in rule_ids
        assert "citation_claim_support_coverage" in rule_ids

        level_sig = next(s for s in signals if s.rule_id == "citation_readiness_level")
        assert level_sig.status == "high"
        assert level_sig.value == "high"
        assert level_sig.source_module == "citation_readiness_engine"


class TestTask5ContentIntelligenceNormalization:
    """Tests normalization of Task 5 Content Intelligence and sub-analyzer outputs."""

    def test_normalize_content_intelligence_summary(self, normalizer):
        summary = ContentIntelligenceSummary(
            page_id=1,
            url="https://example.com/ai-safety",
            title="AI Safety Guide",
            overall_content_score=0.82,
            content_status="optimal",
            word_count=850,
            reading_time_minutes=4.25,
            primary_topic="artificial intelligence safety",
            primary_intent="informational",
            intent_confidence=0.92,
            answer_readiness_score=0.88,
            answer_readiness_level="high",
            evidence_quality_score=0.78,
            evidence_strength="strong",
            semantic_coverage_score=0.85,
            semantic_breadth_level="broad",
            total_questions=3,
            answered_questions=3,
            unanswered_questions=0,
            total_gaps=0,
            entity_count=12,
            key_strengths=["High answer readiness", "Strong empirical evidence"],
            critical_issues=[],
            findings=[
                {
                    "type": "strong_empirical_evidence",
                    "severity": "info",
                    "title": "Empirical Evidence Detected",
                    "description": "Strong metric density",
                    "evidence": {"data_points": 5},
                }
            ],
        )

        signals = normalizer.normalize_content_intelligence_summary(summary)

        assert len(signals) >= 8
        rule_map = {s.rule_id: s for s in signals}

        assert "content_word_count" in rule_map
        assert rule_map["content_word_count"].value == 850
        assert rule_map["content_word_count"].status == "adequate"

        assert "content_primary_topic" in rule_map
        assert rule_map["content_primary_topic"].value == "artificial intelligence safety"

        assert "content_search_intent" in rule_map
        assert rule_map["content_search_intent"].value == "informational"
        assert rule_map["content_search_intent"].confidence == "high"

        assert "content_answer_readiness" in rule_map
        assert rule_map["content_answer_readiness"].value == 0.88
        assert rule_map["content_answer_readiness"].status == "high"

        assert "content_evidence_quality" in rule_map
        assert rule_map["content_evidence_quality"].value == 0.78
        assert rule_map["content_evidence_quality"].status == "strong"

        assert "content_overall_score" in rule_map
        assert rule_map["content_overall_score"].value == 0.82
        assert rule_map["content_overall_score"].status == "optimal"

        assert "strong_empirical_evidence" in rule_map
        assert rule_map["strong_empirical_evidence"].source_module == "content_intelligence_analyzer"

    def test_normalize_quality_evidence(self, normalizer):
        quality = QualityAnalysisEvidence(
            has_quantitative_evidence=True,
            data_points_count=4,
            citations_count=2,
            attributions_count=1,
            unsupported_claims_count=0,
            evidence_strength="strong",
            quality_score=0.85,
            data_points=["45%", "$10M"],
            findings=[],
        )

        signals = normalizer.normalize_quality_evidence(quality)
        rule_map = {s.rule_id: s for s in signals}

        assert "quality_evidence_score" in rule_map
        assert rule_map["quality_evidence_score"].value == 0.85
        assert rule_map["quality_evidence_score"].source_module == "quality_analyzer"

        assert "quality_quantitative_data_points" in rule_map
        assert rule_map["quality_quantitative_data_points"].value == 4

    def test_normalize_topic_evidence(self, normalizer):
        topic = TopicAnalysisEvidence(
            primary_topic="neural network optimization",
            primary_topic_confidence=0.88,
            supporting_topics=["gradient descent", "backpropagation"],
            lexical_diversity=0.42,
            semantic_depth="deep",
            primary_topic_in_title=True,
            primary_topic_in_h1=True,
        )

        signals = normalizer.normalize_topic_evidence(topic)
        rule_map = {s.rule_id: s for s in signals}

        assert "topic_primary_topic" in rule_map
        assert rule_map["topic_primary_topic"].value == "neural network optimization"
        assert rule_map["topic_primary_topic"].source_module == "topic_analyzer"

        assert "topic_lexical_diversity" in rule_map
        assert rule_map["topic_lexical_diversity"].value == 0.42

    def test_normalize_content_gap_item_and_evidence(self, normalizer):
        gap = ContentGapItem(
            gap_type="unanswered_question",
            title="Unanswered Question Heading: How Does It Work?",
            missing_element="Explanation of mechanism",
            why_it_matters="Direct answers are required for snippet citation",
            severity="high",
            recommended_action="Add 2 sentences explaining mechanism",
            evidence={"heading": "How Does It Work?", "section_length": 0},
        )

        gap_sig = normalizer.normalize_gap_item(gap)
        assert gap_sig.rule_id == "content_gap_unanswered_question"
        assert gap_sig.status == "detected"
        assert gap_sig.value == "Explanation of mechanism"
        assert gap_sig.source_module == "content_gap_analyzer"
        assert gap_sig.severity == "high"

        gap_ev = ContentGapEvidence(
            total_gaps=1,
            unanswered_question_gaps_count=1,
            gaps=[gap.to_dict() if hasattr(gap, "to_dict") else gap],
        )
        signals = normalizer.normalize_gap_evidence(gap_ev)
        assert len(signals) >= 2

    def test_normalize_quality_checks_result(self, normalizer):
        checks = ContentQualityChecksResult(
            is_valid_content=True,
            total_checks=2,
            passed_checks=2,
            failed_checks=0,
            warning_checks=0,
            checks=[
                QualityCheckItem(
                    check_name="empty_content",
                    status="pass",
                    title="Content Present",
                    description="Extractable text present",
                    evidence={"text_length": 500},
                ),
                QualityCheckItem(
                    check_name="html_integrity",
                    status="pass",
                    title="Valid HTML",
                    description="Standard tags present",
                    evidence={"has_body": True},
                ),
            ],
        )

        signals = normalizer.normalize_quality_checks_result(checks)
        assert len(signals) == 2
        assert signals[0].rule_id == "quality_check_empty_content"
        assert signals[0].status == "pass"
        assert signals[0].value is True
        assert signals[0].source_module == "content_quality_checks"


class TestFindingsAndModelNormalization:
    """Tests normalization of Finding models and dictionaries."""

    def test_normalize_finding_create_model(self, normalizer):
        fc = FindingCreate(
            finding_type="R-STR-01",
            category="structure",
            title="Missing H1 Heading",
            description="Page lacks an H1 heading",
            severity="high",
            status="open",
            evidence={"h1_count": 0},
        )

        normalized = normalizer.normalize_finding(fc)
        assert normalized.rule_id == "R-STR-01"
        assert normalized.status == "open"
        assert normalized.category == "structure"
        assert normalized.severity == "high"
        assert normalized.evidence == {"h1_count": 0}

    def test_normalize_finding_dict(self, normalizer):
        finding_dict = {
            "type": "unsupported_superlative_claims",
            "severity": "medium",
            "title": "Unsupported Superlative Claim Detected",
            "description": "Claims 'best in the world' without citation",
            "evidence": {"superlative": "best in the world"},
        }

        normalized = normalizer.normalize_finding(finding_dict, source_module="quality_analyzer")
        assert normalized.rule_id == "unsupported_superlative_claims"
        assert normalized.status == "open"
        assert normalized.source_module == "quality_analyzer"
        assert normalized.evidence == {"superlative": "best in the world"}


class TestSafetyDefensivenessAndImmutability:
    """Tests non-mutation, safe fallback on missing/malformed inputs, and batch normalization."""

    def test_normalization_does_not_mutate_source_object(self, normalizer):
        original_evidence = {"key": "val", "nested": {"count": 10}}
        trust_sig = TrustSignalContract(
            signal_id="trust_test_immutability",
            title="Test Immutability",
            status="detected",
            evidence=deepcopy(original_evidence),
        )

        normalized = normalizer.normalize_trust_signal(trust_sig)
        
        # Modify normalized evidence and verify original is untouched
        if isinstance(normalized.evidence, dict):
            normalized.evidence["key"] = "modified_value"
            normalized.evidence["nested"]["count"] = 999

        assert trust_sig.evidence["key"] == "val"
        assert trust_sig.evidence["nested"]["count"] == 10

    def test_missing_optional_information_handled_safely(self, normalizer):
        bare_dict = {"rule_id": "bare_rule", "status": "detected"}
        results = normalizer.normalize(bare_dict)

        assert len(results) == 1
        sig = results[0]
        assert sig.rule_id == "bare_rule"
        assert sig.status == "detected"
        assert sig.value is None
        assert sig.evidence is None
        assert sig.confidence == "high"
        assert sig.source_module == "unknown_module"
        assert sig.applicability == "applicable"

    def test_none_input_returns_empty_list(self, normalizer):
        assert normalizer.normalize(None) == []

    def test_unsupported_type_raises_value_error(self, normalizer):
        with pytest.raises(ValueError, match="Unsupported signal type"):
            # Primitive integer without wrapper
            normalizer.normalize(12345)

    def test_universal_normalize_with_heterogeneous_batch(self):
        items = [
            TrustSignalContract(
                signal_id="trust_email_present",
                title="Email Present",
                status="detected",
                evidence={"email": "info@example.com"},
            ),
            AuthoritySignalContract(
                signal_id="authority_methodology_present",
                title="Methodology Present",
                status="verified",
                evidence={"term": "benchmarking"},
            ),
            {
                "rule_id": "custom_telemetry",
                "status": "pass",
                "value": 42,
                "evidence": {"metric": "latency"},
                "source_module": "performance_engine",
            },
        ]

        batch = normalize_signals(items)

        assert isinstance(batch, UnifiedSignalBatch)
        assert batch.total_signals == 3
        assert len(batch.signals) == 3
        assert "trust_engine" in batch.source_modules
        assert "authority_engine" in batch.source_modules
        assert "performance_engine" in batch.source_modules

    def test_json_serialization_matches_exact_required_contract(self):
        sig = UnifiedSignal(
            rule_id="trust_author_credentials_present",
            status="detected",
            value=True,
            evidence={"byline": "By Dr. Jane Doe", "degree": "Ph.D."},
            confidence="high",
            source_module="trust_engine",
            applicability="applicable",
        )

        data = sig.model_dump()
        assert data["rule_id"] == "trust_author_credentials_present"
        assert data["status"] == "detected"
        assert data["value"] is True
        assert data["evidence"] == {"byline": "By Dr. Jane Doe", "degree": "Ph.D."}
        assert data["confidence"] == "high"
        assert data["source_module"] == "trust_engine"
        assert data["applicability"] == "applicable"


class TestFullEngineResultNormalization:
    """Tests normalization of high-level result envelopes from Task 5 and Task 7 engines."""

    def test_normalize_trust_signal_result(self, normalizer):
        trust_res = TrustSignalResult(
            page_id=10,
            url="https://example.com/about",
            trust_signals=[
                TrustSignalContract(
                    signal_id="trust_contact_email_present",
                    category="contact",
                    title="Contact Email Present",
                    status="detected",
                    value="support@example.com",
                    evidence={"email": "support@example.com"},
                )
            ],
            findings=[
                FindingCreate(
                    finding_type="trust_missing_physical_address",
                    category="trust",
                    title="Missing Physical Address",
                    description="No business address found",
                    severity="low",
                    status="open",
                )
            ],
        )

        signals = normalizer.normalize(trust_res)
        assert len(signals) == 2
        rule_ids = {s.rule_id for s in signals}
        assert "trust_contact_email_present" in rule_ids
        assert "trust_missing_physical_address" in rule_ids

    def test_normalize_authority_signal_result(self, normalizer):
        auth_res = AuthoritySignalResult(
            page_id=12,
            url="https://example.com/research",
            authority_signals=[
                AuthoritySignalContract(
                    signal_id="authority_scholarly_schema_present",
                    category="schema_authority",
                    title="ScholarlyArticle Schema Valid",
                    status="verified",
                    value=True,
                    evidence={"schema_type": "ScholarlyArticle"},
                )
            ],
            findings=[],
        )

        signals = normalizer.normalize(auth_res)
        assert len(signals) == 1
        assert signals[0].rule_id == "authority_scholarly_schema_present"
        assert signals[0].source_module == "authority_engine"

    def test_normalize_external_source_result(self, normalizer):
        src_res = ExternalSourceResult(
            page_id=14,
            url="https://example.com/page",
            sources=[
                ExternalSourceContract(
                    url="https://w3.org/standards",
                    domain="w3.org",
                    anchor_text="W3C Standards",
                    is_citation_candidate=True,
                    evidence={"rel": "noopener"},
                )
            ],
            findings=[],
        )

        signals = normalizer.normalize(src_res)
        assert len(signals) == 1
        assert signals[0].rule_id == "source_external_link_detected"
        assert signals[0].source_module == "source_engine"

    def test_normalize_claim_support_result(self, normalizer):
        claim_res = ClaimSupportResult(
            page_id=15,
            url="https://example.com/page",
            claims=[
                SupportNeededClaimContract(
                    claim_id="claim_01",
                    claim_text="99.9% uptime guaranteed",
                    claim_type="statistical",
                    reason="Statistical assertion requires benchmark",
                    confidence=ConfidenceLevel.HIGH,
                    evidence={"metric": "99.9%"},
                )
            ],
            source_associations=[
                SourceAssociationContract(
                    association_id="assoc_01",
                    claim_id="claim_01",
                    source_url="https://status.example.com",
                    association_type="in_text_link",
                )
            ],
            findings=[],
        )

        signals = normalizer.normalize(claim_res)
        assert len(signals) == 2
        rule_ids = {s.rule_id for s in signals}
        assert "claim_support_statistical" in rule_ids
        assert "source_association_in_text_link" in rule_ids

    def test_normalize_source_quality_result(self, normalizer):
        sq_res = SourceQualityResult(
            page_id=16,
            url="https://example.com/page",
            assessments=[
                SourceQualityAssessment(
                    url="https://cdc.gov/data",
                    domain="cdc.gov",
                    quality_tier="high",
                    is_primary_source=True,
                    evidence={"tld": ".gov"},
                )
            ],
            findings=[],
        )

        signals = normalizer.normalize(sq_res)
        assert len(signals) == 1
        assert signals[0].rule_id == "source_quality_assessment"
        assert signals[0].source_module == "source_quality_engine"

    def test_normalize_first_party_transparency_result(self, normalizer):
        trans_res = FirstPartyTransparencyResult(
            page_id=17,
            url="https://example.com/page",
            transparency_signals=[
                TrustSignalContract(
                    signal_id="transparency_business_identity_consistent",
                    category="business_identity",
                    title="Business Identity Consistent",
                    status="verified",
                    value=True,
                    evidence={"legal_name": "Acme Inc."},
                )
            ],
            findings=[],
        )

        signals = normalizer.normalize(trans_res)
        assert len(signals) == 1
        assert signals[0].rule_id == "transparency_business_identity_consistent"
        assert signals[0].source_module == "transparency_engine"

    def test_normalize_top_level_authority_citation_trust_result(self, normalizer):
        act_res = AuthorityCitationTrustResult(
            page_id=20,
            url="https://example.com/analysis",
            trust_signals=[
                TrustSignalContract(
                    signal_id="trust_byline_present",
                    title="Byline Present",
                    status="detected",
                    evidence={"byline": "Jane Doe"},
                )
            ],
            authority_signals=[
                AuthoritySignalContract(
                    signal_id="authority_expert_review_present",
                    title="Expert Reviewer Attributed",
                    status="detected",
                    evidence={"reviewer": "Dr. Smith"},
                )
            ],
            external_sources=[
                ExternalSourceContract(
                    url="https://doi.org/10.1000/182",
                    domain="doi.org",
                    is_citation_candidate=True,
                )
            ],
            support_needed_claims=[
                SupportNeededClaimContract(
                    claim_id="claim_02",
                    claim_text="Treatment showed 50% improvement",
                    claim_type="statistical",
                    reason="Quantified metric requires primary source",
                )
            ],
            citation_readiness=CitationReadinessContract(
                readiness_level="moderate",
                has_verifiable_sources=True,
                total_external_sources=1,
            ),
        )

        signals = normalizer.normalize(act_res)
        assert len(signals) >= 6
        rule_ids = {s.rule_id for s in signals}
        assert "trust_byline_present" in rule_ids
        assert "authority_expert_review_present" in rule_ids
        assert "source_external_link_detected" in rule_ids
        assert "claim_support_statistical" in rule_ids
        assert "citation_readiness_level" in rule_ids
        assert "citation_has_verifiable_sources" in rule_ids

