"""
Production Orchestration & Monitoring - Evidence TTL Policies.

Defines deterministic, configurable Time-To-Live (TTL) policies across all
evidence categories, ensuring that evidence age, warning (aging) thresholds,
and expiration thresholds are strictly governed without hardcoded scattering.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import logging
from typing import Any

from .enums import EvidenceType

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EvidenceTTLPolicy:
    """
    Deterministic TTL policy configuration for an evidence category.

    Threshold constraints:
    0 < warning_threshold_seconds <= ttl_seconds <= expiration_threshold_seconds
    """

    evidence_type: EvidenceType
    ttl_seconds: int
    warning_threshold_seconds: int = 0
    expiration_threshold_seconds: int = 0
    refresh_eligibility: bool = True
    refresh_priority: int = 5  # 1 (highest/most urgent) to 10 (lowest)
    provider_considerations: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.ttl_seconds <= 0:
            raise ValueError(f"ttl_seconds must be positive, got {self.ttl_seconds}")

        warn = self.warning_threshold_seconds
        if warn <= 0:
            warn = max(1, int(self.ttl_seconds * 0.75))
            object.__setattr__(self, "warning_threshold_seconds", warn)

        exp = self.expiration_threshold_seconds
        if exp <= 0:
            exp = max(warn, int(self.ttl_seconds * 2))
            object.__setattr__(self, "expiration_threshold_seconds", exp)

        if self.warning_threshold_seconds <= 0:
            raise ValueError(f"warning_threshold_seconds must be positive, got {self.warning_threshold_seconds}")
        if self.warning_threshold_seconds > self.ttl_seconds:
            raise ValueError(
                f"warning_threshold_seconds ({self.warning_threshold_seconds}) cannot exceed ttl_seconds ({self.ttl_seconds})"
            )
        if self.ttl_seconds > self.expiration_threshold_seconds:
            raise ValueError(
                f"ttl_seconds ({self.ttl_seconds}) cannot exceed expiration_threshold_seconds ({self.expiration_threshold_seconds})"
            )
        if not (1 <= self.refresh_priority <= 10):
            raise ValueError(f"refresh_priority must be between 1 and 10, got {self.refresh_priority}")

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["evidence_type"] = self.evidence_type.value
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvidenceTTLPolicy:
        kwargs = dict(data)
        if isinstance(kwargs.get("evidence_type"), str):
            kwargs["evidence_type"] = EvidenceType(kwargs["evidence_type"])
        return cls(**kwargs)


# ==============================================================================
# Canonical Default TTL Policies by Evidence Category
# ==============================================================================

DEFAULT_EVIDENCE_POLICIES: dict[EvidenceType, EvidenceTTLPolicy] = {
    # 1. Crawl Evidence: 24h fresh, aging at 18h, expired at 48h
    EvidenceType.CRAWL: EvidenceTTLPolicy(
        evidence_type=EvidenceType.CRAWL,
        ttl_seconds=86400,
        warning_threshold_seconds=64800,
        expiration_threshold_seconds=172800,
        refresh_eligibility=True,
        refresh_priority=3,
        provider_considerations={"requires_active_crawler": True},
    ),
    # 2. SEO / Page Content Observations: 24h fresh, aging at 18h, expired at 48h
    EvidenceType.PAGE_SEO: EvidenceTTLPolicy(
        evidence_type=EvidenceType.PAGE_SEO,
        ttl_seconds=86400,
        warning_threshold_seconds=64800,
        expiration_threshold_seconds=172800,
        refresh_eligibility=True,
        refresh_priority=4,
    ),
    # 3. Category Score Observations: 12h fresh, aging at 9h, expired at 24h
    EvidenceType.SCORE: EvidenceTTLPolicy(
        evidence_type=EvidenceType.SCORE,
        ttl_seconds=43200,
        warning_threshold_seconds=32400,
        expiration_threshold_seconds=86400,
        refresh_eligibility=True,
        refresh_priority=3,
    ),
    # 4. AI Visibility Observations: 6h fresh, aging at 4.5h, expired at 12h
    EvidenceType.AI_VISIBILITY: EvidenceTTLPolicy(
        evidence_type=EvidenceType.AI_VISIBILITY,
        ttl_seconds=21600,
        warning_threshold_seconds=16200,
        expiration_threshold_seconds=43200,
        refresh_eligibility=True,
        refresh_priority=1,
        provider_considerations={"upstream_llm_rate_limited": True},
    ),
    # 5. AI Answer Observations: 6h fresh, aging at 4.5h, expired at 12h
    EvidenceType.AI_ANSWER: EvidenceTTLPolicy(
        evidence_type=EvidenceType.AI_ANSWER,
        ttl_seconds=21600,
        warning_threshold_seconds=16200,
        expiration_threshold_seconds=43200,
        refresh_eligibility=True,
        refresh_priority=1,
        provider_considerations={"upstream_llm_rate_limited": True},
    ),
    # 6. Citation Observations: 12h fresh, aging at 9h, expired at 24h
    EvidenceType.CITATION: EvidenceTTLPolicy(
        evidence_type=EvidenceType.CITATION,
        ttl_seconds=43200,
        warning_threshold_seconds=32400,
        expiration_threshold_seconds=86400,
        refresh_eligibility=True,
        refresh_priority=2,
    ),
    # 7. Competitor Observations: 48h fresh, aging at 36h, expired at 96h
    EvidenceType.COMPETITOR: EvidenceTTLPolicy(
        evidence_type=EvidenceType.COMPETITOR,
        ttl_seconds=172800,
        warning_threshold_seconds=129600,
        expiration_threshold_seconds=345600,
        refresh_eligibility=True,
        refresh_priority=5,
    ),
    # 8. External Authority Evidence: 7 days fresh, aging at 5 days, expired at 14 days
    EvidenceType.EXTERNAL_AUTHORITY: EvidenceTTLPolicy(
        evidence_type=EvidenceType.EXTERNAL_AUTHORITY,
        ttl_seconds=604800,
        warning_threshold_seconds=432000,
        expiration_threshold_seconds=1209600,
        refresh_eligibility=True,
        refresh_priority=6,
    ),
    # 9. Search Performance / Analytics: 24h fresh, aging at 18h, expired at 48h
    EvidenceType.SEARCH_PERFORMANCE: EvidenceTTLPolicy(
        evidence_type=EvidenceType.SEARCH_PERFORMANCE,
        ttl_seconds=86400,
        warning_threshold_seconds=64800,
        expiration_threshold_seconds=172800,
        refresh_eligibility=True,
        refresh_priority=4,
    ),
    # 10. Validation Evidence: 12h fresh, aging at 9h, expired at 24h
    EvidenceType.VALIDATION: EvidenceTTLPolicy(
        evidence_type=EvidenceType.VALIDATION,
        ttl_seconds=43200,
        warning_threshold_seconds=32400,
        expiration_threshold_seconds=86400,
        refresh_eligibility=True,
        refresh_priority=2,
    ),
    # 11. Execution / Change Evidence: 1h fresh, aging at 45m, expired at 2h
    EvidenceType.EXECUTION_CHANGE: EvidenceTTLPolicy(
        evidence_type=EvidenceType.EXECUTION_CHANGE,
        ttl_seconds=3600,
        warning_threshold_seconds=2700,
        expiration_threshold_seconds=7200,
        refresh_eligibility=True,
        refresh_priority=1,
    ),
}


# ==============================================================================
# Freshness Policy Registry
# ==============================================================================

class _PolicyRegistryDispatcher:
    def __init__(self, method_name: str):
        self.method_name = method_name

    def __get__(self, obj: Any, objtype: Any = None) -> Any:
        if obj is not None:
            return getattr(obj, f"_{self.method_name}_impl")
        return getattr(objtype.default(), f"_{self.method_name}_impl")


class FreshnessPolicyRegistry:
    """
    Thread-safe registry for looking up and overriding evidence TTL policies.
    Supports global defaults as well as workspace- or site-specific overrides.
    Can be used both as an instance and as a class-level singleton registry.
    """

    _default_instance: FreshnessPolicyRegistry | None = None

    @classmethod
    def default(cls) -> FreshnessPolicyRegistry:
        if cls._default_instance is None:
            cls._default_instance = FreshnessPolicyRegistry()
        return cls._default_instance

    def __init__(self, default_policies: dict[EvidenceType, EvidenceTTLPolicy] | None = None) -> None:
        self._defaults = dict(default_policies or DEFAULT_EVIDENCE_POLICIES)
        # key format: (workspace_id, site_id, evidence_type)
        self._overrides: dict[tuple[str | None, int | str | None, EvidenceType], EvidenceTTLPolicy] = {}

    def _get_policy_impl(
        self,
        evidence_type: EvidenceType | str,
        workspace_id: str | None = None,
        site_id: int | str | None = None,
        tenant_id: str | None = None,
    ) -> EvidenceTTLPolicy:
        """
        Retrieves the TTL policy for an evidence type, prioritizing site-specific,
        then workspace-specific, then global defaults.
        """
        effective_ws = tenant_id if tenant_id is not None else workspace_id
        etype = EvidenceType(evidence_type) if isinstance(evidence_type, str) else evidence_type

        # 1. Site-level override
        if effective_ws is not None and site_id is not None:
            key = (effective_ws, site_id, etype)
            if key in self._overrides:
                return self._overrides[key]

        # 2. Workspace-level override
        if effective_ws is not None:
            key = (effective_ws, None, etype)
            if key in self._overrides:
                return self._overrides[key]

        # 3. Global default
        if etype in self._defaults:
            return self._defaults[etype]

        raise KeyError(f"No TTL policy configured for evidence type: '{etype}'")

    def _set_override_impl(
        self,
        policy: EvidenceTTLPolicy,
        workspace_id: str | None = None,
        site_id: int | str | None = None,
        tenant_id: str | None = None,
    ) -> None:
        """Sets a policy override for a specific workspace, site, or global evidence type."""
        effective_ws = tenant_id if tenant_id is not None else workspace_id
        key = (effective_ws, site_id, policy.evidence_type)
        self._overrides[key] = policy
        logger.info(
            "Registered TTL policy override for evidence_type='%s' (workspace='%s', site='%s', ttl=%ds)",
            policy.evidence_type.value,
            effective_ws,
            site_id,
            policy.ttl_seconds,
        )

    def _register_override_impl(
        self,
        policy: EvidenceTTLPolicy,
        workspace_id: str | None = None,
        site_id: int | str | None = None,
        tenant_id: str | None = None,
    ) -> None:
        """Alias for set_override."""
        self._set_override_impl(policy=policy, workspace_id=workspace_id, site_id=site_id, tenant_id=tenant_id)

    def _clear_overrides_impl(self) -> None:
        """Clears all registered overrides, restoring defaults."""
        self._overrides.clear()

    def _reset_overrides_impl(self) -> None:
        """Alias for clear_overrides."""
        self._clear_overrides_impl()

    def _list_policies_impl(
        self,
        workspace_id: str | None = None,
        site_id: int | str | None = None,
        tenant_id: str | None = None,
    ) -> dict[EvidenceType, EvidenceTTLPolicy]:
        """Returns all effective policies for the given context."""
        effective_ws = tenant_id if tenant_id is not None else workspace_id
        result: dict[EvidenceType, EvidenceTTLPolicy] = {}
        for etype in EvidenceType:
            try:
                result[etype] = self._get_policy_impl(etype, effective_ws, site_id)
            except KeyError:
                continue
        return result

    # Non-recursive dispatchers allowing both class-level and instance-level calls
    get_policy = _PolicyRegistryDispatcher("get_policy")
    set_override = _PolicyRegistryDispatcher("set_override")
    register_override = _PolicyRegistryDispatcher("register_override")
    clear_overrides = _PolicyRegistryDispatcher("clear_overrides")
    reset_overrides = _PolicyRegistryDispatcher("reset_overrides")
    list_policies = _PolicyRegistryDispatcher("list_policies")

