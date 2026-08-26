"""
Topic & Semantic Analyzer (Task 5 - Step 5)

Performs deterministic, explainable topic and semantic analysis for extracted page content.
Calculates primary and supporting topics, keyword clusters, coverage depth,
and generates structured, explainable findings.
"""

from collections import Counter
from dataclasses import asdict, dataclass, field
import re
from typing import Any

# Standard English stop words to filter out noise deterministically
STOP_WORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
    "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
    "but", "by", "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
    "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had",
    "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
    "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd",
    "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself",
    "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off",
    "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own",
    "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some",
    "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then",
    "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this",
    "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we",
    "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's",
    "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't",
    "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself",
    "yourselves", "will", "just", "also", "like", "get", "use", "make", "one", "two", "new",
    "navigation", "menu", "search", "skip", "copyright", "rights", "reserved", "privacy", "terms", "page", "website", "site",
}



def tokenize(text: str | None) -> list[str]:
    """Tokenize text into lowercase alphanumeric words."""
    if not text:
        return []
    return re.findall(r"\b[a-zA-Z0-9]{3,}\b", text.lower())


def extract_ngrams(tokens: list[str], n: int = 2) -> list[str]:
    """Extract n-grams from filtered tokens."""
    if len(tokens) < n:
        return []
    return [" ".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]


@dataclass
class TopicFinding:
    type: str
    severity: str
    title: str
    description: str
    evidence: dict[str, Any]


@dataclass
class TopicAnalysisEvidence:
    primary_topic: str | None = None
    primary_topic_confidence: float = 0.0
    supporting_topics: list[str] = field(default_factory=list)
    topic_keywords: list[dict[str, Any]] = field(default_factory=list)
    total_words: int = 0
    unique_meaningful_words: int = 0
    lexical_diversity: float = 0.0
    semantic_depth: str = "shallow"
    primary_topic_in_title: bool = False
    primary_topic_in_h1: bool = False
    findings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class TopicSemanticAnalyzer:
    """
    Analyzes page content, titles, and headings to infer topics,
    keyword distribution, semantic relevance, and coverage depth.
    """

    def analyze(
        self,
        text_content: str | None = None,
        title: str | None = None,
        headings: list[Any] | None = None,
    ) -> TopicAnalysisEvidence:
        evidence = TopicAnalysisEvidence()

        # Gather all text components
        body_tokens = [t for t in tokenize(text_content) if t not in STOP_WORDS]
        title_tokens = [t for t in tokenize(title) if t not in STOP_WORDS]

        heading_texts: list[str] = []
        h1_texts: list[str] = []
        if headings:
            for h in headings:
                if isinstance(h, dict):
                    lvl = h.get("level", 1)
                    txt = h.get("text", "")
                else:
                    lvl = getattr(h, "level", 1)
                    txt = getattr(h, "text", "")
                if txt and str(txt).strip():
                    heading_texts.append(str(txt).strip())
                    if lvl == 1:
                        h1_texts.append(str(txt).strip())

        heading_tokens = [t for txt in heading_texts for t in tokenize(txt) if t not in STOP_WORDS]
        h1_tokens = [t for txt in h1_texts for t in tokenize(txt) if t not in STOP_WORDS]

        all_meaningful_tokens = title_tokens * 3 + h1_tokens * 3 + heading_tokens * 2 + body_tokens
        evidence.total_words = len(tokenize(text_content)) if text_content else 0

        if not all_meaningful_tokens:
            evidence.findings.append({
                "type": "content_empty",
                "severity": "high",
                "title": "No meaningful textual content detected",
                "description": "The page lacks sufficient text to identify a primary topic or evaluate semantic coverage.",
                "evidence": {"total_words": evidence.total_words},
            })
            return evidence

        evidence.unique_meaningful_words = len(set(body_tokens))
        if evidence.total_words > 0:
            evidence.lexical_diversity = round(len(set(body_tokens)) / evidence.total_words, 3)

        # Classify semantic depth based on volume and lexical richness
        if evidence.total_words < 50:
            evidence.semantic_depth = "thin"
        elif evidence.total_words < 200:
            evidence.semantic_depth = "moderate"
        else:
            evidence.semantic_depth = "deep"

        # Calculate word weights & frequencies
        unigram_counts = Counter(all_meaningful_tokens)

        # Bigram extraction for compound topics (e.g. "solar energy", "machine learning")
        all_text_for_ngrams = " ".join([title or ""] + heading_texts + [text_content or ""])
        raw_words = tokenize(all_text_for_ngrams)
        meaningful_sequence = [w for w in raw_words if w not in STOP_WORDS]
        bigrams = extract_ngrams(meaningful_sequence, n=2)
        bigram_counts = Counter(bigrams)

        # Select primary topic candidates
        # Prefer meaningful bigrams if they appear frequently, else top unigram
        primary_candidate = None
        candidate_confidence = 0.0

        top_bigrams = [b for b, c in bigram_counts.most_common(5) if c >= 2]
        if top_bigrams:
            primary_candidate = top_bigrams[0]
            in_title = bool(primary_candidate in (title or "").lower())
            in_h1 = bool(any(primary_candidate in h.lower() for h in h1_texts))
            boost = 0.2 if (in_title or in_h1) else 0.0
            candidate_confidence = min(0.95, round(0.70 + boost, 2))

        elif unigram_counts:
            most_common_word, freq = unigram_counts.most_common(1)[0]
            primary_candidate = most_common_word
            in_title = bool(most_common_word in (title or "").lower())
            in_h1 = bool(any(most_common_word in h.lower() for h in h1_texts))
            boost = 0.2 if (in_title or in_h1) else 0.0
            candidate_confidence = min(0.85, round(0.55 + boost, 2))


        evidence.primary_topic = primary_candidate
        evidence.primary_topic_confidence = candidate_confidence

        # Determine supporting topics
        supporting = []
        seen_words = set(primary_candidate.split() if primary_candidate else [])
        for term, count in unigram_counts.most_common(10):
            if term not in seen_words and count >= 2:
                supporting.append(term)
                seen_words.add(term)
                if len(supporting) >= 4:
                    break

        evidence.supporting_topics = supporting

        # Compile keyword clusters with prominence flags
        clusters = []
        body_counter = Counter(body_tokens)
        title_lower = (title or "").lower()
        h1_lower = " ".join(h1_texts).lower()
        all_headings_lower = " ".join(heading_texts).lower()

        for word, count in unigram_counts.most_common(8):
            in_t = word in title_lower
            in_h1 = word in h1_lower
            in_h = word in all_headings_lower
            density = round((body_counter[word] / evidence.total_words) * 100, 2) if evidence.total_words > 0 else 0.0

            clusters.append({
                "keyword": word,
                "occurrences": body_counter[word],
                "in_title": in_t,
                "in_h1": in_h1,
                "in_headings": in_h,
                "density_percentage": density,
            })
        evidence.topic_keywords = clusters

        # Primary topic alignment checks
        if primary_candidate:
            evidence.primary_topic_in_title = primary_candidate in title_lower
            evidence.primary_topic_in_h1 = any(primary_candidate in h.lower() for h in h1_texts)

        # Generate explainable findings
        if primary_candidate:
            if not evidence.primary_topic_in_title and not evidence.primary_topic_in_h1 and (title or h1_texts):
                evidence.findings.append({
                    "type": "topic_heading_misalignment",
                    "severity": "medium",
                    "title": "Primary topic missing from title and primary heading",
                    "description": f"The inferred primary topic '{primary_candidate}' is not featured in either the page <title> or primary <h1> heading.",
                    "evidence": {
                        "primary_topic": primary_candidate,
                        "title": title,
                        "h1_headings": h1_texts,
                    },
                })
            else:
                evidence.findings.append({
                    "type": "primary_topic_established",
                    "severity": "info",
                    "title": "Primary topic clearly established",
                    "description": f"Content clearly centers around '{primary_candidate}' with supporting keyword clusters.",
                    "evidence": {
                        "primary_topic": primary_candidate,
                        "confidence": candidate_confidence,
                        "supporting_topics": supporting,
                    },
                })

        # Keyword repetition check (density > 7% of total words is considered unnatural)
        for cluster in clusters:
            if cluster["density_percentage"] > 7.0 and cluster["occurrences"] >= 5:
                evidence.findings.append({
                    "type": "keyword_stuffing_risk",
                    "severity": "high",
                    "title": f"Unusually high repetition of '{cluster['keyword']}'",
                    "description": f"The term '{cluster['keyword']}' accounts for {cluster['density_percentage']}% of total words, risking search engine over-optimization penalties.",
                    "evidence": cluster,
                })

        # Thin depth finding
        if evidence.semantic_depth == "thin":
            evidence.findings.append({
                "type": "thin_semantic_depth",
                "severity": "low",
                "title": "Thin semantic content depth",
                "description": "The page has fewer than 50 words, providing limited topical context for AI and search indexation.",
                "evidence": {"total_words": evidence.total_words},
            })

        return evidence


def analyze_topic_semantics(
    text_content: str | None = None,
    title: str | None = None,
    headings: list[Any] | None = None,
) -> TopicAnalysisEvidence:
    """Convenience function to analyze topic semantics."""
    analyzer = TopicSemanticAnalyzer()
    return analyzer.analyze(text_content, title, headings)
