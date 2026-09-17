"""
Content Quality & Evidence Analyzer (Task 5 - Step 11)

Evaluates factual evidence signals, data points, source attributions,
unsupported superlative claims, and section depth.
Adheres strictly to the principle: Evidence != conclusion.
"""

from dataclasses import asdict, dataclass, field
import re
from typing import Any


SUPERLATIVE_PATTERNS = [
    re.compile(r"\b(best\s+in\s+the\s+world|industry[- ]leading|world['’]s\s+(?:best|leading|#1)|unrivaled|unmatched|revolutionary|guaranteed\s+#1|100%\s+guaranteed|perfection)\b", re.I),
    re.compile(r"\b(the\s+best|the\s+greatest|the\s+fastest|the\s+safest|the\s+most\s+reliable)\b", re.I),
]

DATA_POINT_REGEX = re.compile(
    r"(\b\d+(?:\.\d+)?\s*(?:%|percent\b|kg\b|kw\b|kwh\b|mw\b|ghz\b|gb\b|mb\b|tb\b|miles\b|meters\b|km\b|hours\b|mins\b|minutes\b|seconds\b|days\b|years\b|volts\b|amps\b|hz\b)|\$\d+(?:,\d{3})*(?:\.\d+)?|\b\d{4}\b)",
    re.I,
)


ATTRIBUTION_PHRASES = (
    "according to", "study by", "study published", "research shows",
    "research conducted", "reported by", "source:", "sources:",
    "data from", "verified by", "certified by", "statistics from",
)


@dataclass
class UnsupportedClaimItem:
    claim_text: str
    superlative_term: str
    location: str
    reason: str


@dataclass
class QualityAnalysisEvidence:
    has_quantitative_evidence: bool = False
    data_points_count: int = 0
    citations_count: int = 0
    attributions_count: int = 0
    unsupported_claims_count: int = 0
    thin_sections_count: int = 0
    evidence_strength: str = "weak"  # "strong", "moderate", "weak"
    quality_score: float = 0.0
    data_points: list[str] = field(default_factory=list)
    attributions: list[str] = field(default_factory=list)
    unsupported_claims: list[dict[str, Any]] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class QualityAnalyzer:
    """
    Analyzes page content to measure verifiable evidence presence, data points,
    attribution, and identifies unsupported superlative claims.
    """

    def analyze(
        self,
        text_content: str | None = None,
        headings: list[Any] | None = None,
        sections: list[Any] | None = None,
        links: list[Any] | None = None,
    ) -> QualityAnalysisEvidence:
        evidence = QualityAnalysisEvidence()

        if not text_content or not text_content.strip():
            evidence.findings.append({
                "type": "no_content_for_quality_evaluation",
                "severity": "high",
                "title": "No textual content available to evaluate quality evidence",
                "description": "Page has no extractable text content to assess evidence or claim support.",
                "evidence": {"text_length": 0},
            })
            return evidence

        clean_text = text_content.strip()
        sentences = re.split(r"(?<=[.?!])\s+", clean_text)

        # 1. Detect Quantitative Data Points
        matches = DATA_POINT_REGEX.findall(clean_text)
        valid_data_points: list[str] = []
        for m in matches:
            # Filter out copyright boilerplate years (e.g. Copyright © 2024)
            if re.fullmatch(r"\d{4}", m.strip()):
                if re.search(r"(?:copyright|©|\(c\)|rights reserved)[\s\w,.-]*" + re.escape(m), clean_text, re.I):
                    continue
            valid_data_points.append(m)

        evidence.data_points = list(dict.fromkeys(valid_data_points))[:20]  # Deduplicate & cap
        evidence.data_points_count = len(evidence.data_points)
        evidence.has_quantitative_evidence = evidence.data_points_count > 0

        # 2. Detect Attribution Phrases & Citations
        found_attrs: list[str] = []
        for phrase in ATTRIBUTION_PHRASES:
            if phrase in clean_text.lower():
                found_attrs.append(phrase)
        evidence.attributions = found_attrs
        evidence.attributions_count = len(found_attrs)

        # External citations from links
        cit_count = 0
        if links:
            for l in links:
                href = l.get("destination_url", "") if isinstance(l, dict) else getattr(l, "destination_url", "")
                if href and any(dom in href.lower() for dom in (".gov", ".edu", ".org", "wikipedia.org", "doi.org")):
                    cit_count += 1
        evidence.citations_count = cit_count

        # 3. Detect Unsupported Superlative Claims
        unsupported: list[UnsupportedClaimItem] = []
        for idx, sent in enumerate(sentences):
            sent_clean = sent.strip()
            if not sent_clean:
                continue

            # Ignore browser/UI/cookie instructional notices
            if any(ui_term in sent_clean.lower() for ui_term in ("enable javascript", "cookie policy", "browser", "screen reader", "viewing experience")):
                continue

            for pat in SUPERLATIVE_PATTERNS:
                m = pat.search(sent_clean)
                if m:
                    superlative = m.group(1)
                    # Check if this sentence or adjacent sentences contain any numbers or citations
                    has_data = bool(DATA_POINT_REGEX.search(sent_clean))
                    has_attr = any(phrase in sent_clean.lower() for phrase in ATTRIBUTION_PHRASES)

                    if not has_data and not has_attr:
                        unsupported.append(UnsupportedClaimItem(
                            claim_text=sent_clean[:180],
                            superlative_term=superlative,
                            location=f"Sentence {idx + 1}",
                            reason=f"Uses superlative assertion '{superlative}' without accompanying data points, benchmark metrics, or source attribution.",
                        ))
                    break  # avoid multiple triggers on the same sentence


        evidence.unsupported_claims = [asdict(u) for u in unsupported]
        evidence.unsupported_claims_count = len(unsupported)

        # 4. Thin Sections Count
        if sections:
            thin_count = sum(
                1 for s in sections
                if (s.get("is_thin") or s.get("is_empty"))
                if isinstance(s, dict)
            )
            evidence.thin_sections_count = thin_count

        # 5. Calculate Deterministic Quality Score
        base_score = 0.50
        if evidence.data_points_count >= 3:
            base_score += 0.20
        elif evidence.data_points_count >= 1:
            base_score += 0.10

        if evidence.attributions_count >= 1 or evidence.citations_count >= 1:
            base_score += 0.15

        if evidence.unsupported_claims_count == 0:
            base_score += 0.15
        else:
            base_score -= min(0.30, evidence.unsupported_claims_count * 0.10)

        if evidence.thin_sections_count > 0:
            base_score -= min(0.20, evidence.thin_sections_count * 0.05)

        clamped_score = round(max(0.0, min(1.0, base_score)), 2)
        evidence.quality_score = clamped_score

        if clamped_score >= 0.75:
            evidence.evidence_strength = "strong"
        elif clamped_score >= 0.45:
            evidence.evidence_strength = "moderate"
        else:
            evidence.evidence_strength = "weak"

        # Generate Explainable Findings
        if evidence.unsupported_claims_count > 0:
            evidence.findings.append({
                "type": "unsupported_superlative_claims",
                "severity": "medium",
                "title": f"Detected {evidence.unsupported_claims_count} unsupported superlative claim(s)",
                "description": "Content makes strong subjective assertions (e.g. 'industry leading', 'the best') without providing verifiable quantitative metrics or citations.",
                "evidence": {"claims": evidence.unsupported_claims},
            })

        if evidence.has_quantitative_evidence and evidence.data_points_count >= 3:
            evidence.findings.append({
                "type": "strong_empirical_evidence",
                "severity": "info",
                "title": "Strong empirical evidence support detected",
                "description": f"Content includes {evidence.data_points_count} specific data points, metrics, or measurements reinforcing claims.",
                "evidence": {"data_points": evidence.data_points[:5]},
            })
        elif not evidence.has_quantitative_evidence:
            evidence.findings.append({
                "type": "lacks_quantitative_data",
                "severity": "low",
                "title": "Content lacks quantitative evidence or metrics",
                "description": "No concrete numbers, percentages, or measurements were detected to validate claims.",
                "evidence": {"data_points_count": 0},
            })

        if evidence.citations_count >= 1 or evidence.attributions_count >= 1:
            evidence.findings.append({
                "type": "external_attribution_verified",
                "severity": "info",
                "title": "Authoritative attributions or citations detected",
                "description": f"Identified {evidence.attributions_count} source attribution(s) and {evidence.citations_count} authoritative reference link(s).",
                "evidence": {
                    "attributions": evidence.attributions,
                    "citations_count": evidence.citations_count,
                },
            })

        return evidence


def analyze_quality(
    text_content: str | None = None,
    headings: list[Any] | None = None,
    sections: list[Any] | None = None,
    links: list[Any] | None = None,
) -> QualityAnalysisEvidence:
    """Convenience function to analyze content quality."""
    analyzer = QualityAnalyzer()
    return analyzer.analyze(
        text_content=text_content,
        headings=headings,
        sections=sections,
        links=links,
    )
