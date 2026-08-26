"""
Entity Analyzer (Task 5 - Step 6)

Performs deterministic entity extraction, normalization, presence coverage,
and cross-evidence consistency analysis across page structured data, microdata, and text.
"""

from dataclasses import asdict, dataclass, field
import json
import re
from typing import Any


KNOWN_SCHEMA_TYPES = {
    "organization": "organization",
    "corporation": "organization",
    "localbusiness": "organization",
    "person": "person",
    "product": "product",
    "place": "place",
    "service": "service",
    "brand": "brand",
    "softwareapplication": "product",
    "event": "event",
}

ORG_SUFFIX_REGEX = re.compile(
    r"\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*\s+(?:Inc\.?|LLC\.?|Corp\.?|Corporation|Ltd\.?|Technologies|Labs|Laboratories|Foundation|Group))\b"
)

PRODUCT_REGEX = re.compile(
    r"\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*\s+(?:Platform|App|Application|Software|Tool|API|System))\b"
)


def clean_name(name: str | None) -> str:
    if not name:
        return ""
    return re.sub(r"\s+", " ", name).strip()


@dataclass
class DetectedEntityItem:
    name: str
    entity_type: str
    confidence: float
    sources: list[str]
    same_as: list[str] = field(default_factory=list)
    description: str | None = None
    in_title: bool = False
    in_h1: bool = False
    mention_count: int = 1


@dataclass
class EntityAnalysisEvidence:
    entity_count: int = 0
    entities: list[dict[str, Any]] = field(default_factory=list)
    structured_data_entity_count: int = 0
    content_entity_count: int = 0
    has_organization_entity: bool = False
    has_product_entity: bool = False
    entity_consistency_valid: bool = True
    consistency_issues: list[dict[str, Any]] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class EntityAnalyzer:
    """
    Analyzes page structured data, microdata, headings, and text to extract entities
    and evaluate their consistency and presence.
    """

    def analyze(
        self,
        text_content: str | None = None,
        title: str | None = None,
        headings: list[Any] | None = None,
        structured_data_blocks: list[Any] | None = None,
        microdata_items: list[Any] | None = None,
    ) -> EntityAnalysisEvidence:
        evidence = EntityAnalysisEvidence()

        entities_map: dict[str, DetectedEntityItem] = {}

        title_lower = (title or "").lower()

        h1_texts: list[str] = []
        heading_texts: list[str] = []
        if headings:
            for h in headings:
                if isinstance(h, dict):
                    lvl = h.get("level", 1)
                    txt = h.get("text", "")
                else:
                    lvl = getattr(h, "level", 1)
                    txt = getattr(h, "text", "")
                if txt:
                    clean_txt = str(txt).strip()
                    heading_texts.append(clean_txt)
                    if lvl == 1:
                        h1_texts.append(clean_txt)

        h1_lower = " ".join(h1_texts).lower()
        full_text_lower = ((text_content or "") + " " + " ".join(heading_texts)).lower()

        # 1. Parse JSON-LD Structured Data
        if structured_data_blocks:
            for block in structured_data_blocks:
                parsed = None
                if isinstance(block, dict):
                    parsed = block.get("parsed_json") or block
                elif hasattr(block, "parsed_json") and block.parsed_json:
                    parsed = block.parsed_json

                if parsed:
                    self._extract_entities_from_json(parsed, entities_map, title_lower, h1_lower, full_text_lower)

        # 2. Parse Microdata Items
        if microdata_items:
            for item in microdata_items:
                itype = None
                props = None
                if isinstance(item, dict):
                    itype = item.get("item_type")
                    props = item.get("properties") or {}
                else:
                    itype = getattr(item, "item_type", None)
                    props = getattr(item, "properties", None) or {}

                if itype and isinstance(itype, str):
                    clean_type = itype.split("/")[-1].lower()
                    mapped_type = KNOWN_SCHEMA_TYPES.get(clean_type, "other")
                    name = props.get("name") if isinstance(props, dict) else None
                    if name and str(name).strip():
                        entity_name = clean_name(str(name))
                        norm_key = entity_name.lower()

                        in_t = entity_name.lower() in title_lower
                        in_h1 = entity_name.lower() in h1_lower

                        if norm_key in entities_map:
                            if "microdata" not in entities_map[norm_key].sources:
                                entities_map[norm_key].sources.append("microdata")
                        else:
                            entities_map[norm_key] = DetectedEntityItem(
                                name=entity_name,
                                entity_type=mapped_type,
                                confidence=0.90,
                                sources=["microdata"],
                                in_title=in_t,
                                in_h1=in_h1,
                            )

        # 3. In-Content Named Entity Heuristics
        text_to_search = (text_content or "") + "\n" + "\n".join(heading_texts)
        if text_to_search.strip():
            # Corporate / Organization matches
            for match in ORG_SUFFIX_REGEX.finditer(text_to_search):
                org_name = clean_name(match.group(1))
                norm_key = org_name.lower()
                if len(org_name) >= 4:
                    in_t = org_name.lower() in title_lower
                    in_h1 = org_name.lower() in h1_lower
                    mentions = full_text_lower.count(org_name.lower())

                    if norm_key in entities_map:
                        if "content" not in entities_map[norm_key].sources:
                            entities_map[norm_key].sources.append("content")
                        entities_map[norm_key].mention_count = max(entities_map[norm_key].mention_count, mentions)
                    else:
                        entities_map[norm_key] = DetectedEntityItem(
                            name=org_name,
                            entity_type="organization",
                            confidence=0.80,
                            sources=["content"],
                            in_title=in_t,
                            in_h1=in_h1,
                            mention_count=mentions,
                        )

            # Product matches
            for match in PRODUCT_REGEX.finditer(text_to_search):
                prod_name = clean_name(match.group(1))
                norm_key = prod_name.lower()
                if len(prod_name) >= 4 and norm_key not in entities_map:
                    in_t = prod_name.lower() in title_lower
                    in_h1 = prod_name.lower() in h1_lower
                    mentions = full_text_lower.count(prod_name.lower())

                    entities_map[norm_key] = DetectedEntityItem(
                        name=prod_name,
                        entity_type="product",
                        confidence=0.75,
                        sources=["content"],
                        in_title=in_t,
                        in_h1=in_h1,
                        mention_count=mentions,
                    )

        # Compile results
        entity_list = list(entities_map.values())
        evidence.entity_count = len(entity_list)
        evidence.entities = [asdict(e) for e in entity_list]

        evidence.structured_data_entity_count = sum(
            1 for e in entity_list if "structured_data" in e.sources or "microdata" in e.sources
        )
        evidence.content_entity_count = sum(
            1 for e in entity_list if "content" in e.sources
        )

        evidence.has_organization_entity = any(e.entity_type == "organization" for e in entity_list)
        evidence.has_product_entity = any(e.entity_type == "product" for e in entity_list)

        # 4. Consistency & Quality Checks
        for e in entity_list:
            # Check: schema entity missing from visible headings/title
            if "structured_data" in e.sources and not e.in_title and not e.in_h1:
                issue = {
                    "entity_name": e.name,
                    "entity_type": e.entity_type,
                    "issue": "Schema entity not visible in page title or primary heading",
                }
                evidence.consistency_issues.append(issue)
                evidence.entity_consistency_valid = False

            # Finding: missing authority links on organization
            if e.entity_type == "organization" and not e.same_as and "structured_data" in e.sources:
                evidence.findings.append({
                    "type": "entity_missing_authority_links",
                    "severity": "low",
                    "title": f"Organization '{e.name}' lacks sameAs reference links",
                    "description": f"The structured data entity '{e.name}' does not provide sameAs links (Wikidata, Wikipedia, or official social profiles) to reinforce entity authority.",
                    "evidence": {"entity_name": e.name, "entity_type": e.entity_type},
                })

        if evidence.consistency_issues:
            evidence.findings.append({
                "type": "entity_title_inconsistency",
                "severity": "medium",
                "title": "Structured data entity missing from title and main heading",
                "description": "One or more declared Schema.org entities do not appear in the page title or primary heading.",
                "evidence": {"issues": evidence.consistency_issues},
            })

        if evidence.entity_count == 0:
            evidence.findings.append({
                "type": "no_entities_detected",
                "severity": "medium",
                "title": "No brand or organizational entities identified",
                "description": "Neither structured data markup nor visible content establishes a clear entity (Organization, Product, or Person).",
                "evidence": {"content_words": len(text_content.split()) if text_content else 0},
            })
        elif evidence.has_organization_entity:
            org_names = [e.name for e in entity_list if e.entity_type == "organization"]
            evidence.findings.append({
                "type": "organization_entity_identified",
                "severity": "info",
                "title": "Organization entity clearly identified",
                "description": f"Recognized primary organization entity: {', '.join(org_names)}.",
                "evidence": {"organizations": org_names},
            })

        return evidence

    def _extract_entities_from_json(
        self,
        data: Any,
        entities_map: dict[str, DetectedEntityItem],
        title_lower: str,
        h1_lower: str,
        full_text_lower: str,
    ) -> None:
        if isinstance(data, list):
            for item in data:
                self._extract_entities_from_json(item, entities_map, title_lower, h1_lower, full_text_lower)
            return

        if not isinstance(data, dict):
            return

        raw_type = data.get("@type")
        if isinstance(raw_type, list):
            types_to_check = [str(t).lower() for t in raw_type]
        elif isinstance(raw_type, str):
            types_to_check = [raw_type.lower()]
        else:
            types_to_check = []

        name = data.get("name")
        if name and isinstance(name, str) and str(name).strip():
            entity_name = clean_name(name)
            norm_key = entity_name.lower()

            mapped_type = "other"
            for t in types_to_check:
                if t in KNOWN_SCHEMA_TYPES:
                    mapped_type = KNOWN_SCHEMA_TYPES[t]
                    break

            if mapped_type != "other" or any("organization" in t or "product" in t or "person" in t for t in types_to_check):
                same_as = data.get("sameAs")
                same_as_list: list[str] = []
                if isinstance(same_as, str):
                    same_as_list = [same_as]
                elif isinstance(same_as, list):
                    same_as_list = [str(s) for s in same_as if isinstance(s, str)]

                desc = data.get("description")
                desc_str = str(desc).strip() if desc and isinstance(desc, str) else None

                in_t = entity_name.lower() in title_lower
                in_h1 = entity_name.lower() in h1_lower
                mentions = full_text_lower.count(entity_name.lower())

                if norm_key in entities_map:
                    e = entities_map[norm_key]
                    if "structured_data" not in e.sources:
                        e.sources.append("structured_data")
                    e.confidence = max(e.confidence, 0.95)
                    for s in same_as_list:
                        if s not in e.same_as:
                            e.same_as.append(s)
                    if desc_str and not e.description:
                        e.description = desc_str
                else:
                    entities_map[norm_key] = DetectedEntityItem(
                        name=entity_name,
                        entity_type=mapped_type if mapped_type != "other" else types_to_check[0],
                        confidence=0.95,
                        sources=["structured_data"],
                        same_as=same_as_list,
                        description=desc_str,
                        in_title=in_t,
                        in_h1=in_h1,
                        mention_count=max(1, mentions),
                    )

        # Recursively check nested objects (e.g. brand, publisher, author)
        for key in ["brand", "publisher", "author", "creator", "organization"]:
            nested = data.get(key)
            if nested:
                self._extract_entities_from_json(nested, entities_map, title_lower, h1_lower, full_text_lower)


def analyze_entities(
    text_content: str | None = None,
    title: str | None = None,
    headings: list[Any] | None = None,
    structured_data_blocks: list[Any] | None = None,
    microdata_items: list[Any] | None = None,
) -> EntityAnalysisEvidence:
    """Convenience function to run entity analysis."""
    analyzer = EntityAnalyzer()
    return analyzer.analyze(
        text_content=text_content,
        title=title,
        headings=headings,
        structured_data_blocks=structured_data_blocks,
        microdata_items=microdata_items,
    )
