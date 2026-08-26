"""
Content Structure Analyzer (Task 5 - Step 4)

Analyzes page structural hierarchy and layout signals from HTML and Task 4 page extraction evidence.
Adheres to the principle: Evidence != conclusion.
Produces structured, contextual signals rather than arbitrary subjective rules.
"""

from dataclasses import asdict, dataclass, field
import html
from html.parser import HTMLParser
import re
from typing import Any


def normalize_text(text: str | None) -> str:
    """Normalize text by stripping whitespace and lowercasing."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip().lower()


def extract_tokens(text: str | None) -> set[str]:
    """Extract alphanumeric word tokens >= 2 chars, lowercased."""
    if not text:
        return set()
    return set(re.findall(r"\b[a-zA-Z0-9]{2,}\b", text.lower()))


def evaluate_title_h1_alignment(
    title: str | None,
    h1_text: str | None,
) -> dict[str, Any] | None:
    """
    Evaluate alignment between page title and primary H1 heading.
    Returns structured comparison signals.
    """
    if title is None and h1_text is None:
        return None

    if not title or not title.strip():
        return {
            "title_text": None,
            "h1_text": h1_text,
            "exact_match": False,
            "h1_in_title": False,
            "title_in_h1": False,
            "token_overlap_ratio": 0.0,
            "aligned": False,
            "reason": "Missing or empty title",
        }

    if not h1_text or not h1_text.strip():
        return {
            "title_text": title,
            "h1_text": None,
            "exact_match": False,
            "h1_in_title": False,
            "title_in_h1": False,
            "token_overlap_ratio": 0.0,
            "aligned": False,
            "reason": "Missing or empty H1 heading",
        }

    norm_title = normalize_text(title)
    norm_h1 = normalize_text(h1_text)

    exact_match = norm_title == norm_h1
    h1_in_title = norm_h1 in norm_title
    title_in_h1 = norm_title in norm_h1

    tokens_title = extract_tokens(title)
    tokens_h1 = extract_tokens(h1_text)

    if not tokens_title or not tokens_h1:
        overlap = 0.0
    else:
        intersection = tokens_title & tokens_h1
        # Overlap ratio relative to the shorter of the two token sets
        overlap = len(intersection) / min(len(tokens_title), len(tokens_h1))

    aligned = exact_match or h1_in_title or title_in_h1 or (overlap >= 0.6)

    return {
        "title_text": title.strip(),
        "h1_text": h1_text.strip(),
        "exact_match": exact_match,
        "h1_in_title": h1_in_title,
        "title_in_h1": title_in_h1,
        "token_overlap_ratio": round(overlap, 3),
        "aligned": aligned,
    }


@dataclass
class HeadingOccurrence:
    level: int
    text: str
    position: int


@dataclass
class SectionData:
    heading_text: str | None
    heading_level: int | None
    position: int
    word_count: int = 0
    paragraph_count: int = 0
    has_lists: bool = False
    list_count: int = 0
    is_empty: bool = False
    is_thin: bool = False


@dataclass
class ParagraphOccurrence:
    position: int
    word_count: int
    char_count: int
    text: str


class ContentStructureParser(HTMLParser):
    """
    SAX-style HTML parser to extract structural elements:
    headings, paragraphs, lists, and sections.
    """

    HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
    IGNORE_TAGS = {"script", "style", "noscript", "svg", "head", "iframe"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.headings: list[HeadingOccurrence] = []
        self.paragraphs: list[ParagraphOccurrence] = []
        self.unordered_list_count: int = 0
        self.ordered_list_count: int = 0
        self.total_list_item_count: int = 0

        self.sections: list[SectionData] = []

        self._ignore_depth = 0
        self._current_heading_level: int | None = None
        self._current_heading_parts: list[str] = []
        self._heading_position = 0

        self._in_p = False
        self._current_p_parts: list[str] = []
        self._p_position = 0

        self._in_li = False
        self._current_li_parts: list[str] = []

        # Current section tracker (starts as preamble before first heading)
        self._current_section = SectionData(
            heading_text=None,
            heading_level=None,
            position=0,
        )

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_lower = tag.lower()
        if tag_lower in self.IGNORE_TAGS:
            self._ignore_depth += 1
            return

        if self._ignore_depth > 0:
            return

        if tag_lower in self.HEADING_TAGS:
            level = int(tag_lower[1])
            self._current_heading_level = level
            self._current_heading_parts = []
            self._heading_position += 1

        elif tag_lower == "p":
            self._in_p = True
            self._current_p_parts = []
            self._p_position += 1

        elif tag_lower == "ul":
            self.unordered_list_count += 1
            self._current_section.has_lists = True
            self._current_section.list_count += 1

        elif tag_lower == "ol":
            self.ordered_list_count += 1
            self._current_section.has_lists = True
            self._current_section.list_count += 1

        elif tag_lower == "li":
            self._in_li = True
            self._current_li_parts = []
            self.total_list_item_count += 1

    def handle_endtag(self, tag: str) -> None:
        tag_lower = tag.lower()
        if tag_lower in self.IGNORE_TAGS:
            if self._ignore_depth > 0:
                self._ignore_depth -= 1
            return

        if self._ignore_depth > 0:
            return

        if tag_lower in self.HEADING_TAGS and self._current_heading_level is not None:
            heading_text = " ".join(self._current_heading_parts).strip()
            heading = HeadingOccurrence(
                level=self._current_heading_level,
                text=heading_text,
                position=self._heading_position,
            )
            self.headings.append(heading)

            # Close previous section and finalize empty/thin flags
            self._finalize_current_section()

            # Start new section
            self._current_section = SectionData(
                heading_text=heading_text,
                heading_level=self._current_heading_level,
                position=self._heading_position,
            )

            self._current_heading_level = None
            self._current_heading_parts = []

        elif tag_lower == "p" and self._in_p:
            p_text = " ".join(self._current_p_parts).strip()
            if p_text:
                words = len(p_text.split())
                p_occ = ParagraphOccurrence(
                    position=self._p_position,
                    word_count=words,
                    char_count=len(p_text),
                    text=p_text,
                )
                self.paragraphs.append(p_occ)
                self._current_section.paragraph_count += 1
                self._current_section.word_count += words
            self._in_p = False
            self._current_p_parts = []

        elif tag_lower == "li" and self._in_li:
            li_text = " ".join(self._current_li_parts).strip()
            if li_text:
                words = len(li_text.split())
                self._current_section.word_count += words
            self._in_li = False
            self._current_li_parts = []

    def handle_data(self, data: str) -> None:
        if self._ignore_depth > 0:
            return

        clean = data.strip()
        if not clean:
            return

        if self._current_heading_level is not None:
            self._current_heading_parts.append(clean)
        elif self._in_p:
            self._current_p_parts.append(clean)
        elif self._in_li:
            self._current_li_parts.append(clean)
        else:
            # Text directly inside body/div/section
            words = len(clean.split())
            self._current_section.word_count += words

    def _finalize_current_section(self) -> None:
        # Only record sections that have a heading or non-empty preamble
        if self._current_section.heading_text is not None or self._current_section.word_count > 0:
            self._current_section.is_empty = (
                self._current_section.word_count == 0
                and not self._current_section.has_lists
            )
            # Thin section: heading with almost no body text (< 5 words) and no lists
            self._current_section.is_thin = (
                0 < self._current_section.word_count < 5
                and not self._current_section.has_lists
            )
            self.sections.append(self._current_section)


    def close(self) -> None:
        super().close()
        self._finalize_current_section()


@dataclass
class ContentStructureEvidence:
    """
    Complete structured content evidence produced by ContentStructureAnalyzer.
    """
    h1_count: int = 0
    has_h1: bool = False
    multiple_h1: bool = False
    missing_h1: bool = False
    heading_levels: dict[str, int] = field(default_factory=dict)
    total_headings: int = 0
    heading_hierarchy_valid: bool = True
    heading_level_skips: list[dict[str, Any]] = field(default_factory=list)
    repeated_headings: list[dict[str, Any]] = field(default_factory=list)
    list_present: bool = False
    unordered_list_present: bool = False
    ordered_list_present: bool = False
    unordered_list_count: int = 0
    ordered_list_count: int = 0
    total_list_item_count: int = 0
    paragraph_count: int = 0
    average_paragraph_words: float = 0.0
    long_text_blocks: list[dict[str, Any]] = field(default_factory=list)
    section_count: int = 0
    sections: list[dict[str, Any]] = field(default_factory=list)
    empty_sections: list[dict[str, Any]] = field(default_factory=list)
    thin_sections: list[dict[str, Any]] = field(default_factory=list)
    title_h1_alignment: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ContentStructureAnalyzer:
    """
    Analyzes content structure from HTML text and existing page extraction evidence.
    """

    LONG_TEXT_BLOCK_THRESHOLD_WORDS = 150

    def analyze(
        self,
        html_content: str | None = None,
        title: str | None = None,
        headings_fallback: list[Any] | None = None,
    ) -> ContentStructureEvidence:
        evidence = ContentStructureEvidence()

        if html_content and html_content.strip():
            parser = ContentStructureParser()
            try:
                parser.feed(html_content)
                parser.close()
            except Exception:
                pass

            headings = parser.headings
            paragraphs = parser.paragraphs
            evidence.unordered_list_count = parser.unordered_list_count
            evidence.ordered_list_count = parser.ordered_list_count
            evidence.total_list_item_count = parser.total_list_item_count
            evidence.list_present = (
                parser.unordered_list_count > 0 or parser.ordered_list_count > 0
            )
            evidence.unordered_list_present = parser.unordered_list_count > 0
            evidence.ordered_list_present = parser.ordered_list_count > 0
            parsed_sections = parser.sections
        else:
            # Fallback when only structured headings are available
            headings = []
            if headings_fallback:
                for idx, h in enumerate(headings_fallback):
                    if isinstance(h, dict):
                        lvl = h.get("level", 1)
                        txt = h.get("text", "")
                        pos = h.get("position", idx + 1)
                    else:
                        lvl = getattr(h, "level", 1)
                        txt = getattr(h, "text", "")
                        pos = getattr(h, "position", idx + 1)
                    headings.append(HeadingOccurrence(level=lvl, text=txt, position=pos))
            paragraphs = []
            parsed_sections = []

        # 1. Heading count and level distribution
        levels_map = {f"h{i}": 0 for i in range(1, 7)}
        for h in headings:
            key = f"h{h.level}"
            if key in levels_map:
                levels_map[key] += 1

        evidence.heading_levels = levels_map
        evidence.h1_count = levels_map["h1"]
        evidence.has_h1 = evidence.h1_count >= 1
        evidence.multiple_h1 = evidence.h1_count > 1
        evidence.missing_h1 = evidence.h1_count == 0
        evidence.total_headings = len(headings)

        # 2. Heading hierarchy and level skips
        hierarchy_valid = True
        skips: list[dict[str, Any]] = []

        if headings:
            # Check first heading
            first_h = headings[0]
            if first_h.level != 1:
                # Started with H2, H3, etc. instead of H1
                hierarchy_valid = False
                skips.append({
                    "type": "initial_level_skip",
                    "previous_level": 0,
                    "current_level": first_h.level,
                    "skipped_levels": list(range(1, first_h.level)),
                    "previous_heading": None,
                    "current_heading": first_h.text,
                    "position": first_h.position,
                })

            for i in range(1, len(headings)):
                prev = headings[i - 1]
                curr = headings[i]

                # Downward skip: e.g. H1 -> H3 (skips H2) or H2 -> H4 (skips H3)
                if curr.level > prev.level + 1:
                    hierarchy_valid = False
                    skipped = list(range(prev.level + 1, curr.level))
                    skips.append({
                        "type": "descending_level_skip",
                        "previous_level": prev.level,
                        "current_level": curr.level,
                        "skipped_levels": skipped,
                        "previous_heading": prev.text,
                        "current_heading": curr.text,
                        "position": curr.position,
                    })

        evidence.heading_hierarchy_valid = hierarchy_valid
        evidence.heading_level_skips = skips

        # 3. Repeated headings detection
        heading_occurrences: dict[str, list[HeadingOccurrence]] = {}
        for h in headings:
            norm = normalize_text(h.text)
            if norm:
                heading_occurrences.setdefault(norm, []).append(h)

        repeated: list[dict[str, Any]] = []
        for norm_text, occs in heading_occurrences.items():
            if len(occs) > 1:
                repeated.append({
                    "text": occs[0].text,
                    "count": len(occs),
                    "levels": [o.level for o in occs],
                    "positions": [o.position for o in occs],
                })
        evidence.repeated_headings = repeated

        # 4. Paragraph distribution and long text blocks
        evidence.paragraph_count = len(paragraphs)
        if paragraphs:
            total_words = sum(p.word_count for p in paragraphs)
            evidence.average_paragraph_words = round(total_words / len(paragraphs), 1)

            long_blocks = []
            for p in paragraphs:
                if p.word_count >= self.LONG_TEXT_BLOCK_THRESHOLD_WORDS:
                    snippet = p.text[:100] + ("..." if len(p.text) > 100 else "")
                    long_blocks.append({
                        "paragraph_position": p.position,
                        "word_count": p.word_count,
                        "char_count": p.char_count,
                        "snippet": snippet,
                    })
            evidence.long_text_blocks = long_blocks

        # 5. Section structure: empty and thin sections
        evidence.section_count = len(parsed_sections)
        evidence.sections = [
            {
                "heading_text": s.heading_text,
                "heading_level": s.heading_level,
                "position": s.position,
                "word_count": s.word_count,
                "paragraph_count": s.paragraph_count,
                "has_lists": s.has_lists,
                "is_empty": s.is_empty,
                "is_thin": s.is_thin,
            }
            for s in parsed_sections
        ]

        evidence.empty_sections = [
            {
                "heading_text": s.heading_text,
                "heading_level": s.heading_level,
                "position": s.position,
            }
            for s in parsed_sections
            if s.is_empty and s.heading_text is not None
        ]

        evidence.thin_sections = [
            {
                "heading_text": s.heading_text,
                "heading_level": s.heading_level,
                "position": s.position,
                "word_count": s.word_count,
            }
            for s in parsed_sections
            if s.is_thin and s.heading_text is not None
        ]

        # 6. Title / H1 Alignment
        first_h1 = next((h.text for h in headings if h.level == 1 and h.text), None)
        evidence.title_h1_alignment = evaluate_title_h1_alignment(title, first_h1)

        return evidence


def analyze_content_structure(
    html_content: str | None = None,
    title: str | None = None,
    headings_fallback: list[Any] | None = None,
) -> ContentStructureEvidence:
    """Convenience function to analyze content structure."""
    analyzer = ContentStructureAnalyzer()
    return analyzer.analyze(html_content, title, headings_fallback)
