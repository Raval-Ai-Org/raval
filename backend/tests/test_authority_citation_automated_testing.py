"""
Automated Testing and Comprehensive Fixture Suite for Authority, Citation & Trust Intelligence
(Day 8 - Phase B - Step 12 ONLY)

Covers comprehensive true-positive, true-negative, and false-positive protections across:
- Section A: Trust Engine & Signals (including False-Positive Prevention)
- Section B: Authority Engine & Signals (including False-Positive Prevention)
- Section C: External Source Detection (including Internal-Link False-Positive Prevention)
- Section D: Claim-Support Engine (including Opinion/Navigational False-Positive Prevention)
- Section E: Source Quality & Usability (including High-Quality Source False-Positive Prevention)
- Section F: First-Party Transparency (including Legitimate Email False-Positive Prevention)
- Section G: Structural Citation Readiness & Synthesis (No fake scores / AI promises)
- Section H: End-to-End Regression (Extraction -> Engines -> Findings -> Recs -> API)
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.authority_citation_recommendations import (
    RULE_REGISTRY,
    analyze_direct_authority_citation_trust,
    analyze_page_authority_citation_trust,
    analyze_scan_authority_citation_trust,
    analyze_website_authority_citation_trust,
    create_deterministic_finding,
    map_finding_to_recommendation,
    map_result_to_findings_and_recommendations,
    persist_authority_citation_findings_and_recommendations,
)
from app.authority_citation_schemas import (
    AuthorityCitationTrustResult,
    CitationReadinessContract,
    ConfidenceLevel,
    ExternalSourceContract,
    SeverityLevel,
)
from app.authority_engine import analyze_authority_signals
from app.citation_readiness_engine import CitationReadinessEngine
from app.claim_support_engine import analyze_claim_support
from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageHeading, PageLink, PageResult, Recommendation, Scan, Website
from app.page_extractor import extract_html
from app.recommendation_service import FINDING_RECOMMENDATION_MAP
from app.source_engine import detect_external_sources
from app.source_quality_engine import evaluate_source_quality
from app.transparency_engine import analyze_first_party_transparency
from app.trust_engine import analyze_trust_signals

client = TestClient(app)


# =============================================================================
# SECTION A: TRUST ENGINE & FALSE-POSITIVE PROTECTIONS
# =============================================================================

def test_a1_trust_strong_evidence_true_positive():
    """Verify strong trust evidence produces complete positive signals without gaps."""
    html = """
    <html>
    <head>
        <title>Vertex Medical Group - Clinical Research</title>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "MedicalOrganization",
            "name": "Vertex Medical Group",
            "url": "https://vertexmed.org"
        }
        </script>
    </head>
    <body>
        <h1>Clinical Neurology Innovations</h1>
        <p>Founded by Dr. Robert Chen, MD. Contact our Boston headquarters at info@vertexmed.org or call (617) 555-0199.</p>
        <footer>
            <a href="/about-us">About Us</a>
            <a href="/contact">Contact</a>
            <a href="/privacy-policy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
            <p>© 2026 Vertex Medical Group. All rights reserved.</p>
        </footer>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://vertexmed.org/about-us")
    res = analyze_trust_signals(
        page_url="https://vertexmed.org/about-us",
        title=extraction.title_text,
        text_content=extraction.clean_text,
        links=extraction.links,
        headings=extraction.headings,
        structured_data_blocks=extraction.structured_data,
        social_metadata=extraction.social_metadata,
    )
    assert len(res.identity_signals) >= 1
    assert res.identity_signals[0].status == "verified"
    assert res.identity_signals[0].value["organization_name"] == "Vertex Medical Group"
    assert len(res.about_signals) >= 1
    assert len(res.contact_signals) >= 1
    assert not any(f.finding_type == "missing_privacy_policy" for f in res.findings)


def test_a2_trust_missing_identity_true_positive():
    """Verify completely anonymous page triggers deterministic missing trust findings."""
    html = """
    <html>
    <head><title>Unbelievable Diet Deals</title></head>
    <body>
        <h1>Buy miracle weight loss supplements right now for cheap prices!</h1>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://super-diet-deals.com/deal")
    res = analyze_trust_signals(
        page_url="https://super-diet-deals.com/deal",
        title=extraction.title_text,
        text_content=extraction.clean_text,
        links=extraction.links,
        headings=extraction.headings,
        structured_data_blocks=extraction.structured_data,
    )
    assert res.missing_signals_count >= 1
    finding_types = [f.finding_type for f in res.findings]
    assert any(ft in ("missing_privacy_policy", "missing_contact_information", "missing_trust_signals") for ft in finding_types)


def test_a3_trust_business_conflict_true_positive():
    """Verify discrepancy between structured schema and OpenGraph/copyright triggers conflict finding."""
    json_ld = [{"parsed_json": {"@type": "Organization", "name": "Zenith Crypto Arbitrage Holdings Ltd"}}]
    social = [{"property_name": "og:site_name", "content": "Apex Financial Solutions"}]
    text = "Copyright © 2026 Apex Financial Solutions LLC. All rights reserved."

    res = analyze_trust_signals(
        page_url="https://apexfin.com",
        title="Apex Financial Solutions LLC",
        text_content=text,
        structured_data_blocks=json_ld,
        social_metadata=social,
    )
    assert len(res.consistency_signals) >= 1
    finding_types = [f.finding_type for f in res.findings]
    assert "conflicting_business_identity" in finding_types or "business_name_conflict" in finding_types


def test_a4_trust_false_positive_protection():
    """False Positive Test: Legitimate corporate subdomain with consistent metadata must NOT trigger false conflicts."""
    html = """
    <html>
    <head>
        <title>Stripe Documentation - Payments</title>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Stripe, Inc.",
            "url": "https://stripe.com"
        }
        </script>
    </head>
    <body>
        <h1>Stripe Payments Integration Guide</h1>
        <footer>
            <a href="https://stripe.com/about">About Stripe</a>
            <a href="https://stripe.com/contact">Contact Support</a>
            <a href="https://stripe.com/privacy">Privacy</a>
            <p>© 2026 Stripe, Inc. All rights reserved.</p>
        </footer>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://docs.stripe.com/payments")
    res = analyze_trust_signals(
        page_url="https://docs.stripe.com/payments",
        title=extraction.title_text,
        text_content=extraction.clean_text,
        links=extraction.links,
        headings=extraction.headings,
        structured_data_blocks=extraction.structured_data,
    )
    finding_types = [f.finding_type for f in res.findings]
    assert "conflicting_business_identity" not in finding_types
    assert "business_name_conflict" not in finding_types


# =============================================================================
# SECTION B: AUTHORITY ENGINE & FALSE-POSITIVE PROTECTIONS
# =============================================================================

def test_b1_authority_strong_topical_depth_true_positive():
    """Verify high topical depth, credentials, and internal cluster linking."""
    html = """
    <html>
    <head>
        <title>Superconducting Qubit Architecture Analysis (2026)</title>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "ScholarlyArticle",
            "headline": "Superconducting Qubit Architecture Analysis",
            "author": {
                "@type": "Person",
                "name": "Dr. Elena Rostova, PhD",
                "jobTitle": "Lead Physicist"
            }
        }
        </script>
    </head>
    <body>
        <h1>Superconducting Qubit Architecture Analysis</h1>
        <p>Authored by Dr. Elena Rostova, PhD. Medically reviewed by Prof. David Klein.</p>
        <h2>Abstract and System Architecture</h2>
        <p>Superconducting quantum circuits require ultra-low thermal dissipation across all microwave cavities. """ + ("Detailed experimental telemetry verifies our gate operation limits. " * 30) + """</p>
        <h2>Thermal Noise Constraints in Microwave Resonators</h2>
        <p>Dielectric loss tangent in coplanar waveguide resonators governs energy relaxation mechanisms. """ + ("Operating at 15 mK dilution refrigeration suppresses thermal excitations. " * 25) + """</p>
        <h2>Empirical Coherence Benchmarking</h2>
        <p>Randomized benchmarking protocols yielded single-qubit gate fidelities exceeding 99.94% across 10,000 runs.</p>
        <h2>Dilution Refrigerator Operating Protocols</h2>
        <p>Cryogenic shielding isolates microwave transmission lines from stray magnetic fields.</p>
        <h2>Decoherence Mitigation Strategies</h2>
        <p>Dynamical decoupling pulse sequences protect idle qubits against low-frequency phase noise.</p>
        <footer>
            <a href="/topics/coherence">Qubit Coherence Principles</a>
            <a href="/topics/cryogenics">Cryogenic Systems</a>
            <a href="/topics/error-mitigation">Error Mitigation</a>
        </footer>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://quantum-lab.org/architecture")
    res = analyze_authority_signals(
        page_url="https://quantum-lab.org/architecture",
        title=extraction.title_text,
        text_content=extraction.clean_text,
        headings=extraction.headings,
        links=extraction.links,
        structured_data_blocks=extraction.structured_data,
    )
    assert len(res.topical_depth_signals) >= 1
    assert len(res.author_credentials_signals) >= 1
    assert not any(f.finding_type == "shallow_topical_depth" for f in res.findings)
    assert not any(f.finding_type == "missing_author_credentials" for f in res.findings)


def test_b2_authority_shallow_depth_true_positive():
    """Verify thin marketing landing page produces shallow topical depth finding."""
    html = """
    <html>
    <head><title>Fast SEO</title></head>
    <body>
        <h1>Best SEO</h1>
        <p>We are the top SEO agency in the city. Call us now.</p>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://seo-agency-fast.com")
    res = analyze_authority_signals(
        page_url="https://seo-agency-fast.com",
        title=extraction.title_text,
        text_content=extraction.clean_text,
        headings=extraction.headings,
        links=extraction.links,
    )
    finding_types = [f.finding_type for f in res.findings]
    assert "shallow_topical_depth" in finding_types


def test_b3_authority_false_positive_protection_attributed_content():
    """False Positive Test: Articles with explicit credentials and supporting cluster links must NOT trigger missing credentials or missing internal links."""
    html = """
    <html>
    <head>
        <title>Cardiovascular Guidelines 2026</title>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "author": {"@type": "Person", "name": "Dr. Sarah Lin, MD"}
        }
        </script>
    </head>
    <body>
        <h1>Cardiovascular Guidelines 2026</h1>
        <p>Authored by Dr. Sarah Lin, MD. Medically reviewed by Prof. Alan Moore.</p>
        <h2>Methodology and Clinical Scope</h2>
        <p>""" + ("Comprehensive empirical analysis across clinical patient cohorts. " * 30) + """</p>
        <h2>Related Topic Guides</h2>
        <nav>
            <a href="/topics/hypertension">Hypertension Treatment Guide</a>
            <a href="/topics/lipid-panels">Lipid Panel Interpretation</a>
            <a href="/topics/cardiac-mri">Cardiac MRI Protocols</a>
        </nav>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://cardio-review.org/guidelines")
    res = analyze_authority_signals(
        page_url="https://cardio-review.org/guidelines",
        title=extraction.title_text,
        text_content=extraction.clean_text,
        headings=extraction.headings,
        links=extraction.links,
        structured_data_blocks=extraction.structured_data,
    )
    finding_types = [f.finding_type for f in res.findings]
    assert "missing_author_credentials" not in finding_types
    assert "lacks_internal_supporting_links" not in finding_types


# =============================================================================
# SECTION C: EXTERNAL SOURCE DETECTION & FALSE-POSITIVE PROTECTIONS
# =============================================================================

def test_c1_external_source_classification_true_positive():
    """Verify classification of research sources vs social vs affiliate links."""
    res = detect_external_sources(
        page_url="https://tech-portal.com/review",
        text_content="Read the benchmark report at DOI. Buy the device at Amazon. Follow our Twitter.",
        headings=[{"level": 2, "text": "References and Data Sources"}],
        links=[
            {"url": "https://doi.org/10.1038/s41586-026-0001", "anchor_text": "Nature Study Dataset", "link_type": "external"},
            {"url": "https://twitter.com/techportal", "anchor_text": "Twitter Profile", "link_type": "external"},
            {"url": "https://amazon.com/dp/B0001?tag=affiliate-20", "anchor_text": "Buy on Amazon", "link_type": "external", "rel": "sponsored"},
        ],
    )
    assert res.total_external_sources == 3
    assert res.citation_candidates_count >= 1
    assert "doi.org" in res.domains_summary
    assert len(res.reference_sections_detected) == 1


def test_c2_external_source_false_positive_internal_and_fragment_links():
    """False Positive Test: Internal links, relative paths, hash anchors, and javascript: links must NOT be counted as external sources."""
    res = detect_external_sources(
        page_url="https://news-hub.com/article-1",
        text_content="Check our other articles and jump to top.",
        links=[
            {"url": "https://news-hub.com/category/world", "anchor_text": "World News", "link_type": "internal"},
            {"url": "/about-us", "anchor_text": "About Us", "link_type": "internal"},
            {"url": "#section-2", "anchor_text": "Jump to Section 2", "link_type": "internal"},
            {"url": "javascript:void(0)", "anchor_text": "Share", "link_type": "internal"},
            {"url": "mailto:editor@news-hub.com", "anchor_text": "Email Editor", "link_type": "internal"},
        ],
    )
    assert res.total_external_sources == 0
    assert len(res.sources) == 0
    assert res.citation_candidates_count == 0


# =============================================================================
# SECTION D: CLAIM-SUPPORT ENGINE & FALSE-POSITIVE PROTECTIONS
# =============================================================================

def test_d1_claim_support_empirical_and_comparative_true_positive():
    """Verify statistical, comparative, and technical claims are detected and associated with nearby citations."""
    text = (
        "During phase 3 clinical trials, the therapy demonstrated a 94.2% recovery acceleration in patient cohorts. "
        "Overall energy yield increased by 450 kW across all 12 optimal commercial installations."
    )
    res = analyze_claim_support(
        text_content=text,
        headings=[{"level": 1, "text": "Benchmark Evaluation"}],
        page_url="https://research-lab.org/eval",
        external_sources=[
            ExternalSourceContract(
                url="https://doi.org/10.1038/example",
                domain="doi.org",
                anchor_text="Nature Study",
                link_type="citation",
                is_citation_candidate=True,
            )
        ],
    )
    assert res.total_claims_detected >= 2
    assert len(res.claims) >= 2


def test_d2_claim_support_unbacked_superlative_true_positive():
    """Verify bold unbacked superlatives trigger the unsupported superlative finding."""
    res = analyze_claim_support(
        text_content="We provide the fastest and most unrivaled database in existence without any competition.",
        headings=[{"level": 1, "text": "Product"}],
        page_url="https://hyped-db.com",
        external_sources=[],
    )
    assert res.unsupported_claims_count >= 1
    finding_types = [f.finding_type for f in res.findings]
    assert "unsupported_superlative_claim" in finding_types


def test_d3_claim_support_false_positive_opinions_and_conversational_text():
    """False Positive Test: Pure conversational greetings and generic opinions must NOT be flagged as unbacked empirical statistics."""
    res = analyze_claim_support(
        text_content="Welcome to our humble blog. We love building web apps and hope you enjoy reading our tutorials. Have a wonderful day!",
        headings=[{"level": 1, "text": "Welcome to My Blog"}],
        page_url="https://dev-blog.com",
        external_sources=[],
    )
    stat_claims = [c for c in res.claims if c.claim_type == "statistical"]
    assert len(stat_claims) == 0
    finding_types = [f.finding_type for f in res.findings]
    assert "unsupported_statistical_claim" not in finding_types


# =============================================================================
# SECTION E: SOURCE-QUALITY ENGINE & FALSE-POSITIVE PROTECTIONS
# =============================================================================

def test_e1_source_quality_broken_and_generic_anchors_true_positive():
    """Verify broken links and non-descriptive 'click here' anchors generate specific quality findings."""
    sources = [
        ExternalSourceContract(
            url="https://broken-study-domain.org/404",
            domain="broken-study-domain.org",
            anchor_text="click here",
            link_type="citation",
            is_citation_candidate=True,
            status_code=404,
        ),
        ExternalSourceContract(
            url="https://general-ref.com/article",
            domain="general-ref.com",
            anchor_text="click here",
            link_type="citation",
            is_citation_candidate=True,
            status_code=200,
        ),
    ]
    res = evaluate_source_quality(page_url="https://med-review.com/cardio", sources=sources)
    assert res.broken_or_inaccessible_sources_count == 1
    assert res.weak_sources_count >= 1
    finding_types = [f.finding_type for f in res.findings]
    assert "broken_reference_link" in finding_types
    assert "generic_citation_anchor_text" in finding_types


def test_e2_source_quality_false_positive_high_reputation_sources():
    """False Positive Test: High-reputation scholarly citations with descriptive anchors must NOT trigger broken or generic warnings."""
    sources = [
        ExternalSourceContract(
            url="https://doi.org/10.1109/TQE.2026.001",
            domain="doi.org",
            anchor_text="IEEE Transactions on Quantum Engineering 2026 Dataset",
            link_type="citation",
            is_citation_candidate=True,
            status_code=200,
        ),
        ExternalSourceContract(
            url="https://arxiv.org/abs/2601.09999",
            domain="arxiv.org",
            anchor_text="arXiv Preprint: Fault-Tolerant Quantum Gates",
            link_type="citation",
            is_citation_candidate=True,
            status_code=200,
        ),
    ]
    res = evaluate_source_quality(page_url="https://mit.edu/research", sources=sources)
    assert res.broken_or_inaccessible_sources_count == 0
    assert res.high_quality_sources_count == 2
    assert len(res.findings) == 0


# =============================================================================
# SECTION F: FIRST-PARTY TRANSPARENCY & FALSE-POSITIVE PROTECTIONS
# =============================================================================

def test_f1_transparency_conflict_free_webmail_true_positive():
    """Verify using free webmail (gmail/yahoo) on a corporate domain triggers conflict finding."""
    res = analyze_first_party_transparency(
        text_content="Acme Global Corporation. Contact our sales department at acme_sales_2026@gmail.com.",
        page_url="https://acmeglobal.com",
    )
    assert res.consistency_checks["has_conflict"] is True
    finding_types = [f.finding_type for f in res.findings]
    assert "contact_identity_conflict" in finding_types


def test_f2_transparency_false_positive_official_domain_email():
    """False Positive Test: Contact emails using official company domain must NOT trigger contact_identity_conflict."""
    res = analyze_first_party_transparency(
        text_content="Acme Global Corporation. Authored by John Doe. Contact our enterprise team at sales@acmeglobal.com.",
        title="About Acme Global",
        meta_description="Learn about Acme Global leadership and team.",
        page_url="https://acmeglobal.com/about",
        links=[{"url": "https://acmeglobal.com/contact", "anchor_text": "Contact Us", "is_internal": True}],
    )
    assert res.consistency_checks["has_conflict"] is False
    finding_types = [f.finding_type for f in res.findings]
    assert "contact_identity_conflict" not in finding_types


# =============================================================================
# SECTION G: STRUCTURAL CITATION READINESS & INTEGRITY
# =============================================================================

def test_g1_citation_readiness_synthesis_high_vs_low():
    """Verify citation readiness engine synthesizes high vs low readiness accurately."""
    engine = CitationReadinessEngine()

    # High readiness synthesis
    high_unified = engine.build_unified_result(
        page_url="https://iqp.org/study",
        trust_result=analyze_trust_signals(text_content="IQP Research Lab. info@iqp.org", page_url="https://iqp.org"),
        authority_result=analyze_authority_signals(text_content="Analysis..." * 30, headings=[{"level": 1, "text": "Analysis"}], page_url="https://iqp.org"),
        source_result=detect_external_sources(links=[{"url": "https://doi.org/10.1000/1", "anchor_text": "Nature Study", "link_type": "external"}], page_url="https://iqp.org"),
        claim_support_result=analyze_claim_support(text_content="Observed 99% accuracy.", page_url="https://iqp.org", external_sources=[ExternalSourceContract(url="https://doi.org/10.1000/1", is_citation_candidate=True)]),
    )
    assert high_unified.citation_readiness.readiness_level in ("high", "moderate")
    assert high_unified.citation_readiness.has_verifiable_sources is True

    # Low readiness synthesis
    low_unified = engine.build_unified_result(
        page_url="https://fake-deals.com/item",
        trust_result=analyze_trust_signals(text_content="Buy now", page_url="https://fake-deals.com"),
        authority_result=analyze_authority_signals(text_content="Buy now", page_url="https://fake-deals.com"),
        source_result=detect_external_sources(links=[], page_url="https://fake-deals.com"),
        claim_support_result=analyze_claim_support(text_content="We are 1000% the greatest!", page_url="https://fake-deals.com"),
    )
    assert low_unified.citation_readiness.readiness_level == "low"


def test_g2_citation_readiness_integrity_no_fake_scores():
    """Integrity Test: Ensure CitationReadiness output does NOT contain fake scores or AI guarantees."""
    engine = CitationReadinessEngine()
    result = engine.build_unified_result(page_url="https://example.org/test")
    dumped = result.model_dump()
    dumped_str = str(dumped).lower()

    assert "ai_ranking_guarantee" not in dumped_str
    assert "fake_authority_score" not in dumped_str
    assert "guaranteed_citation" not in dumped_str


# =============================================================================
# SECTION H: END-TO-END REGRESSION (EXTRACTION -> ENGINES -> FINDINGS -> RECS -> API)
# =============================================================================

def test_h1_end_to_end_pipeline_and_api_integration():
    """Regression Test: Extraction -> All Signal Engines -> Findings & Recs Persistence -> FastAPI Route."""
    db = SessionLocal()

    website = Website(name="NeuroTech Institute", url="https://neurotech-research.org")
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed", pages_crawled=1)
    db.add(scan)
    db.commit()
    db.refresh(scan)

    page = PageResult(
        scan_id=scan.id,
        url="https://neurotech-research.org/trials/eeg-latency",
        content="""
        <html>
        <head><title>Neural Latency Benchmark 2026</title></head>
        <body>
            <h1>Neural Latency Benchmark 2026</h1>
            <p>Authored by Dr. Marcus Sterling, MD, Chief Neuroscientist at NeuroTech Institute. Contact: contact@neurotech-research.org.</p>
            <h2>Clinical Outcomes</h2>
            <p>Our adaptive signal filtering algorithm reduced sensor artifact interference by 54.2% across 300 trial sessions.</p>
            <h2>Data Sources and Methodological References</h2>
            <p>Original trial telemetry datasets are deposited at <a href="https://doi.org/10.1038/s41593-026-0001" rel="noopener">Nature Neuroscience Benchmark Repository</a>.</p>
        </body>
        </html>
        """,
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    page_id = page.id
    scan_id = scan.id
    website_id = website.id
    db.close()

    # 1. API GET
    get_resp = client.get(f"/api/v1/pages/{page_id}/authority-citation-trust")
    assert get_resp.status_code == 200
    page_data = get_resp.json()
    assert page_data["url"] == "https://neurotech-research.org/trials/eeg-latency"
    assert len(page_data["external_sources"]) >= 1

    # 2. API POST (Persist Findings & Recommendations)
    post_resp = client.post(f"/api/v1/pages/{page_id}/authority-citation-trust?persist=true")
    assert post_resp.status_code == 200

    # 3. Database Integrity & Relationships
    db = SessionLocal()
    persisted_findings = db.query(Finding).filter(Finding.page_id == page_id).all()
    for f in persisted_findings:
        assert isinstance(f.finding_type, str)
        assert len(f.finding_type) > 0
        assert f.severity in ("critical", "high", "medium", "low")

    # 4. Scan & Website Endpoints
    scan_resp = client.get(f"/api/v1/scans/{scan_id}/authority-citation-trust")
    assert scan_resp.status_code == 200
    assert len(scan_resp.json()) == 1

    web_resp = client.get(f"/api/v1/websites/{website_id}/authority-citation-trust")
    assert web_resp.status_code == 200
    assert len(web_resp.json()) == 1

    db.close()
