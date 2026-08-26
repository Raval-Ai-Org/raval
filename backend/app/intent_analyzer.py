"""
Search & User Intent Analyzer (Task 5 - Step 12)

Categorizes page content into primary and secondary search intents:
Informational, Navigational, Transactional, Commercial Investigation, and QA Intent.
Provides explainable confidence, supporting evidence, and detects conflicting signals.
"""

from collections import Counter
from dataclasses import asdict, dataclass, field
import re
from typing import Any


INTENT_KEYWORDS = {
    "informational": {
        "guide", "how to", "what is", "tutorial", "overview", "definition",
        "learn", "explained", "basics", "understanding", "principles", "steps",
        "methods", "history", "guide to", "tips", "resources", "documentation",
    },
    "navigational": {
        "login", "sign in", "portal", "contact us", "about us", "homepage",
        "dashboard", "my account", "privacy policy", "terms of service",
        "headquarters", "locations", "careers", "press release",
    },
    "transactional": {
        "buy", "order", "purchase", "pricing", "price", "checkout", "subscribe",
        "cart", "free trial", "register now", "get started", "shop", "discount",
        "coupon", "add to cart", "book now", "schedule demo", "request quote",
    },
    "commercial_investigation": {
        "best", "review", "reviews", "top 10", "vs", "versus", "comparison",
        "compare", "pros and cons", "alternatives", "recommended", "rated",
        "buyer's guide", "worth it", "which is better",
    },
}


@dataclass
class IntentScore:
    intent: str
    score: float
    matched_markers: list[str]


@dataclass
class IntentAnalysisEvidence:
    primary_intent: str = "informational"
    confidence: float = 0.0
    secondary_intents: list[dict[str, Any]] = field(default_factory=list)
    supporting_evidence: list[str] = field(default_factory=list)
    conflicting_signals: list[str] = field(default_factory=list)
    has_commercial_call_to_action: bool = False
    findings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class IntentAnalyzer:
    """
    Evaluates page text, titles, headings, and question density to infer
    the most likely search intent with explainable confidence and conflict detection.
    """

    def analyze(
        self,
        text_content: str | None = None,
        title: str | None = None,
        headings: list[Any] | None = None,
        question_count: int = 0,
        faq_schema_present: bool = False,
    ) -> IntentAnalysisEvidence:
        evidence = IntentAnalysisEvidence()

        if not text_content and not title and not headings:
            evidence.primary_intent = "informational"
            evidence.confidence = 0.0
            evidence.conflicting_signals.append("No text content or headings available to evaluate intent.")
            return evidence

        # Gather text corpus
        title_clean = (title or "").lower()

        heading_texts: list[str] = []
        h1_texts: list[str] = []
        if headings:
            for h in headings:
                txt = h.get("text", "") if isinstance(h, dict) else getattr(h, "text", "")
                lvl = h.get("level", 1) if isinstance(h, dict) else getattr(h, "level", 1)
                if txt:
                    c = str(txt).strip().lower()
                    heading_texts.append(c)
                    if lvl == 1:
                        h1_texts.append(c)

        all_headings = " ".join(heading_texts)
        body_clean = (text_content or "").lower()

        scores: dict[str, float] = {
            "informational": 0.0,
            "navigational": 0.0,
            "transactional": 0.0,
            "commercial_investigation": 0.0,
            "qa_intent": 0.0,
        }
        matched: dict[str, list[str]] = {k: [] for k in scores}

        # 1. Match Keyword Signals with Hierarchical Weighting
        for intent_cat, kw_set in INTENT_KEYWORDS.items():
            for kw in kw_set:
                # Title matches: 3.0 weight
                if kw in title_clean:
                    scores[intent_cat] += 3.0
                    matched[intent_cat].append(f"title: '{kw}'")

                # H1 matches: 3.0 weight
                if any(kw in h1 for h1 in h1_texts):
                    scores[intent_cat] += 3.0
                    matched[intent_cat].append(f"h1: '{kw}'")

                # Heading matches: 2.0 weight
                elif kw in all_headings:
                    scores[intent_cat] += 2.0
                    matched[intent_cat].append(f"heading: '{kw}'")

                # Body text matches: 1.0 weight
                elif kw in body_clean:
                    scores[intent_cat] += 1.0
                    matched[intent_cat].append(f"body: '{kw}'")

        # 2. QA Intent Scoring from Question Density & Schema
        if faq_schema_present:
            scores["qa_intent"] += 5.0
            matched["qa_intent"].append("FAQPage Schema markup present")

        if question_count >= 4:
            scores["qa_intent"] += 4.0
            matched["qa_intent"].append(f"High question count ({question_count} questions)")
        elif question_count >= 2:
            scores["qa_intent"] += 2.0
            matched["qa_intent"].append(f"Question headings present ({question_count} questions)")

        # Commercial CTA presence check
        cta_terms = ["add to cart", "buy now", "free trial", "order now", "subscribe now", "schedule demo"]
        has_cta = any(term in body_clean or term in all_headings for term in cta_terms)
        evidence.has_commercial_call_to_action = has_cta
        if has_cta:
            scores["transactional"] += 2.5
            matched["transactional"].append("Strong transactional call-to-action detected")

        # Fallback baseline for informational content
        if sum(scores.values()) == 0:
            scores["informational"] = 2.0
            matched["informational"].append("Standard explanatory narrative without commercial or navigational markers")

        # Normalize Scores to determine confidence
        total_weight = sum(scores.values())
        sorted_intents = sorted(scores.items(), key=lambda x: x[1], reverse=True)

        top_intent, top_score = sorted_intents[0]
        evidence.primary_intent = top_intent

        confidence = round(top_score / total_weight, 2) if total_weight > 0 else 0.50
        evidence.confidence = min(0.95, max(0.30, confidence))

        # Secondary Intents
        secondaries = []
        for cat, sc in sorted_intents[1:]:
            if sc > 0:
                sec_conf = round(sc / total_weight, 2) if total_weight > 0 else 0.0
                secondaries.append({
                    "intent": cat,
                    "score": round(sc, 1),
                    "relative_strength": sec_conf,
                    "matched_markers": matched[cat][:5],
                })
        evidence.secondary_intents = secondaries[:3]

        # Explainable Supporting Evidence
        top_markers = matched[top_intent][:5]
        for m in top_markers:
            evidence.supporting_evidence.append(f"Detected {m} supporting {top_intent} intent.")

        # Detect Conflicting Signals
        # Example 1: Title claims informational guide, but heavy transactional CTAs dominate
        if "informational" in title_clean and scores["transactional"] >= scores["informational"] and scores["transactional"] > 3.0:
            evidence.conflicting_signals.append(
                "Title frames content as an informational guide, but page features prominent commercial checkout/transactional elements."
            )
            evidence.findings.append({
                "type": "intent_mismatch_informational_vs_transactional",
                "severity": "low",
                "title": "Possible intent mismatch: Informational title with transactional focus",
                "description": "The title suggests educational/informational content, but transaction CTAs indicate commercial conversion intent.",
                "evidence": {"title": title, "top_intents": [i[0] for i in sorted_intents[:2]]},
            })

        # Example 2: Question rich content without QA intent dominance
        if question_count >= 4 and top_intent not in ("qa_intent", "informational"):
            evidence.conflicting_signals.append(
                f"Page has {question_count} questions but is classified primarily as {top_intent}."
            )

        # Primary Intent Finding
        evidence.findings.append({
            "type": "primary_intent_identified",
            "severity": "info",
            "title": f"Primary search intent identified as '{evidence.primary_intent}'",
            "description": f"Classified as '{evidence.primary_intent}' with {int(evidence.confidence * 100)}% relative confidence based on {len(top_markers)} indicator(s).",
            "evidence": {
                "intent": evidence.primary_intent,
                "confidence": evidence.confidence,
                "indicators": top_markers,
            },
        })

        return evidence


def analyze_intent(
    text_content: str | None = None,
    title: str | None = None,
    headings: list[Any] | None = None,
    question_count: int = 0,
    faq_schema_present: bool = False,
) -> IntentAnalysisEvidence:
    """Convenience function to analyze intent."""
    analyzer = IntentAnalyzer()
    return analyzer.analyze(
        text_content=text_content,
        title=title,
        headings=headings,
        question_count=question_count,
        faq_schema_present=faq_schema_present,
    )
