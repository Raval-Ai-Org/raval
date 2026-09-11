"""
Production Orchestration & Monitoring - Durable Execution Receipts.

Manages durable execution receipts for external side effects and connector operations,
enforcing at-least-once execution + idempotency protection without claiming universal
exactly-once execution for uncoordinated external third-party systems.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from connectors.base.security import sanitize_payload

from .enums import ReceiptStatus
from .exceptions import ReceiptConflictError, TenantMismatchError
from .models import ExecutionReceipt

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ExecutionReceiptManager:
    """
    Service managing lifecycle, verification, and ambiguity resolution for ExecutionReceipt entities.
    """

    @classmethod
    def create_receipt(
        cls,
        workspace_id: str,
        run_id: str,
        idempotency_key: str,
        operation_type: str = "operation",
        db: Session | None = None,
        site_id: int = 0,
        provider_name: str | None = None,
        stage_id: str | None = None,
        job_id: str | None = None,
        worker_id: str | None = None,
        request_payload: dict[str, Any] | None = None,
        details: dict[str, Any] | None = None,
        attempt: int = 1,
        **kwargs,
    ) -> ExecutionReceipt:
        """
        Creates an ExecutionReceipt before initiating an external operation.
        Raises ReceiptConflictError if a receipt with identical (workspace_id, idempotency_key) already exists.
        """
        if db is None and "db" in kwargs:
            db = kwargs["db"]
        if db is None:
            raise ValueError("Database session 'db' is required.")

        clean_idem_key = idempotency_key.strip()
        clean_workspace_id = workspace_id.strip()

        # Check for existing receipt with identical (workspace_id, idempotency_key)
        existing = (
            db.query(ExecutionReceipt)
            .filter(
                ExecutionReceipt.workspace_id == clean_workspace_id,
                ExecutionReceipt.idempotency_key == clean_idem_key,
            )
            .first()
        )

        if existing:
            raise ReceiptConflictError(
                idempotency_key=clean_idem_key,
                existing_receipt_id=existing.id,
            )

        receipt_id = f"rcpt_{uuid4().hex[:16]}"
        now = _utc_now()
        clean_details = sanitize_payload(details or {})
        if request_payload:
            clean_details["request_payload"] = sanitize_payload(request_payload)
        if provider_name:
            clean_details["provider_name"] = provider_name

        receipt = ExecutionReceipt(
            id=receipt_id,
            workspace_id=clean_workspace_id,
            site_id=site_id,
            run_id=run_id,
            stage_id=stage_id,
            job_id=job_id,
            worker_id=worker_id,
            operation_type=operation_type,
            idempotency_key=clean_idem_key,
            status=ReceiptStatus.PENDING.value,
            external_reference=None,
            is_confirmed=False,
            is_safe_to_retry=True,
            attempt=attempt,
            details=clean_details,
            created_at=now,
            updated_at=now,
        )

        db.add(receipt)
        db.commit()
        db.refresh(receipt)

        logger.info(
            "Created execution receipt '%s' (operation='%s', status=PENDING, key='%s')",
            receipt.id,
            operation_type,
            clean_idem_key,
        )
        return receipt

    @classmethod
    def confirm_receipt(
        cls,
        workspace_id: str,
        receipt_id: str | None = None,
        idempotency_key: str | None = None,
        external_reference: str | None = None,
        external_reference_id: str | None = None,
        response_payload: dict[str, Any] | None = None,
        details: dict[str, Any] | None = None,
        db: Session | None = None,
        **kwargs,
    ) -> ExecutionReceipt:
        """
        Marks an execution receipt as CONFIRMED, certifying the external side effect succeeded.
        """
        if db is None and "db" in kwargs:
            db = kwargs["db"]
        if db is None:
            raise ValueError("Database session 'db' is required.")

        receipt = None
        if receipt_id:
            receipt = cls.get_receipt(workspace_id=workspace_id, receipt_id=receipt_id, db=db)
        elif idempotency_key:
            receipt = cls.get_receipt_by_idempotency_key(workspace_id=workspace_id, idempotency_key=idempotency_key, db=db)

        if not receipt:
            raise ValueError(f"Receipt not found for confirmation in workspace '{workspace_id}'.")

        ref = external_reference_id or external_reference
        receipt.status = ReceiptStatus.CONFIRMED.value
        receipt.is_confirmed = True
        receipt.is_safe_to_retry = True
        receipt.external_reference = ref
        receipt.updated_at = _utc_now()

        receipt_details = dict(receipt.details or {})
        if response_payload:
            receipt_details["response_payload"] = sanitize_payload(response_payload)
        if details:
            receipt_details.update(sanitize_payload(details))
        receipt.details = receipt_details

        db.commit()
        db.refresh(receipt)
        logger.info("Confirmed execution receipt '%s' (ext_ref='%s')", receipt.id, ref)
        return receipt

    @classmethod
    def fail_receipt(
        cls,
        workspace_id: str,
        receipt_id: str | None = None,
        idempotency_key: str | None = None,
        error_message: str = "Operation failed",
        db: Session | None = None,
        is_safe_to_retry: bool = True,
        details: dict[str, Any] | None = None,
        **kwargs,
    ) -> ExecutionReceipt:
        """
        Marks an execution receipt as FAILED when an operation definitively failed without side effects.
        """
        if db is None and "db" in kwargs:
            db = kwargs["db"]
        if db is None:
            raise ValueError("Database session 'db' is required.")

        receipt = None
        if receipt_id:
            receipt = cls.get_receipt(workspace_id=workspace_id, receipt_id=receipt_id, db=db)
        elif idempotency_key:
            receipt = cls.get_receipt_by_idempotency_key(workspace_id=workspace_id, idempotency_key=idempotency_key, db=db)

        if not receipt:
            raise ValueError(f"Receipt not found in workspace '{workspace_id}'.")

        receipt.status = ReceiptStatus.FAILED.value
        receipt.is_confirmed = False
        receipt.is_safe_to_retry = is_safe_to_retry
        receipt.updated_at = _utc_now()

        receipt_details = dict(receipt.details or {})
        receipt_details["error"] = error_message
        if details:
            receipt_details.update(sanitize_payload(details))
        receipt.details = receipt_details

        db.commit()
        db.refresh(receipt)
        logger.info("Failed execution receipt '%s' (safe_to_retry=%s)", receipt.id, is_safe_to_retry)
        return receipt

    @classmethod
    def mark_receipt_ambiguous(
        cls,
        workspace_id: str,
        receipt_id: str | None = None,
        idempotency_key: str | None = None,
        reason: str = "External operation state ambiguous",
        db: Session | None = None,
        details: dict[str, Any] | None = None,
        **kwargs,
    ) -> ExecutionReceipt:
        """
        Marks an execution receipt as AMBIGUOUS when a worker failed or disconnected
        while the external side effect was in-flight.
        Strictly sets is_safe_to_retry = False to prevent blind duplicate executions.
        """
        if db is None and "db" in kwargs:
            db = kwargs["db"]
        if db is None:
            raise ValueError("Database session 'db' is required.")

        receipt = None
        if receipt_id:
            receipt = cls.get_receipt(workspace_id=workspace_id, receipt_id=receipt_id, db=db)
        elif idempotency_key:
            receipt = cls.get_receipt_by_idempotency_key(workspace_id=workspace_id, idempotency_key=idempotency_key, db=db)

        if not receipt:
            raise ValueError(f"Receipt not found in workspace '{workspace_id}'.")

        receipt.status = ReceiptStatus.AMBIGUOUS.value
        receipt.is_confirmed = False
        receipt.is_safe_to_retry = False  # Strictly forbidden to retry blindly
        receipt.updated_at = _utc_now()

        receipt_details = dict(receipt.details or {})
        receipt_details["ambiguity_reason"] = reason
        if details:
            receipt_details.update(sanitize_payload(details))
        receipt.details = receipt_details

        db.commit()
        db.refresh(receipt)
        logger.warning(
            "Marked execution receipt '%s' as AMBIGUOUS: %s (is_safe_to_retry=False)",
            receipt.id,
            reason,
        )
        return receipt

    mark_ambiguous = mark_receipt_ambiguous

    @classmethod
    def is_operation_safe_to_retry(
        cls,
        workspace_id: str,
        idempotency_key: str,
        db: Session,
    ) -> bool:
        """
        Returns False if a receipt exists and is marked AMBIGUOUS; True otherwise.
        """
        receipt = cls.get_receipt_by_idempotency_key(workspace_id, idempotency_key, db)
        if not receipt:
            return True
        return bool(receipt.is_safe_to_retry)

    @classmethod
    def get_receipt(
        cls,
        workspace_id: str,
        receipt_id: str,
        db: Session,
    ) -> ExecutionReceipt:
        """
        Retrieves a receipt by ID or idempotency_key enforcing tenant workspace isolation.
        """
        receipt = db.query(ExecutionReceipt).filter(ExecutionReceipt.id == receipt_id).first()
        if not receipt:
            # Fallback to lookup by idempotency_key within workspace
            receipt = (
                db.query(ExecutionReceipt)
                .filter(
                    ExecutionReceipt.workspace_id == workspace_id,
                    ExecutionReceipt.idempotency_key == receipt_id,
                )
                .first()
            )

        if not receipt:
            raise ValueError(f"ExecutionReceipt '{receipt_id}' not found.")

        if receipt.workspace_id != workspace_id:
            raise TenantMismatchError(
                request_workspace_id=workspace_id,
                target_workspace_id=receipt.workspace_id,
                entity_id=receipt_id,
            )
        return receipt

    @classmethod
    def get_receipt_by_idempotency_key(
        cls,
        workspace_id: str,
        idempotency_key: str,
        db: Session,
    ) -> ExecutionReceipt | None:
        """
        Retrieves a receipt by its unique (workspace_id, idempotency_key).
        """
        return (
            db.query(ExecutionReceipt)
            .filter(
                ExecutionReceipt.workspace_id == workspace_id,
                ExecutionReceipt.idempotency_key == idempotency_key,
            )
            .first()
        )

    @classmethod
    def list_receipts_for_run(
        cls,
        workspace_id: str,
        run_id: str,
        db: Session,
    ) -> list[ExecutionReceipt]:
        """
        Lists all execution receipts associated with a specific run within tenant boundary.
        """
        return (
            db.query(ExecutionReceipt)
            .filter(
                ExecutionReceipt.workspace_id == workspace_id,
                ExecutionReceipt.run_id == run_id,
            )
            .order_by(ExecutionReceipt.created_at.asc())
            .all()
        )

    @classmethod
    def record_receipt(
        cls,
        db: Session,
        workspace_id: str,
        run_id: str,
        idempotency_key: str,
        operation_type: str = "operation",
        site_id: int = 0,
        stage_id: str | None = None,
        job_id: str | None = None,
        worker_id: str | None = None,
        status: Any = ReceiptStatus.CONFIRMED,
        details: dict[str, Any] | None = None,
        request_payload: dict[str, Any] | None = None,
        response_payload: dict[str, Any] | None = None,
        external_reference: str | None = None,
        attempt: int = 1,
        **kwargs,
    ) -> ExecutionReceipt:
        """
        Records and confirms an execution receipt idempotently.
        """
        clean_idem_key = idempotency_key.strip()
        clean_workspace_id = workspace_id.strip()

        existing = (
            db.query(ExecutionReceipt)
            .filter(
                ExecutionReceipt.workspace_id == clean_workspace_id,
                ExecutionReceipt.idempotency_key == clean_idem_key,
            )
            .first()
        )
        if existing:
            return existing

        receipt_id = f"rcpt_{uuid4().hex[:16]}"
        now = _utc_now()
        clean_details = sanitize_payload(details or {})
        if request_payload:
            clean_details["request_payload"] = sanitize_payload(request_payload)
        if response_payload:
            clean_details["response_payload"] = sanitize_payload(response_payload)

        status_val = status.value if hasattr(status, "value") else str(status)
        if status_val.lower() == "success":
            status_val = ReceiptStatus.CONFIRMED.value

        receipt = ExecutionReceipt(
            id=receipt_id,
            workspace_id=clean_workspace_id,
            site_id=site_id,
            run_id=run_id,
            stage_id=stage_id,
            job_id=job_id,
            worker_id=worker_id,
            operation_type=operation_type,
            idempotency_key=clean_idem_key,
            status=status_val,
            external_reference=external_reference,
            is_confirmed=(status_val == ReceiptStatus.CONFIRMED.value),
            is_safe_to_retry=True,
            attempt=attempt,
            details=clean_details,
            created_at=now,
            updated_at=now,
        )

        db.add(receipt)
        db.commit()
        db.refresh(receipt)
        return receipt

