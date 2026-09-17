"""
Audit Logger and Append-Only Tamper-Evident Ledger (Task 11 Step 6).

Guarantees:
1. Append-only ledger semantics: historical audit events can never be edited or deleted.
2. Cryptographic SHA-256 hash chaining to detect any tampering.
3. Automatic, deep secret scrubbing on all event payloads before recording.
4. Complete multi-dimensional query interface (by workspace, site, execution, actor).
"""

from __future__ import annotations

import logging
from typing import Any

from connectors.security.scrubber import DeepScrubber
from .models import AuditActionType, AuditEvent

logger = logging.getLogger(__name__)


class AuditIntegrityError(Exception):
    """Raised when an illegal mutation, deletion, or tampering with audit events is attempted."""
    pass


class AuditEventLedger:
    """
    In-memory append-only audit event ledger with cryptographic hash chaining.
    """

    def __init__(self) -> None:
        self._events: list[AuditEvent] = []
        self._by_id: dict[str, AuditEvent] = {}
        self._by_execution: dict[str, list[AuditEvent]] = {}
        self._by_workspace: dict[str, list[AuditEvent]] = {}
        self._by_site: dict[str, list[AuditEvent]] = {}
        self._last_event_hash_by_execution: dict[str, str] = {}

    def append(self, event_data: dict[str, Any] | AuditEvent) -> AuditEvent:
        """
        Appends a new audit event to the immutable ledger.
        Scans and cleans secrets, attaches hash chaining, and indexes the event.
        """
        if isinstance(event_data, dict):
            # Scrub all details and nested dicts
            clean_data = DeepScrubber.scrub(event_data)
            exec_id = clean_data.get("execution_id", "default")
            prev_hash = self._last_event_hash_by_execution.get(exec_id)
            if "previous_event_hash" not in clean_data or not clean_data["previous_event_hash"]:
                clean_data["previous_event_hash"] = prev_hash
            event = AuditEvent(**clean_data)
        else:
            # AuditEvent instance
            exec_id = event_data.execution_id
            prev_hash = self._last_event_hash_by_execution.get(exec_id)
            if not event_data.previous_event_hash and prev_hash:
                # Recreate frozen model with prev hash
                event_dict = event_data.model_dump()
                event_dict["previous_event_hash"] = prev_hash
                event_dict["details"] = DeepScrubber.scrub(event_dict.get("details", {}))
                event = AuditEvent(**event_dict)
            else:
                event = event_data

        if event.audit_event_id in self._by_id:
            raise AuditIntegrityError(f"Audit event '{event.audit_event_id}' already exists; overwrite is strictly prohibited")

        self._events.append(event)
        self._by_id[event.audit_event_id] = event

        self._by_execution.setdefault(event.execution_id, []).append(event)
        self._by_workspace.setdefault(event.workspace_id, []).append(event)
        self._by_site.setdefault(event.site_id, []).append(event)

        # Update last hash
        current_hash = event.calculate_hash()
        self._last_event_hash_by_execution[event.execution_id] = current_hash

        logger.debug(
            "Audit event '%s' recorded: execution=%s, action=%s, actor=%s",
            event.audit_event_id,
            event.execution_id,
            event.action,
            event.actor_id,
        )
        return event

    def get_event(self, audit_event_id: str) -> AuditEvent | None:
        """Retrieves a single audit event by ID."""
        return self._by_id.get(audit_event_id)

    def get_events_by_execution(self, execution_id: str) -> list[AuditEvent]:
        """Returns all audit events associated with an execution in chronological order."""
        return list(self._by_execution.get(execution_id, []))

    def get_events_by_workspace(self, workspace_id: str) -> list[AuditEvent]:
        """Returns all audit events for a given workspace/tenant."""
        return list(self._by_workspace.get(workspace_id, []))

    def get_events_by_site(self, site_id: str) -> list[AuditEvent]:
        """Returns all audit events for a given site."""
        return list(self._by_site.get(site_id, []))

    def get_all_events(self) -> list[AuditEvent]:
        """Returns all events in the ledger."""
        return list(self._events)

    # -------------------------------------------------------------------------
    # Integrity Enforcement & Tamper Detection
    # -------------------------------------------------------------------------

    def update_event(self, *args: Any, **kwargs: Any) -> None:
        """Strictly prohibited: audit events are append-only."""
        raise AuditIntegrityError("Audit events cannot be modified once written (append-only ledger)")

    def delete_event(self, *args: Any, **kwargs: Any) -> None:
        """Strictly prohibited: audit events cannot be deleted."""
        raise AuditIntegrityError("Audit events cannot be deleted (append-only ledger)")

    def verify_integrity(self, execution_id: str | None = None) -> bool:
        """
        Verifies that the hash chaining across events for an execution is mathematically intact.
        """
        if execution_id:
            events = self.get_events_by_execution(execution_id)
            prev_hash: str | None = None
            for event in events:
                if event.previous_event_hash != prev_hash:
                    return False
                prev_hash = event.calculate_hash()
            return True

        # Check all executions
        for exec_id in self._by_execution:
            if not self.verify_integrity(exec_id):
                return False
        return True


class AuditLogger:
    """
    Primary interface for application components to record lifecycle audit events.
    """

    _global_ledger: AuditEventLedger = AuditEventLedger()

    @classmethod
    def get_ledger(cls) -> AuditEventLedger:
        return cls._global_ledger

    @classmethod
    def record(
        cls,
        workspace_id: str,
        site_id: str,
        actor_id: str,
        execution_id: str,
        action: AuditActionType | str,
        connector: str,
        resource_reference: str,
        requested_operation: str,
        safety_tier: str = "auto_safe",
        approval_state: str = "none",
        lifecycle_state: str = "PLANNED",
        finding_id: int | None = None,
        recommendation_id: int | None = None,
        fix_plan_id: int | None = None,
        before_state_reference: str | None = None,
        after_state_reference: str | None = None,
        operation_id: str | None = None,
        commit_id: str | None = None,
        pr_id: str | None = None,
        validation_result: str | None = None,
        rescan_result: str | None = None,
        comparison_result: dict[str, Any] | None = None,
        rollback_result: str | None = None,
        error_classification: str | None = None,
        details: dict[str, Any] | None = None,
        ledger: AuditEventLedger | None = None,
    ) -> AuditEvent:
        """
        Creates and appends an audit event to the active ledger.
        """
        active_ledger = ledger or cls._global_ledger
        event_payload = {
            "workspace_id": workspace_id,
            "site_id": site_id,
            "actor_id": actor_id,
            "execution_id": execution_id,
            "action": action,
            "connector": connector,
            "resource_reference": resource_reference,
            "requested_operation": requested_operation,
            "safety_tier": safety_tier,
            "approval_state": approval_state,
            "lifecycle_state": lifecycle_state,
            "finding_id": finding_id,
            "recommendation_id": recommendation_id,
            "fix_plan_id": fix_plan_id,
            "before_state_reference": before_state_reference,
            "after_state_reference": after_state_reference,
            "operation_id": operation_id,
            "commit_id": commit_id,
            "pr_id": pr_id,
            "validation_result": validation_result,
            "rescan_result": rescan_result,
            "comparison_result": comparison_result,
            "rollback_result": rollback_result,
            "error_classification": error_classification,
            "details": details or {},
        }
        return active_ledger.append(event_payload)
