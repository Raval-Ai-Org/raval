"""
Root-Cause Analysis & Finding Grouping / Consolidation Engine (Day 10 - Step 2)

Consolidates multiple related findings into logical, deterministic root-cause groups
prior to fix planning.

Strict Architectural Invariants:
1. DETERMINISTIC & ORDER-INDEPENDENT:
   - Identical collections of findings produce identical root-cause identities,
     regardless of input order or database insertion sequence.
2. TENANT & SCAN BOUNDED:
   - Findings from different websites never merge.
   - Findings from different scans remain isolated by default.
3. CONSERVATIVE CONSOLIDATION:
   - Different rule IDs never merge unless an explicit structural parent relationship exists.
   - Does not assume template-level defects without evidence.
4. PROVENANCE & EVIDENCE PRESERVATION:
   - Preserves all original finding IDs, page references, and unaltered evidence payloads.
5. PURE & NON-MUTATING:
   - Input models and dictionaries are never mutated.
"""

from copy import deepcopy
from datetime import datetime, timezone
from enum import Enum
import hashlib
from typing import Any
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .models import Finding, PageResult, Scan, Website
from .authority_citation_recommendations import RULE_REGISTRY
from .content_intelligence_rules import CONTENT_AEO_RULES
from .priority_engine import RULE_REMEDIATION_MAP


class RootCauseScope(str, Enum):
    """Canonical scope classifications for root-cause groups."""
    PAGE = "page"
    PAGE_GROUP = "page_group"
    SITE = "site"
    TEMPLATE = "template"


# Severity rank for deterministic highest-severity resolution
SEVERITY_RANK: dict[str, int] = {
    "critical": 5,
    "urgent": 5,
    "high": 4,
    "major": 4,
    "medium": 3,
    "normal": 3,
    "low": 2,
    "minor": 2,
    "info": 1,
    "diagnostic": 1,
}

# Confidence rank for deterministic confidence resolution
CONFIDENCE_RANK: dict[str, int] = {
    "high": 3,
    "medium": 2,
    "low": 1,
}

# Explicit site-level rules that apply domain-wide regardless of page_id
SITE_LEVEL_RULES: set[str] = {
    "trust_missing_identity",
    "transparency_missing_first_party",
    "transparency_business_identity_consistent",
    "transparency_contact_conflict",
    "trust_contact_info_present",
    "trust_email_present",
    "site_robots_txt",
    "site_sitemap_present",
    "site_ssl_certificate",
}


class FindingEvidenceReference(BaseModel):
    """
    Preserved evidence and provenance reference for a single finding within a root cause.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    finding_id: int | str = Field(..., description="Original finding database ID or unique identifier")
    page_id: int | None = Field(default=None, description="Associated page result ID if page-specific")
    url: str | None = Field(default=None, description="Page URL if available")
    finding_type: str = Field(..., description="Underlying rule ID or finding type")
    severity: str = Field(default="medium", description="Finding severity level")
    evidence: Any | None = Field(default=None, description="Unaltered raw evidence payload from the finding")
    created_at: str | None = Field(default=None, description="Finding creation timestamp")


class RootCauseGroup(BaseModel):
    """
    Deterministic Root-Cause Group abstraction (Day 10 Step 2).
    Consolidates multiple findings sharing an identical root defect while preserving full provenance.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    root_cause_id: str = Field(..., description="Deterministic unique identifier for this root-cause group")
    root_cause_key: str = Field(..., description="Stable deterministic grouping key")
    website_id: int = Field(..., description="Scoped website tenant ID")
    scan_id: int | None = Field(default=None, description="Scoped scan execution ID")
    rule_id: str = Field(..., description="Canonical rule/finding identifier")
    finding_type: str = Field(..., description="Primary finding type")
    category: str = Field(..., description="Canonical category (e.g. structure, trust, citation, seo)")
    scope: RootCauseScope = Field(..., description="Scope classification (page, page_group, site, template)")
    title: str = Field(..., description="Consolidated root-cause summary title")
    description: str = Field(..., description="Consolidated explanation of the underlying problem")
    grouping_rationale: str = Field(..., description="Deterministic rationale for grouping these findings")
    severity: str = Field(default="medium", description="Highest severity among all consolidated findings")
    confidence: str = Field(default="high", description="Highest confidence level among contributing findings")
    findings_count: int = Field(default=0, description="Total number of findings consolidated")
    pages_count: int = Field(default=0, description="Total distinct pages affected")
    finding_ids: list[int | str] = Field(default_factory=list, description="Sorted list of consolidated finding IDs")
    affected_page_ids: list[int] = Field(default_factory=list, description="Sorted list of affected page IDs")
    affected_urls: list[str] = Field(default_factory=list, description="Sorted list of affected URLs")
    source_modules: list[str] = Field(default_factory=list, description="Sorted list of originating intelligence engines")
    evidence_references: list[FindingEvidenceReference] = Field(
        default_factory=list,
        description="Full, unaltered evidence references from every consolidated finding",
    )
    suggested_action_type: str | None = Field(
        default=None,
        description="Recommended action type mapped for downstream fix planning",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Traceability, template signatures, and consolidation metadata",
    )


class RootCauseAnalysisResult(BaseModel):
    """
    Envelope containing all root-cause groups produced from a scan or finding batch.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    website_id: int = Field(..., description="Scoped website tenant ID")
    scan_id: int | None = Field(default=None, description="Scoped scan ID")
    total_findings_analyzed: int = Field(default=0, description="Total raw findings provided as input")
    total_root_causes_identified: int = Field(default=0, description="Total consolidated root causes produced")
    consolidation_ratio: float = Field(default=1.0, description="Consolidation ratio (findings / root causes)")
    groups_by_scope: dict[str, int] = Field(default_factory=dict, description="Counts by scope tier")
    groups_by_category: dict[str, int] = Field(default_factory=dict, description="Counts by category")
    root_causes: list[RootCauseGroup] = Field(
        default_factory=list,
        description="Sorted list of deterministic root-cause groups",
    )
    metadata: dict[str, Any] = Field(default_factory=dict, description="Execution and audit metadata")


# =============================================================================
# Helper Utilities
# =============================================================================

def _normalize_rule_id(finding_type: str | None) -> str:
    """Canonicalizes rule IDs / finding types into lowercase stripped identifier."""
    if not finding_type:
        return "general_issue"
    return str(finding_type).strip().lower()


def _normalize_category(category: str | None, rule_id: str) -> str:
    """Normalizes category or infers from rule catalogs if missing/generic."""
    cat = str(category or "").strip().lower()
    if cat and cat not in ("seo", "general", "default"):
        return cat

    rule_lower = rule_id.lower()
    if rule_lower in RULE_REGISTRY:
        return RULE_REGISTRY[rule_lower].get("category", cat or "seo")
    for r in CONTENT_AEO_RULES:
        if r.get("rule_id", "").lower() == rule_lower:
            return r.get("category", cat or "seo")
    if rule_lower.startswith("trust_") or rule_lower.startswith("transparency_"):
        return "trust"
    if rule_lower.startswith("authority_"):
        return "authority"
    if rule_lower.startswith("source_") or rule_lower.startswith("claim_") or rule_lower.startswith("readiness_"):
        return "citation"
    if rule_lower.startswith("r-str-") or "heading" in rule_lower:
        return "structure"
    if rule_lower.startswith("r-top-") or "topic" in rule_lower:
        return "topic"
    if rule_lower.startswith("r-qna-") or "question" in rule_lower:
        return "questions"

    return cat or "seo"


def _extract_finding_data(item: Finding | dict[str, Any] | Any) -> dict[str, Any]:
    """Extracts raw finding attributes into a consistent dictionary without mutating."""
    if isinstance(item, dict):
        f_id = item.get("id") or item.get("finding_id") or "f-0"
        web_id = item.get("website_id", 1)
        scan_id = item.get("scan_id")
        page_id = item.get("page_id")
        f_type = item.get("finding_type") or item.get("type") or item.get("rule_id") or "general_issue"
        cat = item.get("category") or "seo"
        title = item.get("title") or f_type
        desc = item.get("description") or ""
        sev = str(item.get("severity") or "medium").lower()
        ev = item.get("evidence")
        created = item.get("created_at")
        url = item.get("url") or (ev.get("url") if isinstance(ev, dict) else None)
    elif hasattr(item, "__table__") or hasattr(item, "finding_type"):
        f_id = getattr(item, "id", None) or "f-0"
        web_id = getattr(item, "website_id", 1)
        scan_id = getattr(item, "scan_id", None)
        page_id = getattr(item, "page_id", None)
        f_type = getattr(item, "finding_type", "general_issue")
        cat = getattr(item, "category", "seo")
        title = getattr(item, "title", f_type)
        desc = getattr(item, "description", "")
        sev = str(getattr(item, "severity", "medium")).lower()
        ev = getattr(item, "evidence", None)
        created = getattr(item, "created_at", None)
        url = None
        if hasattr(item, "page_result") and item.page_result:
            url = getattr(item.page_result, "url", None)
        elif isinstance(ev, dict):
            url = ev.get("url")
    else:
        # Fallback for generic objects
        f_id = getattr(item, "id", "f-0")
        web_id = getattr(item, "website_id", 1)
        scan_id = getattr(item, "scan_id", None)
        page_id = getattr(item, "page_id", None)
        f_type = getattr(item, "finding_type", getattr(item, "rule_id", "general_issue"))
        cat = getattr(item, "category", "seo")
        title = getattr(item, "title", str(f_type))
        desc = getattr(item, "description", "")
        sev = str(getattr(item, "severity", "medium")).lower()
        ev = getattr(item, "evidence", None)
        created = getattr(item, "created_at", None)
        url = getattr(item, "url", None)

    created_str = created.isoformat() if isinstance(created, datetime) else (str(created) if created else None)

    return {
        "finding_id": f_id,
        "website_id": int(web_id) if web_id is not None else 1,
        "scan_id": int(scan_id) if scan_id is not None else None,
        "page_id": int(page_id) if page_id is not None else None,
        "finding_type": str(f_type),
        "rule_id": _normalize_rule_id(f_type),
        "category": _normalize_category(cat, _normalize_rule_id(f_type)),
        "title": str(title),
        "description": str(desc),
        "severity": sev,
        "evidence": deepcopy(ev) if ev is not None else None,
        "url": url,
        "created_at": created_str,
    }


def _infer_template_signature(evidence: Any) -> str | None:
    """
    Deterministically checks if evidence contains an explicit template/component signature.
    Does NOT guess or speculate.
    """
    if not isinstance(evidence, dict):
        return None

    # Check for explicit template flags
    if evidence.get("is_template") is True and evidence.get("template_signature"):
        return str(evidence.get("template_signature")).strip().lower()
    if evidence.get("template_id"):
        return str(evidence.get("template_id")).strip().lower()
    if evidence.get("layout_id"):
        return str(evidence.get("layout_id")).strip().lower()
    if evidence.get("component") in ("header", "footer", "site_navigation", "global_sidebar"):
        return f"component:{evidence['component']}"

    return None


def _resolve_highest_severity(severities: list[str]) -> str:
    """Returns the highest severity among candidates deterministically."""
    if not severities:
        return "medium"
    return max(severities, key=lambda s: SEVERITY_RANK.get(s.lower().strip(), 2))


def _resolve_highest_confidence(confidences: list[str]) -> str:
    """Returns the highest confidence level among candidates deterministically."""
    if not confidences:
        return "high"
    return max(confidences, key=lambda c: CONFIDENCE_RANK.get(c.lower().strip(), 2))


def _resolve_suggested_action_type(rule_id: str, category: str) -> str:
    """Maps rule ID to standard action type for downstream fix planning."""
    r_lower = rule_id.lower()
    if r_lower in RULE_REGISTRY:
        return RULE_REGISTRY[r_lower].get("action_type", "general_fix")
    if r_lower in RULE_REMEDIATION_MAP:
        return r_lower
    if "h1" in r_lower or "heading" in r_lower:
        return "heading_fix"
    if "meta" in r_lower or "title" in r_lower:
        return "meta_tag_fix"
    if "schema" in r_lower or "structured_data" in r_lower or "faq" in r_lower:
        return "schema_markup"
    if "gap" in r_lower or "content" in r_lower:
        return "content_expansion"
    if "link" in r_lower:
        return "internal_link_addition"
    if "entity" in r_lower:
        return "entity_linking"
    if "trust" in r_lower or "identity" in r_lower or "contact" in r_lower:
        return "add_trust_signals"
    if "citation" in r_lower or "source" in r_lower or "claim" in r_lower:
        return "anchor_citation_sources"
    return "general_fix"


# =============================================================================
# Root Cause Analysis Engine
# =============================================================================

class RootCauseAnalyzer:
    """
    Deterministic Root-Cause Analysis & Finding Grouping Engine (Day 10 - Step 2).
    """

    @classmethod
    def analyze_findings(
        cls,
        findings: list[Finding | dict[str, Any] | Any],
        website_id: int | None = None,
        scan_id: int | None = None,
    ) -> RootCauseAnalysisResult:
        """
        Consolidates a collection of findings into deterministic RootCauseGroup instances.

        Invariants:
        - Order independent: sorting findings initially guarantees deterministic grouping.
        - Tenant/Scan safe: groups are strictly partitioned by (website_id, scan_id).
        - Conservative: different rule IDs remain separate.
        - Provenance-preserving: all original finding IDs and evidence payloads are preserved.
        """
        if not findings:
            target_web = website_id or 1
            return RootCauseAnalysisResult(
                website_id=target_web,
                scan_id=scan_id,
                total_findings_analyzed=0,
                total_root_causes_identified=0,
                consolidation_ratio=1.0,
                groups_by_scope={},
                groups_by_category={},
                root_causes=[],
                metadata={"analyzed_at": datetime.now(timezone.utc).isoformat()},
            )

        # 1. Normalize and deterministically sort input findings
        extracted_items = [_extract_finding_data(f) for f in findings]
        
        # Override website_id or scan_id if explicitly specified
        for item in extracted_items:
            if website_id is not None:
                item["website_id"] = website_id
            if scan_id is not None and item["scan_id"] is None:
                item["scan_id"] = scan_id

        # Deterministic sort key for initial input
        extracted_items.sort(
            key=lambda x: (
                x["website_id"],
                x["scan_id"] or 0,
                x["category"],
                x["rule_id"],
                x["page_id"] or 0,
                str(x["finding_id"]),
            )
        )

        # 2. Partition findings into preliminary grouping buckets
        # Bucket Key: (website_id, scan_id, category, rule_id, template_signature, is_site_level)
        buckets: dict[tuple[int, int | None, str, str, str | None, bool], list[dict[str, Any]]] = {}

        for item in extracted_items:
            web_id = item["website_id"]
            sc_id = item["scan_id"]
            cat = item["category"]
            rule = item["rule_id"]
            page_id = item["page_id"]
            ev = item["evidence"]

            is_site_level = (page_id is None) or (rule in SITE_LEVEL_RULES)
            template_sig = _infer_template_signature(ev)

            bucket_key = (web_id, sc_id, cat, rule, template_sig, is_site_level)
            if bucket_key not in buckets:
                buckets[bucket_key] = []
            buckets[bucket_key].append(item)

        # 3. Form RootCauseGroup instances from buckets
        root_causes: list[RootCauseGroup] = []
        scope_counts: dict[str, int] = {}
        category_counts: dict[str, int] = {}

        for (web_id, sc_id, cat, rule, template_sig, is_site_level), bucket_items in buckets.items():
            findings_count = len(bucket_items)
            distinct_pages = sorted(list({b["page_id"] for b in bucket_items if b["page_id"] is not None}))
            distinct_urls = sorted(list({b["url"] for b in bucket_items if b["url"]}))
            finding_ids = sorted(list({b["finding_id"] for b in bucket_items}), key=lambda x: str(x))

            # Resolve Scope
            if is_site_level or not distinct_pages:
                scope = RootCauseScope.SITE
            elif template_sig is not None and len(distinct_pages) >= 2:
                scope = RootCauseScope.TEMPLATE
            elif len(distinct_pages) >= 2 or findings_count >= 2:
                scope = RootCauseScope.PAGE_GROUP
            else:
                scope = RootCauseScope.PAGE

            # Build stable deterministic root cause key
            # Format: w{website_id}:s{scan_id}:{category}:{rule_id}:{scope}[:template_sig]
            key_parts = [f"w{web_id}"]
            if sc_id is not None:
                key_parts.append(f"s{sc_id}")
            else:
                key_parts.append("s0")
            key_parts.append(cat)
            key_parts.append(rule)
            key_parts.append(scope.value)
            if template_sig:
                key_parts.append(template_sig)

            # If isolated to exactly one single page, bind page_id into the key to avoid collapsing distinct single pages
            if scope == RootCauseScope.PAGE and distinct_pages:
                key_parts.append(f"p{distinct_pages[0]}")

            root_cause_key = ":".join(key_parts)
            rc_hash = hashlib.sha256(root_cause_key.encode("utf-8")).hexdigest()[:16]
            root_cause_id = f"rc-{rc_hash}"

            # Aggregate severities and confidences
            severities = [b["severity"] for b in bucket_items]
            confidences = [
                b["evidence"].get("confidence", "high")
                for b in bucket_items
                if isinstance(b["evidence"], dict) and "confidence" in b["evidence"]
            ]
            group_severity = _resolve_highest_severity(severities)
            group_confidence = _resolve_highest_confidence(confidences)

            # Build evidence references preserving full provenance
            evidence_refs: list[FindingEvidenceReference] = []
            for b in bucket_items:
                evidence_refs.append(
                    FindingEvidenceReference(
                        finding_id=b["finding_id"],
                        page_id=b["page_id"],
                        url=b["url"],
                        finding_type=b["finding_type"],
                        severity=b["severity"],
                        evidence=b["evidence"],
                        created_at=b["created_at"],
                    )
                )

            # Resolve Titles & Descriptions
            sample_item = bucket_items[0]
            title_base = sample_item["title"] or rule
            desc_base = sample_item["description"] or f"Detected issue with rule '{rule}'."

            if scope == RootCauseScope.SITE:
                title = f"[Site-Wide] {title_base}"
                rationale = (
                    f"Consolidated site-level finding affecting global domain configuration across the website "
                    f"({findings_count} finding instances observed)."
                )
            elif scope == RootCauseScope.TEMPLATE:
                title = f"[Template: {template_sig}] {title_base}"
                rationale = (
                    f"Consolidated template-level issue detected across {len(distinct_pages)} pages sharing "
                    f"component/layout '{template_sig}'."
                )
            elif scope == RootCauseScope.PAGE_GROUP:
                title = f"[Multi-Page ({len(distinct_pages)} pages)] {title_base}"
                rationale = (
                    f"Consolidated {findings_count} occurrences of rule '{rule}' across "
                    f"{len(distinct_pages)} distinct pages."
                )
            else:
                title = title_base
                page_ref = f"page #{distinct_pages[0]}" if distinct_pages else "target page"
                rationale = f"Isolated page-level finding on {page_ref}."

            source_modules = sorted(list({
                b["evidence"].get("source", b["evidence"].get("source_module", cat))
                for b in bucket_items
                if isinstance(b["evidence"], dict) and ("source" in b["evidence"] or "source_module" in b["evidence"])
            }))
            if not source_modules:
                source_modules = [cat]

            suggested_action = _resolve_suggested_action_type(rule, cat)

            rc_group = RootCauseGroup(
                root_cause_id=root_cause_id,
                root_cause_key=root_cause_key,
                website_id=web_id,
                scan_id=sc_id,
                rule_id=rule,
                finding_type=sample_item["finding_type"],
                category=cat,
                scope=scope,
                title=title,
                description=desc_base,
                grouping_rationale=rationale,
                severity=group_severity,
                confidence=group_confidence,
                findings_count=findings_count,
                pages_count=len(distinct_pages),
                finding_ids=finding_ids,
                affected_page_ids=distinct_pages,
                affected_urls=distinct_urls,
                source_modules=source_modules,
                evidence_references=evidence_refs,
                suggested_action_type=suggested_action,
                metadata={
                    "template_signature": template_sig,
                    "is_site_level": is_site_level,
                },
            )
            root_causes.append(rc_group)

            scope_counts[scope.value] = scope_counts.get(scope.value, 0) + 1
            category_counts[cat] = category_counts.get(cat, 0) + 1

        # 4. Sort root causes deterministically
        # Priority sort: Severity rank desc, findings count desc, rule_id asc, root_cause_id asc
        root_causes.sort(
            key=lambda rc: (
                -SEVERITY_RANK.get(rc.severity.lower().strip(), 2),
                -rc.findings_count,
                rc.rule_id,
                rc.root_cause_id,
            )
        )

        total_findings = len(extracted_items)
        total_groups = len(root_causes)
        consolidation_ratio = round(total_findings / total_groups, 2) if total_groups > 0 else 1.0

        resolved_web_id = website_id or (extracted_items[0]["website_id"] if extracted_items else 1)
        resolved_scan_id = scan_id or (extracted_items[0]["scan_id"] if extracted_items else None)

        return RootCauseAnalysisResult(
            website_id=resolved_web_id,
            scan_id=resolved_scan_id,
            total_findings_analyzed=total_findings,
            total_root_causes_identified=total_groups,
            consolidation_ratio=consolidation_ratio,
            groups_by_scope=scope_counts,
            groups_by_category=category_counts,
            root_causes=root_causes,
            metadata={
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
                "engine_version": "10.2.0",
            },
        )


# =============================================================================
# Direct Service Integration Functions
# =============================================================================

def analyze_root_causes(
    findings: list[Finding | dict[str, Any] | Any],
    website_id: int | None = None,
    scan_id: int | None = None,
) -> RootCauseAnalysisResult:
    """Convenience helper to analyze findings into root cause groups."""
    return RootCauseAnalyzer.analyze_findings(findings, website_id=website_id, scan_id=scan_id)


def group_findings_by_root_cause(
    findings: list[Finding | dict[str, Any] | Any],
    website_id: int | None = None,
    scan_id: int | None = None,
) -> list[RootCauseGroup]:
    """Convenience helper returning directly the list of RootCauseGroup items."""
    return analyze_root_causes(findings, website_id=website_id, scan_id=scan_id).root_causes


def get_root_causes_for_scan(
    db: Session,
    scan_id: int,
) -> RootCauseAnalysisResult:
    """
    Fetches all findings for a given scan and performs deterministic root-cause grouping.
    """
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError(f"Scan with id {scan_id} not found")

    findings = db.query(Finding).filter(Finding.scan_id == scan_id).order_by(Finding.id.asc()).all()
    return analyze_root_causes(findings, website_id=scan.website_id, scan_id=scan_id)


def get_root_causes_for_website(
    db: Session,
    website_id: int,
) -> RootCauseAnalysisResult:
    """
    Fetches all findings across all scans for a given website and performs root-cause grouping.
    """
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError(f"Website with id {website_id} not found")

    findings = db.query(Finding).filter(Finding.website_id == website_id).order_by(Finding.id.asc()).all()
    return analyze_root_causes(findings, website_id=website_id, scan_id=None)
