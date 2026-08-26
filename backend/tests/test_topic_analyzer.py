from fastapi.testclient import TestClient
import pytest

from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Scan, Website
from app.topic_analyzer import (
    TopicSemanticAnalyzer,
    analyze_topic_semantics,
)

client = TestClient(app)


def test_primary_and_supporting_topics():
    title = "Complete Guide to Machine Learning Algorithms"
    headings = [
        {"level": 1, "text": "Complete Guide to Machine Learning"},
        {"level": 2, "text": "Supervised Learning Techniques"},
        {"level": 2, "text": "Unsupervised Clustering Methods"},
        {"level": 3, "text": "Neural Networks and Deep Learning"},
    ]
    text = (
        "Machine learning is transforming modern technology. "
        "With machine learning, algorithms learn patterns from large datasets. "
        "Supervised learning algorithms use labeled data, while unsupervised clustering algorithms "
        "discover hidden structures in data without predefined labels. "
        "Deep learning neural networks provide powerful predictive modeling capabilities."
    )

    evidence = analyze_topic_semantics(text, title=title, headings=headings)

    assert evidence.primary_topic is not None
    assert "machine learning" in evidence.primary_topic.lower()
    assert evidence.primary_topic_confidence >= 0.70
    assert len(evidence.supporting_topics) > 0
    assert evidence.primary_topic_in_title is True
    assert evidence.primary_topic_in_h1 is True
    assert evidence.total_words > 30


def test_topic_keyword_clusters():
    text = (
        "Renewable energy reduces carbon emissions. Solar energy and wind energy "
        "generate clean power without consuming fossil fuels. Energy storage systems "
        "support renewable energy reliability."
    )
    headings = [{"level": 1, "text": "Renewable Energy Overview"}]
    evidence = analyze_topic_semantics(text, title="Renewable Energy", headings=headings)

    keywords = [k["keyword"] for k in evidence.topic_keywords]
    assert "energy" in keywords or "renewable" in keywords

    # Check keyword attributes
    energy_cluster = next((k for k in evidence.topic_keywords if k["keyword"] == "energy"), None)
    assert energy_cluster is not None
    assert energy_cluster["occurrences"] >= 3
    assert energy_cluster["in_title"] is True
    assert energy_cluster["in_h1"] is True


def test_lexical_diversity_and_depth():
    # Thin content
    thin_text = "Short text with very few words."
    thin_evidence = analyze_topic_semantics(thin_text)
    assert thin_evidence.semantic_depth == "thin"
    assert any(f["type"] == "thin_semantic_depth" for f in thin_evidence.findings)

    # Deep content
    deep_text = " ".join([f"topic{i % 20} sentence with various detailed terms explaining concept {i}" for i in range(40)])
    deep_evidence = analyze_topic_semantics(deep_text)
    assert deep_evidence.semantic_depth == "deep"
    assert deep_evidence.total_words >= 200


def test_primary_topic_absent_from_title_h1():
    title = "Home Page | Welcome to Our Website"
    headings = [{"level": 1, "text": "Welcome to Our Platform"}]
    text = (
        "Quantum computing provides breakthrough calculation speeds for cryptography. "
        "Quantum computing systems utilize qubits and quantum entanglement to solve equations. "
        "Quantum computing will disrupt modern security infrastructure."
    )

    evidence = analyze_topic_semantics(text, title=title, headings=headings)

    assert "quantum computing" in evidence.primary_topic.lower()
    assert evidence.primary_topic_in_title is False
    assert evidence.primary_topic_in_h1 is False

    misalignment = next((f for f in evidence.findings if f["type"] == "topic_heading_misalignment"), None)
    assert misalignment is not None
    assert misalignment["severity"] == "medium"


def test_keyword_stuffing_detection():
    # Artificially repeat "crypto" unnaturally
    text = "crypto " * 30 + " normal words discussing finance market assets and blockchain tokens."
    evidence = analyze_topic_semantics(text)

    stuffing = next((f for f in evidence.findings if f["type"] == "keyword_stuffing_risk"), None)
    assert stuffing is not None
    assert stuffing["severity"] == "high"
    assert stuffing["evidence"]["keyword"] == "crypto"


def test_empty_content_handling():
    evidence = analyze_topic_semantics("")
    assert evidence.primary_topic is None
    assert evidence.total_words == 0
    assert any(f["type"] == "content_empty" for f in evidence.findings)


def test_topic_analysis_api_endpoint_and_persistence():
    db = SessionLocal()
    try:
        website = Website(name="Topic Test Site", url="https://topic-test.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        html = """
        <html>
        <head><title>Cloud Computing Architecture Guide</title></head>
        <body>
            <h1>Cloud Computing Architecture</h1>
            <p>Cloud computing allows organizations to scale cloud computing infrastructure seamlessly.</p>
            <h2>Microservices and Serverless</h2>
            <p>Modern cloud computing deployments leverage containers and serverless functions.</p>
        </body>
        </html>
        """
        page = PageResult(
            scan_id=scan.id,
            url="https://topic-test.com/cloud",
            status_code=200,
            content=html,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        extraction = PageExtraction(
            page_result_id=page.id,
            scan_id=scan.id,
            title_text="Cloud Computing Architecture Guide",
            h1_count=1,
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        # 1. API Call without persistence
        res = client.get(f"/api/v1/pages/{page.id}/topic-analysis")
        assert res.status_code == 200
        data = res.json()
        assert "cloud computing" in data["primary_topic"].lower()
        assert data["primary_topic_in_title"] is True
        assert data["primary_topic_in_h1"] is True

        # Check no findings persisted yet
        findings_before = db.query(Finding).filter(Finding.page_id == page.id).all()
        assert len(findings_before) == 0

        # 2. API Call with persistence
        res_persist = client.get(f"/api/v1/pages/{page.id}/topic-analysis?persist_findings=true")
        assert res_persist.status_code == 200

        findings_after = db.query(Finding).filter(Finding.page_id == page.id).all()
        assert len(findings_after) > 0
        assert findings_after[0].website_id == website.id
        assert findings_after[0].scan_id == scan.id

        # 3. 404 for non-existent page
        res404 = client.get("/api/v1/pages/999999/topic-analysis")
        assert res404.status_code == 404
    finally:
        db.close()
