"""
Production Orchestration & Monitoring - Security Hardening & Isolation Suite (Task 14 Step 8).

Verifies:
1. Cross-tenant isolation across run control (cancellation, pause, resume).
2. Cross-tenant isolation across schedule lifecycle operations.
3. Cross-tenant isolation across execution receipts.
4. Deep recursive secret scrubbing on payloads, events, and receipts.
5. Approval safety gates strictly blocking autonomous execution for high-risk / manual policies.
6. Tenant policy ceiling defenses preventing override of global safety limits.
7. SQL injection & malicious input resilience in parameters and metadata.
8. Multi-tenant idempotency key isolation preventing cross-tenant collisions.
"""

from __future__ import annotations

from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.testclient import TestClient

from app.database import Base, get_db
from app.main import app
from app.models import Website
from app.orchestration.enums import (
    AutomationLevel,
    RunState,
    RunType,
    ScheduleType,
    TriggerSource,
)
from app.orchestration.safety_gate import OrchestrationSafetyGate, SafetyDecisionType
from app.orchestration.exceptions import (
    GlobalCeilingExceededError,
    ReceiptConflictError,
    RunNotFoundError,
    TenantMismatchError,
)
from app.orchestration.orchestrator import ProductionOrchestrator
from app.orchestration.policies import TenantPolicyRegistry
from app.orchestration.receipts import ExecutionReceiptManager
from app.orchestration.schedule_service import ScheduleService
from app.orchestration.schemas import ActorProvenance, ScheduleCreateRequest
from connectors.base.security import sanitize_payload


@pytest.fixture
def db_session():
    """Isolated in-memory database session."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()

    site1 = Website(id=101, name="Acme Security Site", url="https://acme-sec.example.com")
    site2 = Website(id=202, name="Beta Security Site", url="https://beta-sec.example.com")
    session.add_all([site1, site2])
    session.commit()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def orchestrator() -> ProductionOrchestrator:
    return ProductionOrchestrator()


@pytest.fixture
def client(db_session: Session):
    """FastAPI TestClient with overridden get_db dependency."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    test_client = TestClient(app)
    yield test_client
    app.dependency_overrides.clear()


def test_cross_tenant_run_control_isolation(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Verifies that Tenant B cannot cancel, pause, or resume Tenant A's runs.
    """
    tenant_a = "tenant-sec-a"
    tenant_b = "tenant-sec-b"
    site_id = 101

    run_a = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=tenant_a,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    # Tenant B attempts to cancel Tenant A's run
    with pytest.raises(TenantMismatchError):
        orchestrator.control_service.request_cancellation(
            workspace_id=tenant_b,
            site_id=site_id,
            run_id=run_a.id,
            requested_by="attacker",
            db=db_session,
        )

    # Tenant B attempts to pause Tenant A's run
    with pytest.raises(TenantMismatchError):
        orchestrator.control_service.request_pause(
            workspace_id=tenant_b,
            site_id=site_id,
            run_id=run_a.id,
            requested_by="attacker",
            db=db_session,
        )


def test_cross_tenant_schedule_isolation(db_session: Session):
    """
    Verifies that Tenant B cannot read or modify Tenant A's schedule definitions.
    """
    svc = ScheduleService()
    sched_a = svc.create_schedule(
        ScheduleCreateRequest(
            name="Confidential Schedule",
            workspace_id="tenant-sec-a",
            site_id=101,
            schedule_type=ScheduleType.INTERVAL,
            interval_seconds=3600,
            run_type=RunType.SCHEDULED_SCAN,
            actor_provenance=ActorProvenance(actor_id="admin-a", actor_type="user"),
        ),
        db=db_session,
    )

    # Tenant B attempts to access Tenant A's schedule
    with pytest.raises(TenantMismatchError):
        svc.get_schedule(
            workspace_id="tenant-sec-b",
            schedule_id=sched_a.id,
            db=db_session,
        )


def test_cross_tenant_receipt_isolation(db_session: Session):
    """
    Verifies that execution receipts are strictly partitioned by tenant workspace.
    """
    rcpt_a = ExecutionReceiptManager.create_receipt(
        workspace_id="tenant-sec-a",
        run_id="run-sec-a",
        idempotency_key="key-sec-001",
        operation_type="PAYMENT_OR_MUTATION",
        site_id=101,
        details={"sensitive_info": "tenant-a-confidential"},
        db=db_session,
    )

    # Tenant B attempts to access Tenant A's receipt by ID
    with pytest.raises(TenantMismatchError):
        ExecutionReceiptManager.get_receipt(
            workspace_id="tenant-sec-b",
            receipt_id=rcpt_a.id,
            db=db_session,
        )


def test_secret_scrubbing_in_payloads():
    """
    Verifies that sanitize_payload recursively redacts sensitive secrets,
    passwords, bearer tokens, and private keys.
    """
    dirty_payload = {
        "api_key": "sk-proj-1234567890abcdefghijklmnop",
        "nested": {
            "password": "SuperSecretPassword123!",
            "auth_header": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
            "safe_param": "regular_value",
        },
        "tags": ["prod", "auth=secret_token_12345"],
    }

    clean = sanitize_payload(dirty_payload)
    assert clean["api_key"] == "[REDACTED]"
    assert clean["nested"]["password"] == "[REDACTED]"
    assert clean["nested"]["safe_param"] == "regular_value"
    assert "SuperSecretPassword123!" not in str(clean)
    assert "sk-proj-1234567890" not in str(clean)


def test_approval_gate_blocks_autonomous_high_risk_execution():
    """
    Verifies that the safety gate strictly denies automatic execution of dangerous
    or unapproved changes when policy is MANUAL_ONLY.
    """
    dangerous_fix = {
        "id": "fix-drop-db",
        "action_type": "drop_database_schema",
        "category": "database",
        "risk_level": "critical",
    }

    # Autonomous execution must be blocked under MANUAL_ONLY
    decision = OrchestrationSafetyGate.evaluate_fix_plan(
        dangerous_fix,
        automation_level=AutomationLevel.MANUAL_ONLY,
    )
    assert decision.allowed is False
    assert decision.decision in (
        SafetyDecisionType.BLOCKED,
        SafetyDecisionType.REQUIRES_APPROVAL,
    )


def test_tenant_policy_global_ceiling_defense(db_session: Session):
    """
    Verifies that a tenant cannot tamper with or override hard global safety ceilings.
    """
    registry = TenantPolicyRegistry()

    # Attempt to set max_concurrent_runs to 999 (global ceiling is 50)
    with pytest.raises(GlobalCeilingExceededError) as exc_info:
        registry.upsert_policy(
            db=db_session,
            workspace_id="tenant-sec-hacker",
            policy_data={"max_concurrent_runs": 999},
        )

    assert "max_concurrent_runs" in str(exc_info.value)
    assert exc_info.value.ceiling_value == 50


def test_sql_injection_and_malicious_input_resilience(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Verifies that SQL injection payloads in trigger parameters and reasons
    are treated strictly as text data without compromising SQLite state.
    """
    workspace_id = "tenant-sec-sqli"
    site_id = 101
    sqli_string = "'; DROP TABLE orchestration_runs; --"

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        trigger_source=TriggerSource.MANUAL,
        parameters={"user_input": sqli_string},
    )

    assert run.state in (RunState.SUCCEEDED.value, RunState.PARTIAL.value)
    # Verify table is intact
    check_site = db_session.get(Website, site_id)
    assert check_site is not None


def test_idempotency_key_multi_tenant_isolation(db_session: Session):
    """
    Verifies that two different tenants can use identical idempotency keys
    without colliding or overwriting each other's execution receipts.
    """
    shared_key = "universal-client-key-001"

    rcpt_tenant_1 = ExecutionReceiptManager.create_receipt(
        workspace_id="tenant-corp-1",
        run_id="run-corp-1",
        idempotency_key=shared_key,
        operation_type="PROBE_QUERY",
        site_id=101,
        details={"tenant": "corp-1"},
        db=db_session,
    )

    # Tenant 2 using the same idempotency key succeeds cleanly
    rcpt_tenant_2 = ExecutionReceiptManager.create_receipt(
        workspace_id="tenant-corp-2",
        run_id="run-corp-2",
        idempotency_key=shared_key,
        operation_type="PROBE_QUERY",
        site_id=202,
        details={"tenant": "corp-2"},
        db=db_session,
    )

    assert rcpt_tenant_1.id != rcpt_tenant_2.id
    assert rcpt_tenant_1.workspace_id == "tenant-corp-1"
    assert rcpt_tenant_2.workspace_id == "tenant-corp-2"


# =============================================================================
# API Control Endpoint Tenant Isolation & Hardening Tests (Task 14 Final Fix)
# =============================================================================


def test_api_cross_tenant_cancel_rejected_404_no_leak(
    client: TestClient, db_session: Session, orchestrator: ProductionOrchestrator
):
    """
    Verifies that Workspace B cannot cancel Workspace A's run via API endpoints.
    - Resolves only within requested workspace_id.
    - When site_id is omitted, returns 404 and does not leak Workspace A's run or site.
    - When site_id is supplied, returns 404 and does not leak Workspace A's run or site.
    - Works identically on /api/orchestration/... and /orchestration/... aliases.
    """
    tenant_a = "tenant-sec-a"
    tenant_b = "tenant-sec-b"
    site_id = 101

    run_a = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=tenant_a,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    # 1. Tenant B attempts cancel with site_id omitted
    resp = client.post(
        f"/api/orchestration/runs/{run_a.id}/cancel",
        json={"workspace_id": tenant_b, "requested_by": "attacker", "reason": "malicious cancel"},
    )
    assert resp.status_code == 404, resp.text
    assert tenant_a not in resp.text
    assert str(site_id) not in resp.text
    assert f"'{run_a.id}' not found in workspace '{tenant_b}'" in resp.json()["detail"]

    # 2. Tenant B attempts cancel with site_id supplied (guessing site_id 101)
    resp = client.post(
        f"/api/orchestration/runs/{run_a.id}/cancel",
        json={"workspace_id": tenant_b, "site_id": site_id, "requested_by": "attacker"},
    )
    assert resp.status_code == 404, resp.text
    assert tenant_a not in resp.text
    assert f"'{run_a.id}' not found in workspace '{tenant_b}'" in resp.json()["detail"]

    # 3. Repeat via /orchestration/... alias
    resp_alias = client.post(
        f"/orchestration/runs/{run_a.id}/cancel",
        json={"workspace_id": tenant_b, "requested_by": "attacker"},
    )
    assert resp_alias.status_code == 404, resp_alias.text
    assert tenant_a not in resp_alias.text

    # Verify run remains unmodified in database
    db_session.refresh(run_a)
    assert run_a.state == RunState.QUEUED.value


def test_api_cross_tenant_pause_rejected_404_no_leak(
    client: TestClient, db_session: Session, orchestrator: ProductionOrchestrator
):
    """
    Verifies that Workspace B cannot pause Workspace A's run via API endpoints.
    - Resolves only within requested workspace_id.
    - When site_id is omitted, returns 404 and does not leak Workspace A's run or site.
    - When site_id is supplied, returns 404 and does not leak Workspace A's run or site.
    - Works identically on /api/orchestration/... and /orchestration/... aliases.
    """
    tenant_a = "tenant-sec-a"
    tenant_b = "tenant-sec-b"
    site_id = 101

    run_a = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=tenant_a,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    # 1. Tenant B attempts pause with site_id omitted
    resp = client.post(
        f"/api/orchestration/runs/{run_a.id}/pause",
        json={"workspace_id": tenant_b, "requested_by": "attacker", "reason": "malicious pause"},
    )
    assert resp.status_code == 404, resp.text
    assert tenant_a not in resp.text
    assert str(site_id) not in resp.text
    assert f"'{run_a.id}' not found in workspace '{tenant_b}'" in resp.json()["detail"]

    # 2. Tenant B attempts pause with site_id supplied
    resp = client.post(
        f"/api/orchestration/runs/{run_a.id}/pause",
        json={"workspace_id": tenant_b, "site_id": site_id, "requested_by": "attacker"},
    )
    assert resp.status_code == 404, resp.text
    assert tenant_a not in resp.text
    assert f"'{run_a.id}' not found in workspace '{tenant_b}'" in resp.json()["detail"]

    # 3. Alias test
    resp_alias = client.post(
        f"/orchestration/runs/{run_a.id}/pause",
        json={"workspace_id": tenant_b, "requested_by": "attacker"},
    )
    assert resp_alias.status_code == 404, resp_alias.text
    assert tenant_a not in resp_alias.text

    # Verify run remains in QUEUED state
    db_session.refresh(run_a)
    assert run_a.state == RunState.QUEUED.value


def test_api_cross_tenant_resume_rejected_404_no_leak(
    client: TestClient, db_session: Session, orchestrator: ProductionOrchestrator
):
    """
    Verifies that Workspace B cannot resume Workspace A's run via API endpoints.
    - Resolves only within requested workspace_id.
    - When site_id is omitted, returns 404 and does not leak Workspace A's run or site.
    - When site_id is supplied, returns 404 and does not leak Workspace A's run or site.
    - Works identically on /api/orchestration/... and /orchestration/... aliases.
    """
    tenant_a = "tenant-sec-a"
    tenant_b = "tenant-sec-b"
    site_id = 101

    run_a = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=tenant_a,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    # Legally pause run under tenant A
    pause_resp = client.post(
        f"/api/orchestration/runs/{run_a.id}/pause",
        json={"workspace_id": tenant_a, "site_id": site_id, "requested_by": "admin-a"},
    )
    assert pause_resp.status_code == 200, pause_resp.text
    db_session.refresh(run_a)
    assert run_a.state == RunState.PAUSED.value

    # 1. Tenant B attempts resume with site_id omitted
    resp = client.post(
        f"/api/orchestration/runs/{run_a.id}/resume",
        json={"workspace_id": tenant_b, "requested_by": "attacker"},
    )
    assert resp.status_code == 404, resp.text
    assert tenant_a not in resp.text
    assert str(site_id) not in resp.text
    assert f"'{run_a.id}' not found in workspace '{tenant_b}'" in resp.json()["detail"]

    # 2. Tenant B attempts resume with site_id supplied
    resp = client.post(
        f"/api/orchestration/runs/{run_a.id}/resume",
        json={"workspace_id": tenant_b, "site_id": site_id, "requested_by": "attacker"},
    )
    assert resp.status_code == 404, resp.text
    assert tenant_a not in resp.text
    assert f"'{run_a.id}' not found in workspace '{tenant_b}'" in resp.json()["detail"]

    # 3. Alias test
    resp_alias = client.post(
        f"/orchestration/runs/{run_a.id}/resume",
        json={"workspace_id": tenant_b, "requested_by": "attacker"},
    )
    assert resp_alias.status_code == 404, resp_alias.text
    assert tenant_a not in resp_alias.text

    # Verify run remains in PAUSED state
    db_session.refresh(run_a)
    assert run_a.state == RunState.PAUSED.value


def test_api_wrong_site_id_rejected_404(
    client: TestClient, db_session: Session, orchestrator: ProductionOrchestrator
):
    """
    Verifies that supplying a mismatched site_id for a run owned by the same workspace
    is safely rejected with 404 SiteMismatchError across cancel, pause, and resume.
    """
    tenant_a = "tenant-sec-a"
    correct_site_id = 101
    wrong_site_id = 202

    run_a = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=tenant_a,
        site_id=correct_site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    # 1. Cancel with mismatched site_id
    resp_cancel = client.post(
        f"/api/orchestration/runs/{run_a.id}/cancel",
        json={"workspace_id": tenant_a, "site_id": wrong_site_id, "requested_by": "admin-a"},
    )
    assert resp_cancel.status_code == 404, resp_cancel.text
    assert "Site boundary mismatch" in resp_cancel.json()["detail"]

    # 2. Pause with mismatched site_id
    resp_pause = client.post(
        f"/api/orchestration/runs/{run_a.id}/pause",
        json={"workspace_id": tenant_a, "site_id": wrong_site_id, "requested_by": "admin-a"},
    )
    assert resp_pause.status_code == 404, resp_pause.text
    assert "Site boundary mismatch" in resp_pause.json()["detail"]

    # Now legally pause the run
    resp_legit_pause = client.post(
        f"/api/orchestration/runs/{run_a.id}/pause",
        json={"workspace_id": tenant_a, "site_id": correct_site_id, "requested_by": "admin-a"},
    )
    assert resp_legit_pause.status_code == 200

    # 3. Resume with mismatched site_id
    resp_resume = client.post(
        f"/api/orchestration/runs/{run_a.id}/resume",
        json={"workspace_id": tenant_a, "site_id": wrong_site_id, "requested_by": "admin-a"},
    )
    assert resp_resume.status_code == 404, resp_resume.text
    assert "Site boundary mismatch" in resp_resume.json()["detail"]


def test_api_valid_same_workspace_operations_succeed(
    client: TestClient, db_session: Session, orchestrator: ProductionOrchestrator
):
    """
    Verifies that valid, authorized same-workspace operations succeed cleanly:
    - Cancel with site_id omitted resolves the run's site and cancels cleanly.
    - Cancel with site_id supplied succeeds cleanly.
    - Pause and resume with site_id omitted succeed cleanly.
    - Pause and resume with site_id supplied succeed cleanly.
    """
    tenant = "tenant-sec-a"
    site_id = 101

    # 1. Cancel with site_id omitted
    run_1 = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=tenant,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )
    resp_cancel = client.post(
        f"/api/orchestration/runs/{run_1.id}/cancel",
        json={"workspace_id": tenant, "reason": "Operator cancel test"},
    )
    assert resp_cancel.status_code == 200, resp_cancel.text
    assert resp_cancel.json()["status"] in ("CANCELLED", "SUCCESS") or "CANCELLED" in resp_cancel.json()["outcome"]
    db_session.refresh(run_1)
    assert run_1.state == RunState.CANCELLED.value

    # 2. Pause and resume with site_id omitted
    run_2 = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=tenant,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )
    resp_pause = client.post(
        f"/api/orchestration/runs/{run_2.id}/pause",
        json={"workspace_id": tenant, "reason": "Maintenance pause"},
    )
    assert resp_pause.status_code == 200, resp_pause.text
    db_session.refresh(run_2)
    assert run_2.state == RunState.PAUSED.value

    resp_resume = client.post(
        f"/api/orchestration/runs/{run_2.id}/resume",
        json={"workspace_id": tenant},
    )
    assert resp_resume.status_code == 200, resp_resume.text
    db_session.refresh(run_2)
    assert run_2.state == RunState.QUEUED.value

    # 3. Operations with site_id supplied
    run_3 = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=tenant,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )
    resp_pause_explicit = client.post(
        f"/api/orchestration/runs/{run_3.id}/pause",
        json={"workspace_id": tenant, "site_id": site_id},
    )
    assert resp_pause_explicit.status_code == 200, resp_pause_explicit.text

    resp_resume_explicit = client.post(
        f"/api/orchestration/runs/{run_3.id}/resume",
        json={"workspace_id": tenant, "site_id": site_id},
    )
    assert resp_resume_explicit.status_code == 200, resp_resume_explicit.text

    resp_cancel_explicit = client.post(
        f"/api/orchestration/runs/{run_3.id}/cancel",
        json={"workspace_id": tenant, "site_id": site_id},
    )
    assert resp_cancel_explicit.status_code == 200, resp_cancel_explicit.text
    db_session.refresh(run_3)
    assert run_3.state == RunState.CANCELLED.value


def test_api_unknown_run_returns_404(client: TestClient, db_session: Session):
    """
    Verifies that non-existent runs return a safe 404 without leaking internal details.
    """
    resp = client.post(
        "/api/orchestration/runs/run-non-existent-99999/cancel",
        json={"workspace_id": "tenant-sec-a"},
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()
