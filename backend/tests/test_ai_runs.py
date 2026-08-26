from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import AIRun, AIResult, Citation, Question, QuestionSet, Website
from app.services import (
    create_ai_result,
    create_ai_run,
    create_question,
    create_question_set,
    get_ai_result_citations,
    get_ai_run,
    get_ai_run_result,
    get_question,
    get_question_set,
    get_website_ai_runs,
    update_ai_run_status,
)

client = TestClient(app)


def _setup_website_and_question(
    db: Session,
    site_name: str = "AI Test Site",
    url: str = "https://ai-test.com",
    q_text: str = "What are the best products from this company?",
):
    website = Website(name=site_name, url=url)
    db.add(website)
    db.commit()
    db.refresh(website)

    qs = QuestionSet(
        website_id=website.id,
        name="Brand Visibility Benchmark",
        version="1.0",
    )
    db.add(qs)
    db.commit()
    db.refresh(qs)

    question = Question(
        question_set_id=qs.id,
        text=q_text,
        intent="commercial",
        topic="brand_perception",
    )
    db.add(question)
    db.commit()
    db.refresh(question)

    return website, qs, question


def test_create_question_set_and_question_api():
    db = SessionLocal()
    try:
        website = Website(name="QS API Site", url="https://qs-api.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        # Create question set
        qs_res = client.post(
            f"/api/v1/websites/{website.id}/question-sets",
            json={
                "name": "General Benchmark",
                "version": "1.1",
                "description": "General search queries",
            },
        )
        assert qs_res.status_code == 201
        qs_data = qs_res.json()
        assert qs_data["id"] is not None
        assert qs_data["website_id"] == website.id
        assert qs_data["name"] == "General Benchmark"

        # List question sets
        qs_list = client.get(f"/api/v1/websites/{website.id}/question-sets")
        assert qs_list.status_code == 200
        assert len(qs_list.json()) == 1

        # Create question
        q_res = client.post(
            f"/api/v1/question-sets/{qs_data['id']}/questions",
            json={
                "text": "Who is the CEO of the company?",
                "intent": "informational",
                "topic": "leadership",
            },
        )
        assert q_res.status_code == 201
        q_data = q_res.json()
        assert q_data["id"] is not None
        assert q_data["question_set_id"] == qs_data["id"]
        assert q_data["text"] == "Who is the CEO of the company?"

        # List questions
        q_list = client.get(f"/api/v1/question-sets/{qs_data['id']}/questions")
        assert q_list.status_code == 200
        assert len(q_list.json()) == 1
    finally:
        db.close()


def test_create_ai_run_starts_queued():
    db = SessionLocal()
    try:
        website, qs, question = _setup_website_and_question(db, "AI Run Site", "https://airun1.com")

        payload = {
            "question_id": question.id,
            "provider": "openai",
            "model": "gpt-4o",
            "environment": "production",
        }

        response = client.post(f"/api/v1/websites/{website.id}/ai-runs", json=payload)
        assert response.status_code == 201
        data = response.json()

        assert data["id"] is not None
        assert data["website_id"] == website.id
        assert data["question_id"] == question.id
        assert data["provider"] == "openai"
        assert data["model"] == "gpt-4o"
        assert data["environment"] == "production"
        assert data["status"] == "queued"
        assert data["started_at"] is None
        assert data["completed_at"] is None
        assert "created_at" in data

        # Verify DB persistence
        db_run = db.get(AIRun, data["id"])
        assert db_run is not None
        assert db_run.status == "queued"
        assert db_run.website_id == website.id
    finally:
        db.close()


def test_ai_run_lifecycle_and_conflict():
    db = SessionLocal()
    try:
        website, qs, question = _setup_website_and_question(db, "Lifecycle Site", "https://airun-life.com")

        create_res = client.post(
            f"/api/v1/websites/{website.id}/ai-runs",
            json={
                "question_id": question.id,
                "provider": "anthropic",
                "model": "claude-3-5-sonnet",
            },
        )
        run_id = create_res.json()["id"]

        # Invalid transition: queued -> completed directly
        invalid_res = client.patch(
            f"/api/v1/ai-runs/{run_id}/status",
            json={"status": "completed"},
        )
        assert invalid_res.status_code == 409

        # Valid transition: queued -> running
        running_res = client.patch(
            f"/api/v1/ai-runs/{run_id}/status",
            json={"status": "running"},
        )
        assert running_res.status_code == 200
        assert running_res.json()["status"] == "running"
        assert running_res.json()["started_at"] is not None

        # Valid transition: running -> completed
        completed_res = client.patch(
            f"/api/v1/ai-runs/{run_id}/status",
            json={"status": "completed"},
        )
        assert completed_res.status_code == 200
        assert completed_res.json()["status"] == "completed"
        assert completed_res.json()["completed_at"] is not None

        # Terminal state: completed -> running is rejected
        terminal_res = client.patch(
            f"/api/v1/ai-runs/{run_id}/status",
            json={"status": "running"},
        )
        assert terminal_res.status_code == 409
    finally:
        db.close()


def test_ai_run_cancellation_and_failure():
    db = SessionLocal()
    try:
        website, qs, question = _setup_website_and_question(db, "Cancel Site", "https://cancel.com")

        # Test queued -> cancelled
        run1_res = client.post(
            f"/api/v1/websites/{website.id}/ai-runs",
            json={"question_id": question.id, "provider": "google", "model": "gemini-pro"},
        )
        run1_id = run1_res.json()["id"]

        cancel_res = client.patch(
            f"/api/v1/ai-runs/{run1_id}/status",
            json={"status": "cancelled"},
        )
        assert cancel_res.status_code == 200
        assert cancel_res.json()["status"] == "cancelled"

        # Test running -> failed with error message
        run2_res = client.post(
            f"/api/v1/websites/{website.id}/ai-runs",
            json={"question_id": question.id, "provider": "google", "model": "gemini-pro"},
        )
        run2_id = run2_res.json()["id"]

        client.patch(f"/api/v1/ai-runs/{run2_id}/status", json={"status": "running"})

        fail_res = client.patch(
            f"/api/v1/ai-runs/{run2_id}/status",
            json={"status": "failed", "error_message": "Rate limit exceeded from provider API"},
        )
        assert fail_res.status_code == 200
        assert fail_res.json()["status"] == "failed"
        assert fail_res.json()["error_message"] == "Rate limit exceeded from provider API"
    finally:
        db.close()


def test_create_ai_result_and_citations():
    db = SessionLocal()
    try:
        website, qs, question = _setup_website_and_question(db, "Result Site", "https://result-test.com")

        run_res = client.post(
            f"/api/v1/websites/{website.id}/ai-runs",
            json={"question_id": question.id, "provider": "perplexity", "model": "sonar"},
        )
        run_id = run_res.json()["id"]

        # Post result with citations
        result_payload = {
            "answer": "Example Brand is a leading platform providing AI-driven search intelligence.",
            "mentions_brand": True,
            "mentions_competitors": ["CompetitorX", "CompetitorY"],
            "metrics": {"sentiment": "positive", "rank": 1},
            "citations": [
                {
                    "url": "https://example.com/about",
                    "domain": "example.com",
                    "title": "About Example Brand",
                    "snippet": "Official company profile",
                    "position": 1,
                },
                {
                    "url": "https://tech-reviews.com/example-brand",
                    "domain": "tech-reviews.com",
                    "title": "Example Brand Review",
                    "snippet": "Top-tier AI search intelligence tool",
                    "position": 2,
                },
            ],
        }

        res = client.post(f"/api/v1/ai-runs/{run_id}/result", json=result_payload)
        assert res.status_code == 201
        data = res.json()

        assert data["id"] is not None
        assert data["ai_run_id"] == run_id
        assert data["answer"] == result_payload["answer"]
        assert data["mentions_brand"] is True
        assert data["mentions_competitors"] == ["CompetitorX", "CompetitorY"]
        assert len(data["citations"]) == 2
        assert data["citations"][0]["url"] == "https://example.com/about"
        assert data["citations"][1]["position"] == 2

        # Query result via GET /api/v1/ai-runs/{run_id}/result
        get_res = client.get(f"/api/v1/ai-runs/{run_id}/result")
        assert get_res.status_code == 200
        assert get_res.json()["id"] == data["id"]

        # Query citations via GET /api/v1/ai-results/{result_id}/citations
        citations_res = client.get(f"/api/v1/ai-results/{data['id']}/citations")
        assert citations_res.status_code == 200
        citations = citations_res.json()
        assert len(citations) == 2
        assert citations[0]["domain"] == "example.com"
        assert citations[1]["domain"] == "tech-reviews.com"
    finally:
        db.close()


def test_duplicate_ai_result_rejected():
    db = SessionLocal()
    try:
        website, qs, question = _setup_website_and_question(db, "Dup Result Site", "https://dup-res.com")
        run_res = client.post(
            f"/api/v1/websites/{website.id}/ai-runs",
            json={"question_id": question.id, "provider": "openai", "model": "gpt-4o"},
        )
        run_id = run_res.json()["id"]

        # First result
        res1 = client.post(
            f"/api/v1/ai-runs/{run_id}/result",
            json={"answer": "First answer"},
        )
        assert res1.status_code == 201

        # Second result for same run -> 409
        res2 = client.post(
            f"/api/v1/ai-runs/{run_id}/result",
            json={"answer": "Second answer"},
        )
        assert res2.status_code == 409
    finally:
        db.close()


def test_historical_preservation_ai_runs():
    db = SessionLocal()
    try:
        website, qs, question = _setup_website_and_question(db, "Hist AI Site", "https://hist-ai.com")

        # Run 1
        r1_res = client.post(
            f"/api/v1/websites/{website.id}/ai-runs",
            json={"question_id": question.id, "provider": "openai", "model": "gpt-4o"},
        )
        r1_id = r1_res.json()["id"]
        client.patch(f"/api/v1/ai-runs/{r1_id}/status", json={"status": "running"})
        client.patch(f"/api/v1/ai-runs/{r1_id}/status", json={"status": "completed"})
        client.post(f"/api/v1/ai-runs/{r1_id}/result", json={"answer": "Run 1 answer"})

        # Run 2 (later execution)
        r2_res = client.post(
            f"/api/v1/websites/{website.id}/ai-runs",
            json={"question_id": question.id, "provider": "openai", "model": "gpt-4o"},
        )
        r2_id = r2_res.json()["id"]

        # Verify Run 1 is intact
        r1_check = client.get(f"/api/v1/ai-runs/{r1_id}").json()
        assert r1_check["status"] == "completed"
        assert r1_check["completed_at"] is not None

        r1_result = client.get(f"/api/v1/ai-runs/{r1_id}/result").json()
        assert r1_result["answer"] == "Run 1 answer"

        # Verify list of runs has both
        runs_list = client.get(f"/api/v1/websites/{website.id}/ai-runs").json()
        assert len(runs_list) == 2
        ids = [r["id"] for r in runs_list]
        assert r1_id in ids
        assert r2_id in ids
    finally:
        db.close()


def test_website_isolation_and_foreign_key_validation():
    db = SessionLocal()
    try:
        site_a, qs_a, q_a = _setup_website_and_question(db, "Site A", "https://site-a.com")
        site_b, qs_b, q_b = _setup_website_and_question(db, "Site B", "https://site-b.com")

        # Attempt to run AI run for Site B using question from Site A
        cross_res = client.post(
            f"/api/v1/websites/{site_b.id}/ai-runs",
            json={
                "question_id": q_a.id,
                "provider": "openai",
                "model": "gpt-4o",
            },
        )
        assert cross_res.status_code == 400
        assert "belong" in cross_res.json()["detail"].lower()
    finally:
        db.close()


def test_missing_resource_404s():
    # Unknown website
    res1 = client.post(
        "/api/v1/websites/999999/ai-runs",
        json={"question_id": 1, "provider": "openai", "model": "gpt-4o"},
    )
    assert res1.status_code == 404

    # Unknown question
    db = SessionLocal()
    try:
        website = Website(name="No Question Site", url="https://no-q.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        res2 = client.post(
            f"/api/v1/websites/{website.id}/ai-runs",
            json={"question_id": 999999, "provider": "openai", "model": "gpt-4o"},
        )
        assert res2.status_code == 404
    finally:
        db.close()

    # Unknown AI run
    res3 = client.get("/api/v1/ai-runs/999999")
    assert res3.status_code == 404

    # Unknown AI run result
    res4 = client.get("/api/v1/ai-runs/999999/result")
    assert res4.status_code == 404

    # Unknown citations
    res5 = client.get("/api/v1/ai-results/999999/citations")
    assert res5.status_code == 404


def test_validation_empty_fields():
    db = SessionLocal()
    try:
        website, qs, question = _setup_website_and_question(db, "Empty Val Site", "https://empty-val.com")

        # Empty provider
        res1 = client.post(
            f"/api/v1/websites/{website.id}/ai-runs",
            json={"question_id": question.id, "provider": "   ", "model": "gpt-4o"},
        )
        assert res1.status_code == 400
        assert "provider" in res1.json()["detail"].lower()

        # Empty model
        res2 = client.post(
            f"/api/v1/websites/{website.id}/ai-runs",
            json={"question_id": question.id, "provider": "openai", "model": ""},
        )
        assert res2.status_code == 400
        assert "model" in res2.json()["detail"].lower()

        # Empty answer
        run_res = client.post(
            f"/api/v1/websites/{website.id}/ai-runs",
            json={"question_id": question.id, "provider": "openai", "model": "gpt-4o"},
        )
        run_id = run_res.json()["id"]

        res3 = client.post(
            f"/api/v1/ai-runs/{run_id}/result",
            json={"answer": "   "},
        )
        assert res3.status_code == 400
        assert "answer" in res3.json()["detail"].lower()
    finally:
        db.close()


def test_cascade_deletion():
    db = SessionLocal()
    try:
        website, qs, question = _setup_website_and_question(db, "Cascade AI Site", "https://casc-ai.com")

        run = create_ai_run(
            db,
            website.id,
            {"question_id": question.id, "provider": "openai", "model": "gpt-4o"},
        )
        run_id = run.id

        result = create_ai_result(
            db,
            run_id,
            {
                "answer": "Test answer",
                "citations": [{"url": "https://example.com"}],
            },
        )
        result_id = result.id
        citation_id = result.citations[0].id

        # Delete website
        db.delete(website)
        db.commit()

        # Verify cascades
        assert db.get(AIRun, run_id) is None
        assert db.get(AIResult, result_id) is None
        assert db.get(Citation, citation_id) is None
    finally:
        db.close()


def test_direct_service_layer_ai_runs():
    db = SessionLocal()
    try:
        website, qs, question = _setup_website_and_question(db, "Service AI Site", "https://serv-ai.com")

        # Create question set directly
        qs2 = create_question_set(db, website.id, {"name": "Service QS"})
        assert qs2.id is not None

        # Create question directly
        q2 = create_question(db, qs2.id, {"text": "Service Q"})
        assert q2.id is not None

        # Fetch
        assert get_question_set(db, qs2.id).id == qs2.id
        assert get_question(db, q2.id).id == q2.id

        # Unknown IDs raise ValueError
        with pytest.raises(ValueError, match="Question set not found"):
            get_question_set(db, 999999)

        with pytest.raises(ValueError, match="Question not found"):
            get_question(db, 999999)

        with pytest.raises(ValueError, match="AI run not found"):
            get_ai_run(db, 999999)

        with pytest.raises(ValueError, match="AI run not found"):
            get_ai_run_result(db, 999999)

        with pytest.raises(ValueError, match="AI result not found"):
            get_ai_result_citations(db, 999999)

        with pytest.raises(ValueError, match="Website not found"):
            get_website_ai_runs(db, 999999)
    finally:
        db.close()
