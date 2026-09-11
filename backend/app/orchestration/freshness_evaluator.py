"""
Production Orchestration & Monitoring - Freshness Evaluator.

Provides deterministic, evidence-backed freshness evaluation across all evidence
types. Adheres strictly to the core product principle:
STALE DATA MUST NEVER BE SILENTLY TREATED AS ZERO OR CURRENT.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import logging
from typing import Any

from .enums import EvidenceType, FreshnessState, RefreshDecisionType
from .exceptions import InvalidEvidenceTimestampError, UnsupportedEvidenceTypeError
from .freshness_policy import EvidenceTTLPolicy, FreshnessPolicyRegistry

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_utc(dt: datetime | str) -> datetime:
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt)
        except Exception:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@dataclass(frozen=True)
class FreshnessEvaluation:
    """
    Structured, serializable result of a freshness evaluation for an evidence observation.
    """

    evidence_type: EvidenceType
    freshness_state: FreshnessState
    observed_at: datetime | None
    evaluated_at: datetime
    age_seconds: float | None
    ttl_seconds: int
    remaining_seconds: float | None
    stale_reason: str | None
    refresh_recommendation: RefreshDecisionType
    is_stale: bool
    is_expired: bool
    is_unavailable: bool
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def state(self) -> FreshnessState:
        return self.freshness_state

    @property
    def warning_threshold_seconds(self) -> int:
        return int(self.details.get("warning_threshold_seconds", 0))

    @property
    def expiration_threshold_seconds(self) -> int:
        return int(self.details.get("expiration_threshold_seconds", self.ttl_seconds * 2))

    @property
    def refresh_recommended(self) -> bool:
        return self.refresh_recommendation in (
            RefreshDecisionType.REFRESH_RECOMMENDED,
            RefreshDecisionType.REFRESH_REQUIRED,
        )

    @property
    def refresh_required(self) -> bool:
        return self.refresh_recommendation == RefreshDecisionType.REFRESH_REQUIRED

    @property
    def metadata(self) -> dict[str, Any]:
        return self.details

    def to_dict(self) -> dict[str, Any]:
        return {
            "evidence_type": self.evidence_type.value,
            "freshness_state": self.freshness_state.value,
            "observed_at": self.observed_at.isoformat() if self.observed_at else None,
            "evaluated_at": self.evaluated_at.isoformat(),
            "age_seconds": round(self.age_seconds, 2) if self.age_seconds is not None else None,
            "ttl_seconds": self.ttl_seconds,
            "remaining_seconds": round(self.remaining_seconds, 2) if self.remaining_seconds is not None else None,
            "stale_reason": self.stale_reason,
            "refresh_recommendation": self.refresh_recommendation.value,
            "is_stale": self.is_stale,
            "is_expired": self.is_expired,
            "is_unavailable": self.is_unavailable,
            "details": self.details,
        }


class _EvaluatorDispatcher:
    def __get__(self, obj: Any, objtype: Any = None) -> Any:
        if obj is not None:
            return obj._evaluate_impl
        return objtype.default()._evaluate_impl


class FreshnessEvaluator:
    """
    Deterministic freshness evaluator matching observation timestamps against
    category TTL policies with explicit boundary and edge-case handling.
    """

    _default_instance: FreshnessEvaluator | None = None

    @classmethod
    def default(cls) -> FreshnessEvaluator:
        if cls._default_instance is None:
            cls._default_instance = FreshnessEvaluator()
        return cls._default_instance

    def __init__(self, policy_registry: FreshnessPolicyRegistry | None = None) -> None:
        self.policy_registry = policy_registry or FreshnessPolicyRegistry.default()

    def _evaluate_impl(
        self,
        evidence_type: EvidenceType | str,
        observed_at: datetime | str | None,
        current_time: datetime | None = None,
        policy: EvidenceTTLPolicy | None = None,
        provider_available: bool = True,
        is_refreshing: bool = False,
        workspace_id: str | None = None,
        site_id: int | str | None = None,
        context: dict[str, Any] | None = None,
        as_of: datetime | None = None,
        is_provider_available: bool | None = None,
        is_currently_refreshing: bool | None = None,
    ) -> FreshnessEvaluation:
        """
        Evaluates the freshness state of an evidence observation.
        """
        effective_now = as_of or current_time
        now = _ensure_utc(effective_now) if effective_now else _utc_now()
        eff_provider_available = (
            is_provider_available if is_provider_available is not None else provider_available
        )
        eff_is_refreshing = (
            is_currently_refreshing if is_currently_refreshing is not None else is_refreshing
        )

        # 1. Resolve EvidenceType
        try:
            etype = EvidenceType(evidence_type) if isinstance(evidence_type, str) else evidence_type
        except ValueError:
            raise UnsupportedEvidenceTypeError(str(evidence_type))

        # 2. Resolve Policy
        eff_policy = policy or self.policy_registry.get_policy(etype, workspace_id, site_id)
        details = dict(context or {})
        details["warning_threshold_seconds"] = eff_policy.warning_threshold_seconds
        details["expiration_threshold_seconds"] = eff_policy.expiration_threshold_seconds

        # 3. Provider outage / source unavailability check
        if not eff_provider_available:
            return FreshnessEvaluation(
                evidence_type=etype,
                freshness_state=FreshnessState.UNAVAILABLE,
                observed_at=_ensure_utc(observed_at) if isinstance(observed_at, datetime) else None,
                evaluated_at=now,
                age_seconds=None,
                ttl_seconds=eff_policy.ttl_seconds,
                remaining_seconds=None,
                stale_reason="Provider or upstream source is unavailable",
                refresh_recommendation=RefreshDecisionType.REFRESH_UNAVAILABLE,
                is_stale=False,
                is_expired=False,
                is_unavailable=True,
                details=details,
            )

        # 4. Missing / Never Observed Check
        if observed_at is None:
            details["never_observed"] = True
            return FreshnessEvaluation(
                evidence_type=etype,
                freshness_state=FreshnessState.UNKNOWN,
                observed_at=None,
                evaluated_at=now,
                age_seconds=None,
                ttl_seconds=eff_policy.ttl_seconds,
                remaining_seconds=None,
                stale_reason="Never observed / missing observation timestamp",
                refresh_recommendation=(
                    RefreshDecisionType.REFRESH_REQUIRED
                    if eff_policy.refresh_eligibility
                    else RefreshDecisionType.NO_ACTION
                ),
                is_stale=False,
                is_expired=False,
                is_unavailable=False,
                details=details,
            )

        # 5. Parse & Validate Timestamp
        if isinstance(observed_at, str):
            try:
                parsed_dt = datetime.fromisoformat(observed_at)
            except Exception as exc:
                raise InvalidEvidenceTimestampError(
                    evidence_type=etype.value,
                    observed_at=observed_at,
                    reason=f"Failed to parse ISO-8601 timestamp: {exc}",
                )
        elif isinstance(observed_at, datetime):
            parsed_dt = observed_at
        else:
            raise InvalidEvidenceTimestampError(
                evidence_type=etype.value,
                observed_at=str(observed_at),
                reason="Timestamp must be a datetime or ISO-8601 string",
            )

        obs_utc = _ensure_utc(parsed_dt)

        # Boundary check: Future timestamp (> 1.0s clock skew allowance)
        time_diff = (obs_utc - now).total_seconds()
        if time_diff > 1.0:
            raise InvalidEvidenceTimestampError(
                evidence_type=etype.value,
                observed_at=obs_utc.isoformat(),
                reason=f"Timestamp is in the future by {round(time_diff, 2)}s",
            )

        age_seconds = max(0.0, (now - obs_utc).total_seconds())
        remaining_seconds = max(0.0, eff_policy.ttl_seconds - age_seconds)

        # 6. Active Refresh Override
        if eff_is_refreshing:
            return FreshnessEvaluation(
                evidence_type=etype,
                freshness_state=FreshnessState.REFRESHING,
                observed_at=obs_utc,
                evaluated_at=now,
                age_seconds=age_seconds,
                ttl_seconds=eff_policy.ttl_seconds,
                remaining_seconds=remaining_seconds,
                stale_reason="Refresh run actively in-progress",
                refresh_recommendation=RefreshDecisionType.REFRESH_ALREADY_RUNNING,
                is_stale=(age_seconds >= eff_policy.ttl_seconds),
                is_expired=(age_seconds >= eff_policy.expiration_threshold_seconds),
                is_unavailable=False,
                details=details,
            )

        # 7. Exact Threshold Boundary Evaluation
        # FRESH: age <= warning_threshold
        if age_seconds <= eff_policy.warning_threshold_seconds:
            return FreshnessEvaluation(
                evidence_type=etype,
                freshness_state=FreshnessState.FRESH,
                observed_at=obs_utc,
                evaluated_at=now,
                age_seconds=age_seconds,
                ttl_seconds=eff_policy.ttl_seconds,
                remaining_seconds=remaining_seconds,
                stale_reason=None,
                refresh_recommendation=RefreshDecisionType.NO_ACTION,
                is_stale=False,
                is_expired=False,
                is_unavailable=False,
                details=details,
            )

        # AGING: warning_threshold < age <= ttl
        if age_seconds <= eff_policy.ttl_seconds:
            return FreshnessEvaluation(
                evidence_type=etype,
                freshness_state=FreshnessState.AGING,
                observed_at=obs_utc,
                evaluated_at=now,
                age_seconds=age_seconds,
                ttl_seconds=eff_policy.ttl_seconds,
                remaining_seconds=remaining_seconds,
                stale_reason=(
                    f"Evidence is aging: age ({int(age_seconds)}s) exceeded warning threshold "
                    f"({eff_policy.warning_threshold_seconds}s)"
                ),
                refresh_recommendation=RefreshDecisionType.NO_ACTION,
                is_stale=False,
                is_expired=False,
                is_unavailable=False,
                details=details,
            )

        # STALE: ttl < age <= expiration_threshold
        if age_seconds <= eff_policy.expiration_threshold_seconds:
            return FreshnessEvaluation(
                evidence_type=etype,
                freshness_state=FreshnessState.STALE,
                observed_at=obs_utc,
                evaluated_at=now,
                age_seconds=age_seconds,
                ttl_seconds=eff_policy.ttl_seconds,
                remaining_seconds=0.0,
                stale_reason=(
                    f"Evidence is stale: age ({int(age_seconds)}s) exceeded TTL ({eff_policy.ttl_seconds}s)"
                ),
                refresh_recommendation=(
                    RefreshDecisionType.REFRESH_RECOMMENDED
                    if eff_policy.refresh_eligibility
                    else RefreshDecisionType.REFRESH_BLOCKED
                ),
                is_stale=True,
                is_expired=False,
                is_unavailable=False,
                details=details,
            )

        # EXPIRED: age > expiration_threshold
        return FreshnessEvaluation(
            evidence_type=etype,
            freshness_state=FreshnessState.EXPIRED,
            observed_at=obs_utc,
            evaluated_at=now,
            age_seconds=age_seconds,
            ttl_seconds=eff_policy.ttl_seconds,
            remaining_seconds=0.0,
            stale_reason=(
                f"Evidence has expired: age ({int(age_seconds)}s) exceeded expiration threshold "
                f"({eff_policy.expiration_threshold_seconds}s)"
            ),
            refresh_recommendation=(
                RefreshDecisionType.REFRESH_REQUIRED
                if eff_policy.refresh_eligibility
                else RefreshDecisionType.REFRESH_BLOCKED
            ),
            is_stale=True,
            is_expired=True,
            is_unavailable=False,
            details=details,
        )


# Allow calling FreshnessEvaluator.evaluate(...) on either class or instance:
FreshnessEvaluator.evaluate = _EvaluatorDispatcher()  # type: ignore[assignment]
