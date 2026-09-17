"""
First-Party Transparency Engine Tests (Day 8 - Phase B - Step 8 ONLY)

Verifies deterministic first-party transparency detection, consistency checks, and evidence traceability:
1. Strong first-party disclosures (org in schema, author credentials, domain email, about page, dates)
2. Partial disclosures (author byline only, footer copyright, contact page link)
3. Missing first-party disclosures and finding generation
4. Inconsistency and conflict detection (free webmail on corporate domain)
5. Empty / weak input safety
6. Evidence traceability across all transparency signals
7. Deterministic rule IDs
8. No false factual conclusions (Evidence != Conclusion)
9. Compatibility with Step 2 contracts
"""

import pytest

from app.authority_citation_schemas import (
    AuthorityCitationTrustResult,
    ConfidenceLevel,
    TrustSignalContract,
)
from app.page_extractor import extract_html
from app.transparency_engine import (
    FirstPartyTransparencyEngine,
    FirstPartyTransparencyResult,
    analyze_first_party_transparency,
)


def test_1_strong_first_party_transparency():
    """Verify detection of complete, high-transparency disclosures across schema, bylines, and contact."""
    html = """
    <html>
    <head>
        <title>Quantum Sensors for Navigation</title>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "headline": "Quantum Sensors for Navigation",
            "datePublished": "2024-05-10",
            "dateModified": "2025-01-15",
            "author": {
                "@type": "Person",
                "name": "Dr. Sarah Lin",
                "jobTitle": "Lead Physicist",
                "sameAs": "https://orcid.org/0000-0002-1825-0097"
            },
            "publisher": {
                "@type": "Organization",
                "name": "Quantum Labs Inc."
            }
        }
        </script>
    </head>
    <body>
        <h1>Quantum Sensors for Navigation</h1>
        <p>Authored by Dr. Sarah Lin, Lead Physicist at Quantum Labs Inc.</p>
        <p>Published on: May 10, 2024. Last reviewed: January 15, 2025.</p>
        <p>This research was funded by the National Quantum Initiative grant.</p>

        <footer>
            <a href="https://quantumlabs.org/about">About Quantum Labs</a>
            <a href="https://quantumlabs.org/contact">Contact Us</a>
            <p>Direct inquiries: press@quantumlabs.org or call (415) 555-0199.</p>
            <p>© 2025 Quantum Labs Inc. All rights reserved.</p>
        </footer>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://quantumlabs.org/research/quantum-sensors")
    result = analyze_first_party_transparency(
        page_url="https://quantumlabs.org/research/quantum-sensors",
        text_content=extraction.clean_text,
        links=extraction.links,
        structured_data_blocks=extraction.structured_data,
        page_id=801,
    )

    assert result.page_id == 801
    assert result.is_transparent is True
    assert result.detected_signals_count >= 5
    assert result.missing_signals_count == 0

    assert result.entity_identity["organization_name"] == "Quantum Labs Inc."
    assert result.entity_identity["author_name"] == "Dr. Sarah Lin"
    assert result.entity_identity["contact_email"] == "press@quantumlabs.org"
    assert result.consistency_checks["domain_contact_aligned"] is True
    assert result.consistency_checks["has_conflict"] is False


def test_2_partial_first_party_disclosures():
    """Verify handling of partial disclosures without structured schema."""
    html = """
    <html>
    <body>
        <h1>Solar Inverter Installation Guide</h1>
        <p>Written by Marcus Vance</p>
        <p>For more information, visit our <a href="/about-us">About Us</a> page or our <a href="/contact-us">Contact</a> form.</p>
        <p>© 2024 SunPower Solutions. All rights reserved.</p>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://sunpowersolutions.com/guide")
    result = analyze_first_party_transparency(
        page_url="https://sunpowersolutions.com/guide",
        text_content=extraction.clean_text,
        links=extraction.links,
        structured_data_blocks=extraction.structured_data,
    )

    assert result.detected_signals_count >= 3
    assert result.entity_identity["organization_name"] == "SunPower Solutions"
    assert result.entity_identity["author_name"] == "Marcus Vance"
    assert result.entity_identity["about_url"] is not None


def test_3_missing_transparency_and_finding_generation():
    """Verify that completely anonymous articles with missing identity trigger actionable findings."""
    html = """
    <html>
    <body>
        <h1>Crypto Trading Strategies</h1>
        <p>Follow these 5 tips to guarantee high returns in decentralized finance.</p>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://anonymous-crypto-blog.io/post")
    result = analyze_first_party_transparency(
        page_url="https://anonymous-crypto-blog.io/post",
        text_content=extraction.clean_text,
        links=extraction.links,
        structured_data_blocks=extraction.structured_data,
        page_id=404,
    )

    assert result.is_transparent is False
    assert result.missing_signals_count >= 4
    assert len(result.findings) >= 1
    assert result.findings[0].finding_type == "missing_first_party_transparency"
    assert result.findings[0].severity == "high"
    assert len(result.recommendations) >= 1


def test_4_conflict_detection_free_webmail_on_corporate_domain():
    """Verify detection of identity inconsistency when a commercial domain uses free public webmail."""
    html = """
    <html>
    <body>
        <h1>Apex Global Capital Asset Management</h1>
        <p>Direct all investment inquiries to: apexinvestment@gmail.com</p>
        <p>© 2025 Apex Global Capital LLC. All rights reserved.</p>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://apexglobalcapital.com")
    result = analyze_first_party_transparency(
        page_url="https://apexglobalcapital.com",
        text_content=extraction.clean_text,
        links=extraction.links,
        structured_data_blocks=extraction.structured_data,
        page_id=505,
    )

    assert result.consistency_checks["has_conflict"] is True
    assert result.consistency_checks["domain_contact_aligned"] is False
    assert any(f.finding_type == "contact_identity_conflict" for f in result.findings)


def test_5_empty_and_weak_input_safety():
    """Verify safe execution on empty strings and None inputs."""
    res_empty = analyze_first_party_transparency(text_content="")
    assert res_empty.is_transparent is False
    assert res_empty.total_signals == 7

    res_none = analyze_first_party_transparency(text_content=None)
    assert res_none.is_transparent is False


def test_6_evidence_traceability():
    """Verify that all transparency signals contain traceable extraction evidence."""
    result = analyze_first_party_transparency(
        page_url="https://iqp.org",
        text_content="Authored by Dr. Elena Rostova. Contact: info@iqp.org. © 2025 Institute for Quantum Physics.",
    )

    for sig in result.transparency_signals:
        assert isinstance(sig, TrustSignalContract)
        if sig.status in ("detected", "verified", "conflict"):
            assert sig.evidence is not None


def test_7_deterministic_rule_ids():
    """Verify stable, predictable signal IDs for all transparency checks."""
    result = analyze_first_party_transparency(text_content="Sample text")
    rule_ids = {s.signal_id for s in result.transparency_signals}

    expected_ids = {
        "transparency_org_identity",
        "transparency_author_identity",
        "transparency_contact_info",
        "transparency_about_relationship",
        "transparency_ownership_disclosed",
        "transparency_dates_disclosed",
        "transparency_consistency_checks",
    }
    assert rule_ids == expected_ids


def test_8_compatibility_with_step2_contracts():
    """Verify seamless compatibility with Step 2 contracts and serialization."""
    result = analyze_first_party_transparency(
        page_url="https://example.com",
        text_content="Authored by Jane Doe. Contact: info@example.com.",
        page_id=900,
    )

    envelope = AuthorityCitationTrustResult(
        page_id=result.page_id,
        url=result.url,
        trust_signals=result.transparency_signals,
        findings=result.findings,
        recommendations=result.recommendations,
    )

    json_str = envelope.model_dump_json()
    reconstructed = AuthorityCitationTrustResult.model_validate_json(json_str)
    assert len(reconstructed.trust_signals) == len(result.transparency_signals)
