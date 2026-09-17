"""
Deterministic Safety Gate Engine (Task 11 Step 4).

Evaluates whether an execution proposal:
- Is eligible for deterministic automated apply (AUTO_SAFE)
- Requires explicit human approval (ASSISTED)
- Must be blocked from automated execution (MANUAL_REVIEW)

Enforces strict policy rules on:
- Task 9 SafetyTier reuse
- Target resource allowlisting and security denylisting
- Code injection / executable script prevention
- Factual claim and author credential sensitivity
- Connector capability, authentication, and rollback availability
"""

from __future__ import annotations

import re
from typing import Any

from backend.app.fix_safety_classifier import FixSafetyClassifier, SafetyTier
from connectors.base.enums import AuthState, ConnectorCapability, ExecutionOperationType, ResourceType
from connectors.base.interface import BaseConnector
from connectors.execution.models import (
    ExecutionRequest,
    SafetyDecisionType,
    SafetyGateDecision,
)

# Denylisted sensitive targets and fields across Git and CMS targets
DENYLISTED_PATHS_REGEX = [
    re.compile(r"^\.github/workflows/.*", re.IGNORECASE),
    re.compile(r"^\.github/actions/.*", re.IGNORECASE),
    re.compile(r"^\.env(\..*)?$", re.IGNORECASE),
    re.compile(r".*\.pem$", re.IGNORECASE),
    re.compile(r".*\.key$", re.IGNORECASE),
    re.compile(r"^wp-config\.php$", re.IGNORECASE),
    re.compile(r"^\.htaccess$", re.IGNORECASE),
    re.compile(r"^nginx\.conf$", re.IGNORECASE),
]

DENYLISTED_FIELDS = {
    "user_pass",
    "user_login",
    "user_email",
    "roles",
    "caps",
    "capabilities",
    "wp_options",
    "active_plugins",
    "theme_mods",
    "plugins",
    "themes",
    "php_code",
    "custom_css",
}

# Dangerous executable code tokens
DANGEROUS_CODE_PATTERNS = [
    re.compile(r"<\?php", re.IGNORECASE),
    re.compile(r"\b(eval|exec|passthru|shell_exec|system|popen|proc_open)\s*\(", re.IGNORECASE),
    re.compile(r"<script[^>]*>\s*eval\s*\(", re.IGNORECASE),
    re.compile(r"base64_decode\s*\(", re.IGNORECASE),
]

# Sensitive claim and credential keywords
CLAIM_SENSITIVE_KEYWORDS = {
    "credential",
    "credentials",
    "author_credential",
    "academic_degree",
    "byline",
    "medical",
    "legal",
    "unsupported",
    "unsupported_claim",
    "statistical",
    "statistical_claim",
    "superlative",
    "claim",
    "corporate_identity",
    "business_registration",
    "terms_of_service",
    "privacy_policy",
}


class SafetyGate:
    """
    Deterministic Safety Gate for AI-Generated Fix Plans (Task 11 Step 4).
    """

    @classmethod
    def evaluate(
        cls,
        request: ExecutionRequest,
        connector: BaseConnector | None = None,
        fix_plan: Any | None = None,
        recommendation: Any | None = None,
        finding: Any | None = None,
    ) -> SafetyGateDecision:
        """
        Deterministically evaluates an execution request and produces a SafetyGateDecision.
        """
        reasons: list[str] = []
        blocking_reasons: list[str] = []
        required_caps = [ConnectorCapability.PREVIEW]
        
        if request.operation in (ExecutionOperationType.APPLY_CHANGE, ExecutionOperationType.ROLLBACK_CHANGE):
            required_caps.append(ConnectorCapability.APPLY)
            if request.operation == ExecutionOperationType.ROLLBACK_CHANGE:
                required_caps.append(ConnectorCapability.ROLLBACK)

        proposal = request.change_proposal
        target_res = request.target.resource
        site_ctx = request.target.site_context

        # ---------------------------------------------------------------------
        # 1. Target Resource Safety & Ambiguity Checks
        # ---------------------------------------------------------------------
        if not target_res or not target_res.resource_id or str(target_res.resource_id).lower() in ("unknown", "ambiguous", "none", "null", "undefined", "placeholder"):
            blocking_reasons.append("Target resource identifier is empty or ambiguous")
            return cls._build_blocked_decision(
                SafetyTier.MANUAL_REVIEW,
                reasons=["Target resource resolution failed or is ambiguous"],
                blocking_reasons=blocking_reasons,
            )

        res_path_or_id = str(target_res.path or target_res.resource_id).strip()

        # Check path traversal
        if ".." in res_path_or_id or res_path_or_id.startswith(("/", "\\")):
            if target_res.resource_type == ResourceType.GIT_FILE:
                blocking_reasons.append(f"Target path '{res_path_or_id}' contains path traversal or absolute prefix")

        # Check denylisted paths
        for pat in DENYLISTED_PATHS_REGEX:
            if pat.match(res_path_or_id):
                blocking_reasons.append(f"Target resource '{res_path_or_id}' is a restricted security configuration file")

        # Check denylisted fields
        target_field = proposal.parameters.get("field") or proposal.parameters.get("meta_key") if proposal else None
        if target_field and str(target_field).lower() in DENYLISTED_FIELDS:
            blocking_reasons.append(f"Target field '{target_field}' is restricted and cannot be modified")

        # ---------------------------------------------------------------------
        # 2. Dangerous Code / Executable Injection Checks
        # ---------------------------------------------------------------------
        content_to_scan: list[str] = []
        if proposal:
            if proposal.suggested_content:
                content_to_scan.append(str(proposal.suggested_content))
            if proposal.proposed_diff:
                content_to_scan.append(str(proposal.proposed_diff))
            if proposal.parameters:
                content_to_scan.append(str(proposal.parameters))

        full_content_str = " ".join(content_to_scan)
        for code_pat in DANGEROUS_CODE_PATTERNS:
            if code_pat.search(full_content_str):
                blocking_reasons.append("Proposed content contains executable code, PHP tags, or dangerous eval statements")

        # ---------------------------------------------------------------------
        # 3. Upstream Task 9 Safety Tier Resolution
        # ---------------------------------------------------------------------
        raw_tier = request.safety_tier
        if isinstance(raw_tier, str):
            try:
                tier = SafetyTier(raw_tier.lower())
            except ValueError:
                tier = SafetyTier.MANUAL_REVIEW
        elif isinstance(raw_tier, SafetyTier):
            tier = raw_tier
        else:
            tier = SafetyTier.MANUAL_REVIEW

        # If fix_plan or finding is available, verify safety classification
        if fix_plan or finding:
            finding_type = getattr(finding, "finding_type", None) if finding else None
            fix_type = getattr(fix_plan, "fix_type", None) if fix_plan else (proposal.action_type if proposal else None)
            category = getattr(fix_plan, "category", None) or "seo"

            upstream_class = FixSafetyClassifier.classify(
                finding_type=finding_type,
                category=category,
                fix_type=fix_type,
                proposed_action=proposal.action_type if proposal else None,
            )
            # Conservative precedence: if classifier indicates MANUAL_REVIEW or ASSISTED, upgrade tier
            if upstream_class.safety_tier == SafetyTier.MANUAL_REVIEW:
                tier = SafetyTier.MANUAL_REVIEW
                reasons.append(f"Upstream classifier assigned MANUAL_REVIEW: {upstream_class.reason}")
            elif upstream_class.safety_tier == SafetyTier.ASSISTED and tier == SafetyTier.AUTO_SAFE:
                tier = SafetyTier.ASSISTED
                reasons.append(f"Upstream classifier assigned ASSISTED: {upstream_class.reason}")


        # ---------------------------------------------------------------------
        # 4. Factual Claim & Author Credential Checks
        # ---------------------------------------------------------------------
        action_name = str(proposal.action_type if proposal else "").lower()
        if any(kw in action_name or kw in full_content_str.lower() for kw in CLAIM_SENSITIVE_KEYWORDS):
            tier = SafetyTier.MANUAL_REVIEW
            blocking_reasons.append("Proposal involves unsupported claims, statistical data, author credentials, or legal/policy disclosures")

        # ---------------------------------------------------------------------
        # 5. Connector Capabilities & Authorization Checks
        # ---------------------------------------------------------------------
        if connector is not None:
            # Verify auth state
            if connector.auth_state == AuthState.AUTH_FAILED:
                blocking_reasons.append("Connector authentication failed")
            elif connector.auth_state == AuthState.DISCONNECTED and not site_ctx.metadata.get("token"):
                # If credentials are not supplied
                blocking_reasons.append("Connector is disconnected or unauthenticated")

            # Verify connector capabilities
            for req_cap in required_caps:
                if not connector.capabilities.has_capability(req_cap):
                    blocking_reasons.append(f"Connector lacks declared capability: {req_cap.value}")

            # Check rollback support for AUTO_SAFE
            if tier == SafetyTier.AUTO_SAFE and not connector.capabilities.supports_rollback:
                # Downgrade to ASSISTED if rollback is not supported
                tier = SafetyTier.ASSISTED
                reasons.append("Connector does not support automated rollback; downgraded from AUTO_SAFE to ASSISTED")
        elif tier == SafetyTier.AUTO_SAFE and not site_ctx.capabilities.supports_rollback:
            tier = SafetyTier.ASSISTED
            reasons.append("Site context indicates rollback is unsupported; downgraded from AUTO_SAFE to ASSISTED")

        # ---------------------------------------------------------------------
        # 6. Final Decision Synthesis
        # ---------------------------------------------------------------------
        # If any hard blocking reason exists -> BLOCKED / MANUAL_REVIEW
        if blocking_reasons:
            return cls._build_blocked_decision(
                safety_tier=SafetyTier.MANUAL_REVIEW,
                reasons=reasons or ["Operation rejected due to policy or security violations"],
                blocking_reasons=blocking_reasons,
                required_capabilities=required_caps,
            )

        if tier == SafetyTier.MANUAL_REVIEW:
            return cls._build_blocked_decision(
                safety_tier=SafetyTier.MANUAL_REVIEW,
                reasons=reasons or ["Change involves high-risk, credential, or unverified claims requiring manual review"],
                blocking_reasons=["MANUAL_REVIEW tier fixes cannot be executed automatically"],
                required_capabilities=required_caps,
            )

        if tier == SafetyTier.ASSISTED:
            reasons.append("ASSISTED fix plan requires explicit human approval prior to mutation")
            return SafetyGateDecision(
                decision=SafetyDecisionType.REQUIRES_APPROVAL,
                safety_tier=SafetyTier.ASSISTED,
                is_allowed=True,
                is_auto_executable=False,
                requires_approval=True,
                reasons=reasons,
                blocking_reasons=[],
                required_approval="admin_or_editor",
                required_capabilities=required_caps,
                rollback_required=True,
                validation_required=True,
                safe_bounds={"is_destructive": False, "reversible": True, "claim_sensitive": False},
                metadata={"action": action_name, "tier": tier.value},
            )

        # tier == SafetyTier.AUTO_SAFE
        reasons.append("Deterministic, reversible structural/metadata fix meets all AUTO_SAFE criteria")
        return SafetyGateDecision(
            decision=SafetyDecisionType.ALLOWED_AUTO,
            safety_tier=SafetyTier.AUTO_SAFE,
            is_allowed=True,
            is_auto_executable=True,
            requires_approval=False,
            reasons=reasons,
            blocking_reasons=[],
            required_approval=None,
            required_capabilities=required_caps,
            rollback_required=True,
            validation_required=True,
            safe_bounds={"is_destructive": False, "reversible": True, "claim_sensitive": False},
            metadata={"action": action_name, "tier": tier.value},
        )

    @classmethod
    def _build_blocked_decision(
        cls,
        safety_tier: SafetyTier,
        reasons: list[str],
        blocking_reasons: list[str],
        required_capabilities: list[ConnectorCapability] | None = None,
    ) -> SafetyGateDecision:
        return SafetyGateDecision(
            decision=SafetyDecisionType.BLOCKED,
            safety_tier=safety_tier,
            is_allowed=False,
            is_auto_executable=False,
            requires_approval=True,
            reasons=reasons,
            blocking_reasons=blocking_reasons,
            required_approval="manual_review_only",
            required_capabilities=required_capabilities or [],
            rollback_required=True,
            validation_required=True,
            safe_bounds={"is_destructive": True, "reversible": False, "claim_sensitive": True},
            metadata={"status": "blocked"},
        )
