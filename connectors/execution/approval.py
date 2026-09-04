"""
Explicit Human Approval Manager (Task 11 Step 4).

Manages cryptographically bound approval records for ASSISTED remediation fixes.
Guarantees:
- Approval is strictly bound to the exact request, fix plan, target resource, and proposal hash
- If proposal content or target changes, previous approval is immediately invalidated
- Approvals cannot be cross-applied to unrelated requests or fix plans
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from connectors.base.models import ChangeProposal
from connectors.execution.errors import StaleApprovalError
from connectors.execution.models import ApprovalRecord, ExecutionRequest


def compute_proposal_hash(proposal: ChangeProposal | None, target_id: str = "") -> str:
    """
    Computes a deterministic SHA-256 hash of a change proposal's mutation content and parameters.
    """
    if proposal is None:
        raw_repr = f"target:{target_id}:empty_proposal"
    else:
        # Normalize dict representation
        content_key = str(proposal.suggested_content or proposal.proposed_diff or "")
        params_key = json.dumps(proposal.parameters or {}, sort_keys=True)
        raw_repr = f"target:{target_id}:action:{proposal.action_type}:content:{content_key}:params:{params_key}:fix_plan:{proposal.fix_plan_id}"

    return hashlib.sha256(raw_repr.encode("utf-8")).hexdigest()


class ApprovalManager:
    """
    Auditable manager for human review approvals.
    """

    @classmethod
    def create_approval(
        cls,
        request: ExecutionRequest,
        approved_by: str,
        approver_role: str = "admin",
        comments: str | None = None,
    ) -> ApprovalRecord:
        """
        Generates an immutable ApprovalRecord bound to this specific execution request.
        """
        target_res_id = request.target.resource.canonical_id
        prop_hash = compute_proposal_hash(request.change_proposal, target_id=target_res_id)

        return ApprovalRecord(
            request_id=request.request_id,
            fix_plan_id=request.fix_plan_id,
            target_resource_id=target_res_id,
            proposal_hash=prop_hash,
            approved_by=approved_by,
            approver_role=approver_role,
            comments=comments,
            metadata={
                "action": request.change_proposal.action_type if request.change_proposal else None,
                "tier": str(request.safety_tier),
            },
        )

    @classmethod
    def verify_approval(
        cls,
        request: ExecutionRequest,
        approval: ApprovalRecord | None,
    ) -> tuple[bool, str | None]:
        """
        Verifies that an ApprovalRecord is valid, matches the execution request, and has not drifted.
        """
        if approval is None:
            return False, "No approval record provided for ASSISTED execution"

        # 1. Verify Request Binding
        if approval.request_id != request.request_id:
            return False, f"Approval request_id '{approval.request_id}' does not match request '{request.request_id}'"

        # 2. Verify FixPlan Binding (if present)
        if request.fix_plan_id and approval.fix_plan_id and approval.fix_plan_id != request.fix_plan_id:
            return False, f"Approval fix_plan_id '{approval.fix_plan_id}' does not match request '{request.fix_plan_id}'"

        # 3. Verify Target Resource Binding
        target_res_id = request.target.resource.canonical_id
        if approval.target_resource_id != target_res_id:
            return False, f"Approval target '{approval.target_resource_id}' does not match request target '{target_res_id}'"

        # 4. Verify Proposal Hash (Detect drift or post-approval edits)
        current_hash = compute_proposal_hash(request.change_proposal, target_id=target_res_id)
        if approval.proposal_hash != current_hash:
            return False, "Approval is stale: proposal content or parameters were modified after approval was granted"

        return True, None
