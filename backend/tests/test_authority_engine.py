"""
Authority Signal Engine Tests (Day 8 - Phase B - Step 4 ONLY)

Verifies deterministic, evidence-based authority signal detection:
1. Strong authority evidence
2. Weak/partial authority evidence
3. Missing authority evidence handling
4. Topical depth & subheading hierarchy analysis
5. Related / supporting internal content architecture
6. Subject / topic focus alignment
7. Domain expertise & methodology framework detection
8. Attributed author credentials and qualifications
9. Formal expert reviewer & editorial attribution
10. Scholarly / authoritative schema type validation
11. Evidence traceability in all authority signals
12. No unsupported factual conclusions (Evidence != Conclusion)
13. Output compatibility with AuthoritySignalContract & AuthorityCitationTrustResult
"""

import pytest

from app.authority_citation_schemas import (
    AuthorityCitationTrustResult,
    AuthoritySignalContract,
    ConfidenceLevel,
)
from app.authority_engine import (
    AuthoritySignalEngine,
    AuthoritySignalResult,
    analyze_authority_signals,
)
from app.page_extractor import extract_html
from app.quality_analyzer import analyze_quality
from app.topic_analyzer import TopicAnalysisEvidence, TopicSemanticAnalyzer


def test_1_strong_authority_evidence():
    """Verify detection of strong authority evidence across schema, credentials, depth, and methodology."""
    html = """
    <html>
    <head>
        <title>Quantum Computing Coherence Times and Gate Fidelity</title>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "ScholarlyArticle",
            "headline": "Quantum Computing Coherence Times and Gate Fidelity",
            "author": {
                "@type": "Person",
                "name": "Dr. Alexei Vane",
                "jobTitle": "Principal Physicist",
                "sameAs": "https://orcid.org/0000-0001-9923-4122"
            },
            "publisher": {
                "@type": "Organization",
                "name": "Institute for Quantum Physics"
            }
        }
        </script>
    </head>
    <body>
        <h1>Quantum Computing Coherence Times and Gate Fidelity</h1>
        <p>Authored by Dr. Alexei Vane, PhD, Principal Physicist.</p>
        <p>Medically reviewed by Dr. Elena Rostova on March 12, 2025.</p>
        
        <h2>Abstract and Scope</h2>
        <p>Superconducting qubits require millisecond-scale coherence to execute deep quantum circuits with high fidelity.</p>
        
        <h2>Experimental Setup and Methodology</h2>
        <p>Our experimental setup utilized dilution refrigerators operating at 15 mK with transmon circuit architecture.</p>
        
        <h2>Statistical Analysis and Gate Benchmarking</h2>
        <p>Randomized benchmarking revealed an average single-qubit gate fidelity of 99.94% across 10,000 runs.</p>
        
        <h2>Mechanisms of Decoherence</h2>
        <p>Dielectric loss in coplanar waveguide resonators remains the primary mechanism for energy relaxation.</p>
        
        <h2>Implementation Architecture</h2>
        <p>System design parameters are integrated into the control stack.</p>
        
        <footer>
            <a href="/quantum/transmon-design">Transmon Architecture Guide</a>
            <a href="/quantum/benchmarking-protocols">Benchmarking Protocols</a>
            <a href="/quantum/error-mitigation">Error Mitigation Strategies</a>
        </footer>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://iqp.org/research/quantum-coherence")
    result = analyze_authority_signals(
        page_url="https://iqp.org/research/quantum-coherence",
        title=extraction.title_text,
        headings=extraction.headings,
        links=extraction.links,
        text_content=extraction.clean_text,
        structured_data_blocks=extraction.structured_data,
        page_id=101,
    )

    assert result.page_id == 101
    assert result.detected_signals_count >= 5
    assert result.missing_signals_count == 0

    # Schema Authority
    schema_sig = next(s for s in result.schema_authority_signals if s.signal_id == "authority_schema_validation")
    assert schema_sig.status == "verified"
    assert "ScholarlyArticle" in schema_sig.value["schema_types"]

    # Author Credentials
    cred_sig = next(s for s in result.author_credentials_signals if s.signal_id == "authority_author_credentials")
    assert cred_sig.status == "verified"
    assert "Alexei Vane" in cred_sig.value["author_name"]
    assert "PhD" in cred_sig.value["credentials"]

    # Domain Expertise / Methodology
    exp_sig = next(s for s in result.domain_expertise_signals if s.signal_id == "authority_domain_expertise")
    assert exp_sig.status == "detected"
    assert exp_sig.value["methodology_terms_count"] >= 3

    # Supporting Pages
    sup_sig = next(s for s in result.supporting_pages_signals if s.signal_id == "authority_supporting_pages")
    assert sup_sig.status == "detected"
    assert sup_sig.value["internal_topical_links_count"] == 3


def test_2_weak_partial_authority_evidence():
    """Verify handling of weak or partial authority signals."""
    html = """
    <html>
    <head><title>Quick Tips</title></head>
    <body>
        <h1>Gadget Overview</h1>
        <p>This is a short note on gadgets with one technical term.</p>
        <h2>Methodology</h2>
        <p>We tested it.</p>
        <a href="/related">Related gadget</a>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://gadgets.com/note")
    result = analyze_authority_signals(
        page_url="https://gadgets.com/note",
        title=extraction.title_text,
        headings=extraction.headings,
        links=extraction.links,
        text_content=extraction.clean_text,
    )

    assert result.weak_signals_count >= 2
    # Check that depth is shallow/weak
    depth_sig = next(s for s in result.topical_depth_signals if s.signal_id == "authority_topical_depth")
    assert depth_sig.status in ("weak", "missing")


def test_3_missing_authority_evidence_and_findings():
    """Verify that completely anonymous, shallow pages generate missing statuses and actionable findings."""
    html = """
    <html>
    <body>
        <p>Short content without headings or author.</p>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://example.com/empty")
    result = analyze_authority_signals(
        page_url="https://example.com/empty",
        text_content=extraction.clean_text,
        headings=extraction.headings,
        links=extraction.links,
        page_id=55,
    )

    assert result.missing_signals_count >= 3
    assert len(result.findings) >= 2
    assert any(f.finding_type == "shallow_topical_depth" for f in result.findings)
    assert any(f.finding_type == "missing_author_credentials" for f in result.findings)
    assert len(result.recommendations) >= 2


def test_4_topical_depth_analysis():
    """Verify topical depth detection based on word count and heading hierarchy."""
    engine = AuthoritySignalEngine()

    # Case A: Comprehensive long-form content
    long_text = "Quantum computing " * 800  # 1600 words
    headings_deep = [
        {"level": 1, "text": "Deep Quantum Mechanics"},
        {"level": 2, "text": "Theoretical Foundation"},
        {"level": 2, "text": "Superconducting Circuits"},
        {"level": 3, "text": "Transmon Hamiltonian"},
        {"level": 2, "text": "Error Correction"},
    ]
    res_deep = engine.analyze(text_content=long_text, headings=headings_deep)
    depth_sig = next(s for s in res_deep.topical_depth_signals if s.signal_id == "authority_topical_depth")
    assert depth_sig.status == "verified"
    assert depth_sig.value["depth_level"] == "comprehensive"
    assert depth_sig.evidence["word_count"] >= 1500

    # Case B: Shallow content
    short_text = "Brief summary of quantum computing in few sentences."
    res_shallow = engine.analyze(text_content=short_text, headings=[])
    shallow_sig = next(s for s in res_shallow.topical_depth_signals if s.signal_id == "authority_topical_depth")
    assert shallow_sig.status == "missing"


def test_5_supporting_internal_cluster_links():
    """Verify identification of internal topic cluster architecture links."""
    links = [
        {"destination_url": "https://example.com/guide-part-1", "anchor_text": "Complete Setup Guide Part 1", "link_type": "internal"},
        {"destination_url": "https://example.com/advanced-configuration", "anchor_text": "Advanced Architecture Configuration", "link_type": "internal"},
        {"destination_url": "https://example.com/troubleshooting", "anchor_text": "Detailed Troubleshooting Protocol", "link_type": "internal"},
        {"destination_url": "https://example.com/home", "anchor_text": "Home", "link_type": "internal"},
    ]
    result = analyze_authority_signals(
        page_url="https://example.com/intro",
        links=links,
    )

    sup_sig = next(s for s in result.supporting_pages_signals if s.signal_id == "authority_supporting_pages")
    assert sup_sig.status == "detected"
    assert sup_sig.value["internal_topical_links_count"] == 3


def test_6_topic_focus_alignment():
    """Verify semantic alignment between Title tag and H1."""
    engine = AuthoritySignalEngine()

    # Aligned
    res_aligned = engine.analyze(
        title="Photonic Neural Networks - Performance Benchmark",
        headings=[{"level": 1, "text": "Photonic Neural Networks Architecture and Benchmarks"}],
    )
    focus_sig = next(s for s in res_aligned.topic_focus_signals if s.signal_id == "authority_topic_focus")
    assert focus_sig.status in ("verified", "detected")
    assert focus_sig.value["is_aligned"] is True

    # Divergent
    res_divergent = engine.analyze(
        title="Best Italian Pizza Recipes",
        headings=[{"level": 1, "text": "Quantum Physics Overview"}],
    )
    focus_div = next(s for s in res_divergent.topic_focus_signals if s.signal_id == "authority_topic_focus")
    assert focus_div.status == "weak"


def test_7_attributed_credentials_and_expert_review():
    """Verify academic credentials parsing and formal reviewer attribution."""
    text = (
        "Written by Professor Diane Sterling, MD, PhD, Chief Medical Officer at Stanford Medicine.\n"
        "Fact checked by Dr. Marcus Vance on February 10, 2025."
    )
    result = analyze_authority_signals(
        page_url="https://medstanford.edu/article",
        text_content=text,
    )

    cred_sig = next(s for s in result.author_credentials_signals if s.signal_id == "authority_author_credentials")
    assert cred_sig.status == "detected"
    assert any(c in cred_sig.value["credentials"] for c in ["MD", "PhD"])
    assert any(t in cred_sig.value["titles"] for t in ["Professor", "Chief Medical Officer"])

    exp_sig = next(s for s in result.expert_attribution_signals if s.signal_id == "authority_expert_attribution")
    assert exp_sig.status == "detected"
    assert "Marcus Vance" in exp_sig.value["reviewer_name"]


def test_8_evidence_is_traceable():
    """Verify that every detected authority signal contains traceable evidence."""
    html = """
    <html>
    <head><title>Research Paper</title></head>
    <body>
        <h1>Experimental Methodology and Results</h1>
        <p>Authored by Dr. John Doe, PhD.</p>
        <p>Our methodology involved rigorous clinical benchmarking.</p>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://example.com/paper")
    result = analyze_authority_signals(
        page_url="https://example.com/paper",
        title=extraction.title_text,
        headings=extraction.headings,
        text_content=extraction.clean_text,
    )

    for sig in result.authority_signals:
        assert isinstance(sig, AuthoritySignalContract)
        assert sig.evidence is not None


def test_9_no_unsupported_factual_conclusions():
    """Verify core rule: Evidence != Conclusion. The engine does NOT assert ranking power or factual truth."""
    text = "We built a time machine with 100% efficiency."
    result = analyze_authority_signals(
        page_url="https://example.com/timemachine",
        text_content=text,
    )

    dumped = result.model_dump()
    assert "ranking_guarantee" not in dumped
    assert "factual_veracity" not in dumped
    assert "ai_overview_ranking" not in dumped


def test_10_compatibility_with_step2_contracts():
    """Verify that AuthoritySignalResult signals integrate cleanly into AuthorityCitationTrustResult."""
    engine = AuthoritySignalEngine()
    result = engine.analyze(
        page_url="https://example.com/paper",
        title="Quantum Mechanics Research",
        headings=[{"level": 1, "text": "Quantum Mechanics"}],
        text_content="Authored by Dr. Alice Vance, PhD.",
    )

    top_level = AuthorityCitationTrustResult(
        page_id=200,
        url="https://example.com/paper",
        authority_signals=result.authority_signals,
        findings=result.findings,
        recommendations=result.recommendations,
    )

    assert len(top_level.authority_signals) == result.total_signals
    json_bytes = top_level.model_dump_json()
    reconstructed = AuthorityCitationTrustResult.model_validate_json(json_bytes)
    assert len(reconstructed.authority_signals) == result.total_signals
