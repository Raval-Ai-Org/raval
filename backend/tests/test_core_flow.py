from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok"
    }


def test_create_website_and_scan_flow():

    website_response = client.post(
        "/api/v1/websites",
        json={
            "name": "Test Website",
            "url": "https://example.com",
        },
    )

    assert website_response.status_code == 200

    website = website_response.json()

    scan_response = client.post(
        f"/api/v1/websites/{website['id']}/scans"
    )

    assert scan_response.status_code == 200

    scan = scan_response.json()

    assert scan["status"] == "queued"

    running_response = client.patch(
        f"/api/v1/scans/{scan['id']}/status",
        json={
            "status": "running",
        },
    )

    assert running_response.status_code == 200

    completed_response = client.patch(
        f"/api/v1/scans/{scan['id']}/status",
        json={
            "status": "completed",
        },
    )

    assert completed_response.status_code == 200

    assert (
        completed_response.json()["status"]
        == "completed"
    )


def test_invalid_url():

    response = client.post(
        "/api/v1/websites",
        json={
            "name": "Invalid Website",
            "url": "not-a-url",
        },
    )

    assert response.status_code == 422


def test_missing_scan():

    response = client.get(
        "/api/v1/scans/999999"
    )

    assert response.status_code == 404


def test_invalid_scan_transition():

    website_response = client.post(
        "/api/v1/websites",
        json={
            "name": "Transition Test",
            "url": "https://example.org",
        },
    )

    website_id = website_response.json()["id"]

    scan_response = client.post(
        f"/api/v1/websites/{website_id}/scans"
    )

    scan_id = scan_response.json()["id"]

    client.patch(
        f"/api/v1/scans/{scan_id}/status",
        json={
            "status": "running",
        },
    )

    client.patch(
        f"/api/v1/scans/{scan_id}/status",
        json={
            "status": "completed",
        },
    )

    response = client.patch(
        f"/api/v1/scans/{scan_id}/status",
        json={
            "status": "running",
        },
    )

    assert response.status_code == 409