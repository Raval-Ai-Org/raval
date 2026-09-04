"""
Audit Subsystem for Raval AI Connectors (Task 11 Step 6).

Provides:
- Immutable audit event data models
- Append-only ledger with cryptographic hash chaining
- Complete provenance traceability (WHO, WHAT, WHERE, WHY, WHICH, WHEN)
- Strict mutation rejection on historical audit records
"""

from .logger import (
    AuditIntegrityError,
    AuditEventLedger,
    AuditLogger,
)
from .models import (
    AuditActionType,
    AuditEvent,
)

__all__ = [
    "AuditActionType",
    "AuditEvent",
    "AuditEventLedger",
    "AuditIntegrityError",
    "AuditLogger",
]
