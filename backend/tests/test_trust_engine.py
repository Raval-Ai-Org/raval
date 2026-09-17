"""
Trust Signal Engine Tests (Day 8 - Phase B - Step 3 ONLY)

Verifies deterministic, evidence-based trust signal detection:
1. identity detected
2. About detected
3. contact detected
4. author/byline detected
5. expertise/credentials detected
6. business identity consistency behavior (consistent vs conflict)
7. policy/transparency detection (privacy, terms, disclosures)
8. missing/weak trust signals handling
9. evidence traceability in all signals
10. no false factual conclusions produced (evidence != conclusion)
11. output compatibility with TrustSignalContract and AuthorityCitationTrustResult
12. integration with Task 4 ExtractionResult and existing Finding/Recommendation models
"""

import pytest

from app.authority_citation_schemas import (
    AuthorityCitationTrustResult,
    ConfidenceLevel,
    TrustSignalContract,
)
from app.page_extractor import extract_html
from app.quality_analyzer import analyze_quality
from app.schemas import FindingCreate, RecommendationCreate
from app.trust_engine import (
    TrustSignalEngine,
    TrustSignalResult,
    analyze_trust_signals,
)


def test_1_identity_detected():
    """Verify detection of organization/business identity from JSON-LD and social metadata."""
    html = """
    <html>
    <head>
        <title>Apex BioTech - Clinical Research</title>
        <meta property="og:site_name" content="Apex BioTech Global">
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "MedicalOrganization",
            "name": "Apex BioTech Laboratories",
            "url": "https://apexbio.com",
            "sameAs": ["https://twitter.com/apexbio", "https://linkedin.com/company/apexbio"]
        }
        </script>
    </head>
    <body>
        <h1>Advancing Cellular Therapeutics</h1>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://apexbio.com/research")
    result = analyze_trust_signals(
        page_url="https://apexbio.com/research",
        title=extraction.title_text,
        text_content=extraction.clean_text,
        structured_data_blocks=extraction.structured_data,
        social_metadata=extraction.social_metadata,
    )

    ident_sigs = [s for s in result.identity_signals if s.signal_id == "trust_org_identity_present"]
    assert len(ident_sigs) == 1
    assert ident_sigs[0].status == "verified"
    assert ident_sigs[0].value["organization_name"] == "Apex BioTech Laboratories"
    assert ident_sigs[0].confidence == ConfidenceLevel.HIGH
    assert "Apex BioTech Laboratories" in str(ident_sigs[0].evidence)


def test_2_about_detected():
    """Verify detection of About page/section from links, headings, and schema."""
    html = """
    <html>
    <body>
        <nav>
            <a href="/about-us">About Our Company</a>
        </nav>
        <h2>Who We Are</h2>
        <p>Founded in 2012, we are dedicated to biotechnology innovation.</p>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://example.com")
    result = analyze_trust_signals(
        page_url="https://example.com",
        links=extraction.links,
        headings=extraction.headings,
        text_content=extraction.clean_text,
    )

    about_sigs = [s for s in result.about_signals if s.signal_id == "trust_about_info_present"]
    assert len(about_sigs) == 1
    assert about_sigs[0].status == "detected"
    assert "/about-us" in about_sigs[0].value["about_url"]
    assert about_sigs[0].value["about_heading"] == "Who We Are"
    assert about_sigs[0].confidence == ConfidenceLevel.HIGH


def test_3_contact_detected():
    """Verify detection of direct contact channels (email, phone, physical address, and contact page)."""
    html = """
    <html>
    <head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "HealthCorp",
            "contactPoint": {
                "@type": "ContactPoint",
                "telephone": "+1-800-555-0199",
                "email": "support@healthcorp.org"
            },
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "500 Medical Center Drive",
                "addressLocality": "Boston",
                "postalCode": "02115"
            }
        }
        </script>
    </head>
    <body>
        <footer>
            <a href="/contact">Contact Support</a>
            <p>Direct Inquiries: support@healthcorp.org | Phone: (617) 555-0144</p>
            <p>Headquarters: 500 Medical Center Drive, Suite 400, Boston MA</p>
        </footer>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://healthcorp.org")
    result = analyze_trust_signals(
        page_url="https://healthcorp.org",
        links=extraction.links,
        text_content=extraction.clean_text,
        structured_data_blocks=extraction.structured_data,
    )

    page_sig = next(s for s in result.contact_signals if s.signal_id == "trust_contact_page_present")
    assert page_sig.status == "detected"
    assert "contact" in page_sig.value["contact_url"]

    chan_sig = next(s for s in result.contact_signals if s.signal_id == "trust_contact_channels_present")
    assert chan_sig.status == "detected"
    assert chan_sig.value["has_email"] is True
    assert chan_sig.value["has_phone"] is True
    assert chan_sig.value["has_address"] is True
    assert "support@healthcorp.org" in chan_sig.evidence["emails"]


def test_4_author_byline_and_profile_detected():
    """Verify author byline extraction and bio/profile linkage detection."""
    html = """
    <html>
    <head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": "Novel Approaches in Immunotherapy",
            "author": {
                "@type": "Person",
                "name": "Dr. Sarah Jenkins",
                "jobTitle": "Principal Immunologist",
                "sameAs": "https://orcid.org/0000-0003-4921-8821",
                "url": "https://medjournal.org/authors/sarah-jenkins"
            }
        }
        </script>
    </head>
    <body>
        <h1>Novel Approaches in Immunotherapy</h1>
        <p class="byline">By Dr. Sarah Jenkins | Published 2025</p>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://medjournal.org/article")
    result = analyze_trust_signals(
        page_url="https://medjournal.org/article",
        text_content=extraction.clean_text,
        structured_data_blocks=extraction.structured_data,
        links=extraction.links,
    )

    byline_sig = next(s for s in result.author_signals if s.signal_id == "trust_author_byline_present")
    assert byline_sig.status == "verified"
    assert byline_sig.value["author_name"] == "Dr. Sarah Jenkins"
    assert byline_sig.value["author_title"] == "Principal Immunologist"

    profile_sig = next(s for s in result.author_signals if s.signal_id == "trust_author_profile_linked")
    assert profile_sig.status == "verified"
    assert profile_sig.value["same_as"] == "https://orcid.org/0000-0003-4921-8821"


def test_5_expertise_and_credentials_detected():
    """Verify explicit credentials (MD, PhD, titles) and formal reviewer attribution."""
    html = """
    <html>
    <body>
        <h1>Cardiovascular Health Guidelines</h1>
        <p>Authored by Professor Marcus Vance, MD, PhD, Chief Medical Officer.</p>
        <p>Medically reviewed by Dr. Elena Rostova on January 15, 2025.</p>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://cardiohealth.org/guidelines")
    result = analyze_trust_signals(
        page_url="https://cardiohealth.org/guidelines",
        text_content=extraction.clean_text,
    )

    cred_sig = next(s for s in result.expertise_signals if s.signal_id == "trust_author_credentials_present")
    assert cred_sig.status == "detected"
    assert any(c in cred_sig.value["credentials"] for c in ["MD", "PhD"])
    assert any(t in cred_sig.value["titles"] for t in ["Professor", "Chief Medical Officer", "Dr."])

    rev_sig = next(s for s in result.expertise_signals if s.signal_id == "trust_expert_review_attribution")
    assert rev_sig.status == "detected"
    assert "Elena Rostova" in rev_sig.value["reviewer_name"]
    assert "medically reviewed by" in rev_sig.value["review_phrase"].lower()


def test_6_business_identity_consistency_verified_and_conflict():
    """Verify business identity consistency checking across schema, OpenGraph, and copyright."""
    engine = TrustSignalEngine()

    # Case A: Aligned Identity
    json_ld_aligned = [{"parsed_json": {"@type": "Organization", "name": "Global Tech Innovations LLC"}}]
    social_aligned = [{"property_name": "og:site_name", "content": "Global Tech Innovations"}]
    text_aligned = "Copyright © 2025 Global Tech Innovations LLC. All rights reserved."

    res_aligned = engine.analyze(
        structured_data_blocks=json_ld_aligned,
        social_metadata=social_aligned,
        text_content=text_aligned,
    )
    cons_sig_a = next(s for s in res_aligned.consistency_signals if s.signal_id == "trust_business_identity_consistency")
    assert cons_sig_a.status == "verified"
    assert cons_sig_a.value["is_consistent"] is True

    # Case B: Conflicting Disparate Identities
    json_ld_conflict = [{"parsed_json": {"@type": "Organization", "name": "Alpha Health Systems"}}]
    social_conflict = [{"property_name": "og:site_name", "content": "Omega Financial Partners"}]
    text_conflict = "Copyright © 2025 Zeta Logistics Corp. All rights reserved."

    res_conflict = engine.analyze(
        structured_data_blocks=json_ld_conflict,
        social_metadata=social_conflict,
        text_content=text_conflict,
    )
    cons_sig_b = next(s for s in res_conflict.consistency_signals if s.signal_id == "trust_business_identity_consistency")
    assert cons_sig_b.value["is_consistent"] is False
    assert len(res_conflict.findings) >= 1
    assert any(f.finding_type == "conflicting_business_identity" for f in res_conflict.findings)


def test_7_policy_and_transparency_detection():
    """Verify detection of privacy policy, terms of service, editorial guidelines, and ownership."""
    html = """
    <html>
    <body>
        <main>
            <p>Our editorial policy mandates rigorous scientific peer review.</p>
            <p>Funding provided by National Science Foundation grant #4092.</p>
        </main>
        <footer>
            <a href="/legal/privacy-policy">Privacy Notice</a>
            <a href="/legal/terms-of-service">Terms of Use</a>
            <a href="/about/editorial-policy">Editorial Guidelines</a>
        </footer>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://sciencereview.org")
    result = analyze_trust_signals(
        page_url="https://sciencereview.org",
        links=extraction.links,
        text_content=extraction.clean_text,
    )

    priv_sig = next(s for s in result.policy_signals if s.signal_id == "trust_privacy_policy_present")
    assert priv_sig.status == "detected"
    assert "privacy-policy" in priv_sig.value["privacy_url"]

    terms_sig = next(s for s in result.policy_signals if s.signal_id == "trust_terms_of_service_present")
    assert terms_sig.status == "detected"
    assert "terms-of-service" in terms_sig.value["terms_url"]

    edit_sig = next(s for s in result.policy_signals if s.signal_id == "trust_editorial_disclosure_present")
    assert edit_sig.status == "detected"

    owner_sig = next(s for s in result.policy_signals if s.signal_id == "trust_ownership_transparency_present")
    assert owner_sig.status == "detected"
    assert "funding provided by" in owner_sig.value["statement"].lower()


def test_8_missing_and_weak_trust_signals():
    """Verify that an anonymous page missing trust signals generates missing statuses and actionable findings."""
    html = """
    <html>
    <body>
        <h1>Quick Blog Post</h1>
        <p>Here is some unverified quick information about gadgets without any author or company details.</p>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://randomblog.com/post1")
    result = analyze_trust_signals(
        page_url="https://randomblog.com/post1",
        text_content=extraction.clean_text,
        links=extraction.links,
        page_id=42,
    )

    assert result.missing_signals_count >= 3
    # Check that privacy, contact, and author are marked missing
    assert any(s.signal_id == "trust_privacy_policy_present" and s.status == "missing" for s in result.trust_signals)
    assert any(s.signal_id == "trust_contact_page_present" and s.status == "missing" for s in result.trust_signals)
    assert any(s.signal_id == "trust_author_byline_present" and s.status == "missing" for s in result.trust_signals)

    # Check actionable findings and recommendations
    assert len(result.findings) >= 2
    assert any(f.finding_type == "missing_privacy_policy" for f in result.findings)
    assert any(f.finding_type == "missing_contact_information" for f in result.findings)
    assert len(result.recommendations) >= 2


def test_9_evidence_is_traceable():
    """Verify that every detected trust signal provides explicit, traceable evidence dictionary."""
    html = """
    <html>
    <head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Veritas Health Institute",
            "url": "https://veritashealth.org"
        }
        </script>
    </head>
    <body>
        <p>Authored by Dr. Johnathan Reed, MD.</p>
        <a href="/privacy-policy">Privacy Policy</a>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://veritashealth.org")
    result = analyze_trust_signals(
        page_url="https://veritashealth.org",
        text_content=extraction.clean_text,
        structured_data_blocks=extraction.structured_data,
        links=extraction.links,
    )

    for signal in result.trust_signals:
        if signal.status in ("detected", "verified"):
            assert signal.evidence is not None, f"Signal {signal.signal_id} missing evidence"
            assert isinstance(signal.evidence, (dict, list)), f"Signal {signal.signal_id} evidence must be dict or list"


def test_10_no_false_factual_conclusions_produced():
    """
    Verify core rule: Evidence != Conclusion.
    The engine reports observed structural signals and does NOT evaluate factual truth.
    """
    text = "We invented cold fusion in our garage with 100% efficiency."
    result = analyze_trust_signals(
        page_url="https://garage-science.com",
        text_content=text,
    )

    dumped = result.model_dump()
    # Ensure no fact-checking conclusions or veracity judgements are generated
    assert "fact_check" not in dumped
    assert "truth_value" not in dumped
    assert "is_factual" not in dumped


def test_11_output_is_compatible_with_step2_contracts():
    """Verify that TrustSignalResult signals strictly conform to TrustSignalContract and integrate into AuthorityCitationTrustResult."""
    engine = TrustSignalEngine()
    result = engine.analyze(
        page_url="https://example.com",
        text_content="Authored by Dr. Alice Smith | Copyright © 2025 Acme Corp.",
        links=[{"destination_url": "https://example.com/privacy", "anchor_text": "Privacy"}],
    )

    assert isinstance(result, TrustSignalResult)
    for sig in result.trust_signals:
        assert isinstance(sig, TrustSignalContract)

    # Validate integration with top-level AuthorityCitationTrustResult
    top_level = AuthorityCitationTrustResult(
        page_id=1,
        url="https://example.com",
        trust_signals=result.trust_signals,
        findings=result.findings,
        recommendations=result.recommendations,
    )
    assert len(top_level.trust_signals) == result.total_signals
    assert len(top_level.findings) == len(result.findings)

    # Verify JSON round-trip
    json_bytes = top_level.model_dump_json()
    reconstructed = AuthorityCitationTrustResult.model_validate_json(json_bytes)
    assert len(reconstructed.trust_signals) == result.total_signals


def test_12_analyze_extraction_integration():
    """Verify direct integration with Task 4 ExtractionResult and Task 5 QualityAnalysisEvidence."""
    html = """
    <html>
    <head>
        <title>Quantum Sensors Inc</title>
        <meta property="og:site_name" content="Quantum Sensors">
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Quantum Sensors Inc"
        }
        </script>
    </head>
    <body>
        <h1>Quantum Metrology Breakthrough</h1>
        <p>Authored by Dr. Robert Chang, Lead Researcher at Quantum Sensors Inc.</p>
        <p>According to our 2024 laboratory trials, measurement precision increased by 45.8%.</p>
        <footer>
            <a href="/privacy">Privacy</a>
            <a href="/contact">Contact</a>
            <p>Copyright © 2025 Quantum Sensors Inc. All rights reserved.</p>
        </footer>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://quantumsensors.com/research")
    quality = analyze_quality(
        text_content=extraction.clean_text,
        links=[{"destination_url": l.destination_url} for l in extraction.links],
    )

    engine = TrustSignalEngine()
    result = engine.analyze_extraction(
        extraction=extraction,
        page_url="https://quantumsensors.com/research",
        page_id=99,
        quality_evidence=quality,
    )

    assert result.page_id == 99
    assert result.detected_signals_count >= 5
    # Check claim context attribution signal
    claim_sig = next((s for s in result.claim_context_signals if s.signal_id == "trust_claim_context_attribution"), None)
    assert claim_sig is not None
    assert claim_sig.status == "detected"
    assert claim_sig.value["has_contextual_attribution"] is True
