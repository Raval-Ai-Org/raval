from dataclasses import dataclass, field
from datetime import datetime
import html
from html.parser import HTMLParser
import json
import os
import re
from urllib.parse import urljoin, urlparse, urlsplit, urlunsplit

from sqlalchemy.orm import Session

from .models import (
    PageBreadcrumb,
    PageCanonical,
    PageExtraction,
    PageHeading,
    PageHreflang,
    PageImage,
    PageIndexabilityEvidence,
    PageLanguage,
    PageLink,
    PageMetaDescription,
    PageMicrodata,
    PageResult,
    PageRobots,
    PageSocialMetadata,
    PageStructuredData,
    Scan,
)

# Threshold constants for title and meta description evidence
TITLE_TOO_SHORT_THRESHOLD = 10
TITLE_TOO_LONG_THRESHOLD = 60
META_DESC_TOO_SHORT_THRESHOLD = 50
META_DESC_TOO_LONG_THRESHOLD = 160


@dataclass
class HeadingItem:
    level: int
    text: str
    position: int
    empty: bool


@dataclass
class MetaDescriptionItem:
    text: str | None
    position: int
    length: int
    word_count: int
    empty: bool
    duplicate_within_page: bool
    duplicate_in_scan: bool
    too_short: bool
    too_long: bool


@dataclass
class CanonicalItem:
    url: str | None
    position: int
    empty: bool
    valid: bool
    self_reference: bool
    cross_page: bool


@dataclass
class RobotsItem:
    raw_content: str | None = None
    index: bool | None = None
    follow: bool | None = None
    noindex: bool = False
    nofollow: bool = False
    noarchive: bool = False
    nosnippet: bool = False
    other_directives: list[str] = field(default_factory=list)


@dataclass
class SocialMetadataItem:
    platform: str
    property_name: str
    content: str | None
    position: int
    empty: bool
    duplicate: bool


@dataclass
class StructuredDataItem:
    block_position: int
    raw_block: str | None = None
    parsed_json: dict | list | None = None
    context: str | None = None
    types: list[str] | None = None
    entity_names: list[str] | None = None
    entity_urls: list[str] | None = None
    parse_error: str | None = None


@dataclass
class MicrodataItem:
    item_position: int
    item_type: str | None = None
    item_id: str | None = None
    properties: dict | None = None
    raw_snippet: str | None = None


@dataclass
class BreadcrumbItem:
    position: int
    detection_method: str
    name: str | None = None
    url: str | None = None


@dataclass
class ImageItem:
    position: int
    url: str | None = None
    alt: str | None = None
    alt_missing: bool = False
    alt_empty: bool = False
    width: int | None = None
    height: int | None = None
    file_type: str | None = None
    loading: str | None = None
    lazy_loaded: bool = False


@dataclass
class LinkItem:
    position: int
    source_url: str | None = None
    destination_url: str | None = None
    anchor_text: str | None = None
    rel_raw: str | None = None
    nofollow: bool = False
    sponsored: bool = False
    ugc: bool = False
    link_type: str = "internal"


@dataclass
class HreflangItem:
    position: int
    language_region: str
    target_url: str | None = None
    duplicate_declaration: bool = False
    conflicting_declaration: bool = False


@dataclass
class ExtractionResult:
    html_available: bool = False
    content_size_bytes: int = 0
    clean_text_available: bool = False
    clean_text: str = ""
    word_count: int = 0
    paragraph_count: int = 0
    main_content_candidate: str | None = None
    main_content_confidence: float | None = None
    html_lang: str | None = None
    detected_language: str | None = None
    extraction_status: str = "success"
    extraction_error: str | None = None

    # Title evidence
    title_present: bool = False
    title_text: str | None = None
    title_length: int = 0
    title_word_count: int = 0
    title_empty: bool = False
    title_duplicate: bool = False
    title_too_short: bool = False
    title_too_long: bool = False
    title_count: int = 0

    # Meta description evidence
    meta_description_present: bool = False
    meta_description_count: int = 0
    meta_descriptions: list[MetaDescriptionItem] = field(default_factory=list)

    # Heading evidence
    h1_count: int = 0
    missing_h1: bool = False
    multiple_h1: bool = False
    heading_hierarchy_issue: bool = False
    heading_hierarchy_details: list[dict] | None = None
    headings: list[HeadingItem] = field(default_factory=list)

    # Canonical evidence
    canonical_present: bool = False
    canonical_count: int = 0
    canonical_multiple: bool = False
    canonical_conflict: bool = False
    canonicals: list[CanonicalItem] = field(default_factory=list)

    # Robots evidence
    robots: RobotsItem | None = None

    # Open Graph & Twitter / X metadata
    social_metadata: list[SocialMetadataItem] = field(default_factory=list)

    # JSON-LD / Structured data
    structured_data: list[StructuredDataItem] = field(default_factory=list)

    # Microdata
    microdata: list[MicrodataItem] = field(default_factory=list)

    # Breadcrumbs
    breadcrumbs: list[BreadcrumbItem] = field(default_factory=list)

    # Images
    images: list[ImageItem] = field(default_factory=list)
    image_count: int = 0
    images_without_alt: int = 0

    # Links
    links: list[LinkItem] = field(default_factory=list)

    # Hreflang
    hreflang: list[HreflangItem] = field(default_factory=list)


class PageHTMLParser(HTMLParser):
    CDATA_CONTENT_ELEMENTS = ("script", "style")
    RCDATA_CONTENT_ELEMENTS = ()
    NON_VISIBLE_TAGS = {
        "script",
        "style",
        "noscript",
        "svg",
        "canvas",
        "template",
    }
    HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self, page_url: str | None = None) -> None:
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.html_lang: str | None = None
        self.titles: list[str] = []
        self.raw_meta_descriptions: list[str | None] = []
        self.raw_headings: list[tuple[int, str]] = []
        self.raw_canonicals: list[str | None] = []
        self.raw_robots: list[str | None] = []
        self.raw_social_meta: list[tuple[str, str, str | None]] = []
        self.raw_json_ld_blocks: list[str] = []
        self.raw_microdata_items: list[dict] = []
        self.raw_semantic_breadcrumbs: list[tuple[str | None, str | None]] = []
        self.raw_images: list[dict] = []
        self.raw_links: list[dict] = []
        self.raw_hreflang: list[tuple[str, str | None]] = []
        self.visible_text_fragments: list[str] = []

        self.paragraphs: list[str] = []
        self._in_p: bool = False
        self._current_p_parts: list[str] = []

        self.main_tag_fragments: list[str] = []
        self._in_main_tag_depth: int = 0
        self.article_tag_fragments: list[str] = []
        self._in_article_tag_depth: int = 0
        self.role_main_fragments: list[str] = []
        self._role_main_stack: list[str] = []

        self._in_head = False
        self._ignore_depth = 0
        self._in_title = False
        self._current_title_parts: list[str] = []
        self._current_heading_level: int | None = None
        self._current_heading_parts: list[str] = []

        self._in_json_ld = False
        self._current_json_ld_parts: list[str] = []

        self._in_breadcrumb_nav = False
        self._breadcrumb_depth = 0

        self._in_anchor = False
        self._current_anchor_href: str | None = None
        self._current_anchor_rel: str | None = None
        self._current_anchor_text_parts: list[str] = []

        self._current_microdata_item: dict | None = None
        self._current_itemprop_name: str | None = None
        self._current_itemprop_parts: list[str] = []

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        tag_lower = tag.lower()
        attr_dict = {k.lower(): v for k, v in attrs if v is not None}
        all_attr_names = {k.lower() for k, _ in attrs}

        # HTML element language
        if tag_lower == "html":
            lang = attr_dict.get("lang") or attr_dict.get("xml:lang")
            if lang and lang.strip():
                self.html_lang = lang.strip()

        # Head tracking
        if tag_lower == "head":
            self._in_head = True

        # When body or structural content starts, head is closed
        if tag_lower == "body" or (self._in_head and tag_lower in {"h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "section", "article", "header", "footer", "main", "nav", "aside"}):
            self._in_head = False
            self._ignore_depth = 0

        # Paragraph start tracking
        if tag_lower == "p" and self._ignore_depth == 0 and not self._in_head and not self._in_json_ld:
            if self._in_p:
                p_text = re.sub(r"\s+", " ", "".join(self._current_p_parts)).strip()
                if p_text:
                    self.paragraphs.append(p_text)
            self._in_p = True
            self._current_p_parts = []

        # Auto-close paragraph on block elements
        if self._in_p and tag_lower not in {"p", "b", "strong", "i", "em", "a", "span", "code", "small", "sub", "sup", "mark", "u", "s", "del", "ins", "time", "abbr", "q", "cite", "img", "br", "wbr"}:
            p_text = re.sub(r"\s+", " ", "".join(self._current_p_parts)).strip()
            if p_text:
                self.paragraphs.append(p_text)
            self._in_p = False
            self._current_p_parts = []

        # Main-content container tracking
        if tag_lower == "main":
            self._in_main_tag_depth += 1
        if tag_lower == "article":
            self._in_article_tag_depth += 1
        if attr_dict.get("role", "").strip().lower() == "main":
            self._role_main_stack.append(tag_lower)

        # Auto-close title if any other tag starts without closing title
        if self._in_title and tag_lower != "title":
            title_text = "".join(self._current_title_parts)
            self.titles.append(title_text)
            self._in_title = False
            self._current_title_parts = []

        # JSON-LD script detection
        if tag_lower == "script":
            script_type = attr_dict.get("type", "").strip().lower()
            if script_type == "application/ld+json":
                self._in_json_ld = True
                self._current_json_ld_parts = []

        # Microdata item scope start
        if "itemscope" in all_attr_names or "itemtype" in attr_dict:
            item_type = attr_dict.get("itemtype")
            item_id = attr_dict.get("itemid")
            microdata_obj = {
                "item_type": item_type.strip() if item_type else None,
                "item_id": item_id.strip() if item_id else None,
                "properties": {},
                "raw_snippet": f"<{tag} {' '.join(f'{k}=\"{v}\"' if v is not None else k for k, v in attrs)}>",
            }
            self.raw_microdata_items.append(microdata_obj)
            self._current_microdata_item = microdata_obj

        # Microdata property start
        if "itemprop" in attr_dict:
            prop_name = attr_dict["itemprop"].strip()
            prop_val = attr_dict.get("content") or attr_dict.get("href") or attr_dict.get("src")
            if self._current_microdata_item is not None:
                if prop_val is not None:
                    self._current_microdata_item["properties"][prop_name] = prop_val.strip()
                else:
                    self._current_itemprop_name = prop_name
                    self._current_itemprop_parts = []

        # Semantic breadcrumb container detection
        aria_label = attr_dict.get("aria-label", "").strip().lower()
        class_name = attr_dict.get("class", "").strip().lower()
        id_name = attr_dict.get("id", "").strip().lower()
        is_bc_container = (
            aria_label == "breadcrumb"
            or "breadcrumb" in class_name
            or "breadcrumb" in id_name
            or (attr_dict.get("itemtype", "").lower().endswith("breadcrumblist"))
        )
        if is_bc_container and not self._in_breadcrumb_nav:
            self._in_breadcrumb_nav = True
            self._breadcrumb_depth = 1
        elif self._in_breadcrumb_nav:
            self._breadcrumb_depth += 1

        # Meta tags
        if tag_lower == "meta":
            name = attr_dict.get("name", "").strip().lower()
            prop = attr_dict.get("property", "").strip().lower()
            content = attr_dict.get("content")

            # Meta description
            if name == "description":
                self.raw_meta_descriptions.append(content)

            # Robots metadata
            if name == "robots" or name in {"googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider", "yandexbot"}:
                self.raw_robots.append(content)

            # Open Graph metadata
            if prop.startswith("og:") or name.startswith("og:"):
                og_name = prop if prop.startswith("og:") else name
                self.raw_social_meta.append(("open_graph", og_name, content))

            # Twitter / X metadata
            if name.startswith("twitter:") or prop.startswith("twitter:"):
                tw_name = name if name.startswith("twitter:") else prop
                self.raw_social_meta.append(("twitter", tw_name, content))

        # Link tags (canonical, alternate/hreflang)
        if tag_lower == "link":
            rel = attr_dict.get("rel", "").strip().lower()
            rel_tokens = rel.split()
            href = attr_dict.get("href")

            if "canonical" in rel_tokens:
                self.raw_canonicals.append(href)

            if "alternate" in rel_tokens and "hreflang" in attr_dict:
                lang_reg = attr_dict["hreflang"].strip()
                self.raw_hreflang.append((lang_reg, href))

        # Title start
        if tag_lower == "title":
            if self._in_title:
                title_text = "".join(self._current_title_parts)
                self.titles.append(title_text)
            self._in_title = True
            self._current_title_parts = []

        # Heading start
        if tag_lower in self.HEADING_TAGS:
            if self._current_heading_level is not None:
                heading_text = "".join(self._current_heading_parts)
                self.raw_headings.append((self._current_heading_level, heading_text))
            self._current_heading_level = int(tag_lower[1])
            self._current_heading_parts = []

        # Image extraction
        if tag_lower == "img":
            src = attr_dict.get("src") or attr_dict.get("data-src")
            alt_missing = "alt" not in attr_dict
            alt_val = attr_dict.get("alt")
            alt_empty = (alt_val is not None and len(alt_val.strip()) == 0)
            alt_text = html.unescape(alt_val).strip() if alt_val is not None else None

            width_val = None
            if "width" in attr_dict:
                try:
                    width_val = int(re.sub(r"[^\d]", "", attr_dict["width"]))
                except (ValueError, TypeError):
                    width_val = None

            height_val = None
            if "height" in attr_dict:
                try:
                    height_val = int(re.sub(r"[^\d]", "", attr_dict["height"]))
                except (ValueError, TypeError):
                    height_val = None

            loading = attr_dict.get("loading")
            lazy_loaded = (
                (loading is not None and loading.strip().lower() == "lazy")
                or "lazy" in attr_dict.get("class", "").lower()
                or bool(attr_dict.get("data-src"))
            )

            self.raw_images.append({
                "src": src,
                "alt": alt_text,
                "alt_missing": alt_missing,
                "alt_empty": alt_empty,
                "width": width_val,
                "height": height_val,
                "loading": loading.strip() if loading else None,
                "lazy_loaded": lazy_loaded,
            })

        # Anchor tag start
        if tag_lower == "a":
            self._in_anchor = True
            self._current_anchor_href = attr_dict.get("href")
            self._current_anchor_rel = attr_dict.get("rel")
            self._current_anchor_text_parts = []

        # Non-visible elements
        if tag_lower in self.NON_VISIBLE_TAGS:
            self._ignore_depth += 1

    def handle_endtag(self, tag: str) -> None:
        tag_lower = tag.lower()

        if tag_lower == "head":
            self._in_head = False

        if tag_lower == "title" and self._in_title:
            self._in_title = False
            title_text = "".join(self._current_title_parts)
            self.titles.append(title_text)
            self._current_title_parts = []

        if tag_lower in self.HEADING_TAGS and self._current_heading_level == int(tag_lower[1]):
            heading_text = "".join(self._current_heading_parts)
            self.raw_headings.append((self._current_heading_level, heading_text))
            self._current_heading_level = None
            self._current_heading_parts = []

        if tag_lower == "script" and self._in_json_ld:
            self._in_json_ld = False
            self.raw_json_ld_blocks.append("".join(self._current_json_ld_parts))
            self._current_json_ld_parts = []

        if self._current_itemprop_name and self._current_microdata_item is not None:
            text_val = "".join(self._current_itemprop_parts).strip()
            self._current_microdata_item["properties"][self._current_itemprop_name] = text_val
            self._current_itemprop_name = None
            self._current_itemprop_parts = []

        if self._in_anchor and tag_lower == "a":
            anchor_text = re.sub(r"\s+", " ", "".join(self._current_anchor_text_parts)).strip()
            self.raw_links.append({
                "href": self._current_anchor_href,
                "rel": self._current_anchor_rel,
                "text": anchor_text,
            })
            if self._in_breadcrumb_nav:
                self.raw_semantic_breadcrumbs.append((anchor_text, self._current_anchor_href))
            self._in_anchor = False
            self._current_anchor_href = None
            self._current_anchor_rel = None
            self._current_anchor_text_parts = []

        if self._in_breadcrumb_nav:
            self._breadcrumb_depth -= 1
            if self._breadcrumb_depth <= 0:
                self._in_breadcrumb_nav = False
                self._breadcrumb_depth = 0

        # Paragraph end tracking
        if tag_lower == "p" and self._in_p:
            p_text = re.sub(r"\s+", " ", "".join(self._current_p_parts)).strip()
            if p_text:
                self.paragraphs.append(p_text)
            self._in_p = False
            self._current_p_parts = []

        # Main-content container end tracking
        if tag_lower == "main" and self._in_main_tag_depth > 0:
            self._in_main_tag_depth -= 1
        if tag_lower == "article" and self._in_article_tag_depth > 0:
            self._in_article_tag_depth -= 1
        if self._role_main_stack and self._role_main_stack[-1] == tag_lower:
            self._role_main_stack.pop()

        if tag_lower in self.NON_VISIBLE_TAGS:
            if self._ignore_depth > 0:
                self._ignore_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._in_json_ld:
            self._current_json_ld_parts.append(data)

        if self._in_title:
            self._current_title_parts.append(data)

        if self._current_heading_level is not None:
            self._current_heading_parts.append(data)

        if self._in_anchor:
            self._current_anchor_text_parts.append(data)

        if self._current_itemprop_name is not None:
            self._current_itemprop_parts.append(data)

        if self._ignore_depth == 0 and not self._in_head and not self._in_json_ld:
            self.visible_text_fragments.append(data)
            if self._in_p:
                self._current_p_parts.append(data)
            if self._in_main_tag_depth > 0:
                self.main_tag_fragments.append(data)
            if self._in_article_tag_depth > 0:
                self.article_tag_fragments.append(data)
            if len(self._role_main_stack) > 0:
                self.role_main_fragments.append(data)

    def close(self) -> None:
        super().close()
        if self._in_p and self._current_p_parts:
            p_text = re.sub(r"\s+", " ", "".join(self._current_p_parts)).strip()
            if p_text:
                self.paragraphs.append(p_text)
            self._in_p = False
            self._current_p_parts = []

        if self._in_title and self._current_title_parts:
            title_text = "".join(self._current_title_parts)
            self.titles.append(title_text)
            self._in_title = False
            self._current_title_parts = []

        if self._current_heading_level is not None and self._current_heading_parts:
            heading_text = "".join(self._current_heading_parts)
            self.raw_headings.append((self._current_heading_level, heading_text))
            self._current_heading_level = None
            self._current_heading_parts = []

        if self._in_json_ld and self._current_json_ld_parts:
            self.raw_json_ld_blocks.append("".join(self._current_json_ld_parts))
            self._in_json_ld = False
            self._current_json_ld_parts = []


def _normalize_url(url_str: str | None) -> str | None:
    if not url_str or not url_str.strip():
        return None
    try:
        parts = urlsplit(url_str.strip())
        scheme = parts.scheme.lower()
        netloc = parts.netloc.lower()
        if ":" in netloc:
            host, port = netloc.rsplit(":", 1)
            if (scheme == "http" and port == "80") or (scheme == "https" and port == "443"):
                netloc = host

        path = parts.path or "/"
        if len(path) > 1 and path.endswith("/"):
            path = path.rstrip("/")

        return urlunsplit((scheme, netloc, path, parts.query, parts.fragment))
    except Exception:
        return url_str.strip()


def _is_valid_url(url_str: str | None) -> bool:
    if not url_str or not url_str.strip():
        return False
    try:
        parsed = urlparse(url_str.strip())
        if not parsed.scheme or not parsed.netloc:
            return False
        if parsed.scheme.lower() not in {"http", "https"}:
            return False
        return True
    except Exception:
        return False


def _parse_robots(raw_robots_list: list[str | None]) -> RobotsItem | None:
    if not raw_robots_list:
        return None

    non_none_entries = [r for r in raw_robots_list if r is not None]
    if not non_none_entries and len(raw_robots_list) > 0:
        return RobotsItem(raw_content=None, other_directives=[])

    raw_combined = ", ".join(non_none_entries)
    if not raw_combined.strip():
        return RobotsItem(raw_content=raw_combined, other_directives=[])

    directives = [d.strip().lower() for d in re.split(r"[,;]+", raw_combined) if d.strip()]

    noindex = "noindex" in directives or "none" in directives
    nofollow = "nofollow" in directives or "none" in directives
    noarchive = "noarchive" in directives
    nosnippet = "nosnippet" in directives

    index_val: bool | None = None
    if noindex:
        index_val = False
    elif "index" in directives or "all" in directives:
        index_val = True

    follow_val: bool | None = None
    if nofollow:
        follow_val = False
    elif "follow" in directives or "all" in directives:
        follow_val = True

    known_directives = {
        "index",
        "noindex",
        "follow",
        "nofollow",
        "all",
        "none",
        "noarchive",
        "nosnippet",
    }
    other_directives = [d for d in directives if d not in known_directives]

    return RobotsItem(
        raw_content=raw_combined,
        index=index_val,
        follow=follow_val,
        noindex=noindex,
        nofollow=nofollow,
        noarchive=noarchive,
        nosnippet=nosnippet,
        other_directives=other_directives,
    )


def _traverse_json_ld(obj, types_list: list[str], names_list: list[str], urls_list: list[str], contexts_list: list[str]) -> None:
    if isinstance(obj, dict):
        ctx = obj.get("@context")
        if ctx:
            if isinstance(ctx, str) and ctx.strip():
                contexts_list.append(ctx.strip())
            elif isinstance(ctx, dict):
                contexts_list.append(json.dumps(ctx))

        t = obj.get("@type")
        if t:
            if isinstance(t, str) and t.strip():
                types_list.append(t.strip())
            elif isinstance(t, list):
                for item in t:
                    if isinstance(item, str) and item.strip():
                        types_list.append(item.strip())

        name = obj.get("name")
        if name and isinstance(name, str) and name.strip():
            names_list.append(name.strip())

        url_val = obj.get("url")
        if url_val and isinstance(url_val, str) and url_val.strip():
            urls_list.append(url_val.strip())

        id_val = obj.get("@id")
        if id_val and isinstance(id_val, str) and id_val.strip() and not url_val:
            urls_list.append(id_val.strip())

        for v in obj.values():
            _traverse_json_ld(v, types_list, names_list, urls_list, contexts_list)

    elif isinstance(obj, list):
        for item in obj:
            _traverse_json_ld(item, types_list, names_list, urls_list, contexts_list)


def _extract_json_ld_breadcrumbs(parsed_json, page_url: str | None) -> list[BreadcrumbItem]:
    breadcrumbs: list[BreadcrumbItem] = []

    def _find_breadcrumb_lists(obj):
        found = []
        if isinstance(obj, dict):
            t = obj.get("@type")
            is_bc = (
                (isinstance(t, str) and t.lower() == "breadcrumblist")
                or (isinstance(t, list) and any(isinstance(x, str) and x.lower() == "breadcrumblist" for x in t))
            )
            if is_bc:
                found.append(obj)
            for v in obj.values():
                found.extend(_find_breadcrumb_lists(v))
        elif isinstance(obj, list):
            for item in obj:
                found.extend(_find_breadcrumb_lists(item))
        return found

    bc_lists = _find_breadcrumb_lists(parsed_json)
    for bc_obj in bc_lists:
        items = bc_obj.get("itemListElement")
        if isinstance(items, list):
            for idx, elem in enumerate(items):
                if isinstance(elem, dict):
                    pos = elem.get("position", idx + 1)
                    try:
                        pos_int = int(pos)
                    except (ValueError, TypeError):
                        pos_int = idx + 1

                    name = None
                    url_val = None

                    if "name" in elem and isinstance(elem["name"], str):
                        name = elem["name"].strip()
                    elif "item" in elem and isinstance(elem["item"], dict) and "name" in elem["item"]:
                        name = str(elem["item"]["name"]).strip()

                    if "item" in elem:
                        if isinstance(elem["item"], str):
                            url_val = elem["item"].strip()
                        elif isinstance(elem["item"], dict):
                            url_val = elem["item"].get("@id") or elem["item"].get("url")
                            if url_val:
                                url_val = str(url_val).strip()
                    if not url_val:
                        raw_id = elem.get("@id") or elem.get("url")
                        if raw_id:
                            url_val = str(raw_id).strip()

                    if url_val and page_url:
                        url_val = urljoin(page_url, url_val)

                    breadcrumbs.append(
                        BreadcrumbItem(
                            position=pos_int,
                            detection_method="schema_org",
                            name=name,
                            url=url_val,
                        )
                    )
    return breadcrumbs


def _derive_file_type(url_str: str | None) -> str | None:
    if not url_str:
        return None
    try:
        path = urlparse(url_str).path
        _, ext = os.path.splitext(path)
        if ext and len(ext) > 1:
            clean_ext = ext[1:].lower()
            if clean_ext in {"png", "jpg", "jpeg", "webp", "svg", "gif", "avif", "ico", "bmp", "tiff"}:
                return clean_ext
        return None
    except Exception:
        return None


def extract_html(
    html_content: str | None,
    content_type: str | None = None,
    page_url: str | None = None,
) -> ExtractionResult:
    """
    Safely extract HTML elements, metadata, canonicals, robots, social tags,
    JSON-LD, microdata, breadcrumbs, images, links, language, and hreflang from raw page content.
    """
    if html_content is None or not html_content.strip():
        return ExtractionResult(
            html_available=False,
            content_size_bytes=len(html_content.encode("utf-8")) if (html_content and isinstance(html_content, str)) else 0,
            clean_text_available=False,
            word_count=0,
            paragraph_count=0,
            main_content_candidate=None,
            main_content_confidence=None,
            detected_language=None,
            html_lang=None,
            extraction_status="success",
            title_present=False,
            title_empty=True,
            missing_h1=True,
        )

    # Check for explicit non-HTML content types
    if content_type:
        ct_lower = content_type.lower()
        if (
            not any(t in ct_lower for t in ["html", "xhtml", "text", "xml"])
            and any(
                t in ct_lower
                for t in [
                    "image/",
                    "video/",
                    "audio/",
                    "application/pdf",
                    "application/zip",
                    "application/octet-stream",
                ]
            )
        ):
            return ExtractionResult(
                html_available=False,
                content_size_bytes=len(html_content.encode("utf-8")) if (html_content and isinstance(html_content, str)) else 0,
                clean_text_available=False,
                word_count=0,
                paragraph_count=0,
                main_content_candidate=None,
                main_content_confidence=None,
                detected_language=None,
                html_lang=None,
                extraction_status="skipped_non_html",
                title_present=False,
                title_empty=True,
                missing_h1=True,
            )

    parser = PageHTMLParser(page_url=page_url)
    try:
        parser.feed(html_content)
        parser.close()
    except Exception as exc:
        return ExtractionResult(
            html_available=True,
            content_size_bytes=len(html_content.encode("utf-8")) if (html_content and isinstance(html_content, str)) else 0,
            clean_text_available=False,
            word_count=0,
            paragraph_count=0,
            main_content_candidate=None,
            main_content_confidence=None,
            detected_language=None,
            html_lang=None,
            extraction_status="error",
            extraction_error=str(exc),
            title_present=False,
            title_empty=True,
            missing_h1=True,
        )

    result = ExtractionResult()
    result.html_available = True
    result.content_size_bytes = len(html_content.encode("utf-8")) if (html_content and isinstance(html_content, str)) else 0
    result.html_lang = parser.html_lang
    result.detected_language = parser.html_lang

    # Clean visible text
    raw_visible_text = " ".join(parser.visible_text_fragments)
    clean_text = re.sub(r"\s+", " ", raw_visible_text).strip()
    result.clean_text = clean_text
    words = [w for w in clean_text.split(" ") if w]
    result.word_count = len(words)
    result.clean_text_available = result.word_count > 0
    result.paragraph_count = len(parser.paragraphs)

    # Main-content candidate selection hierarchy:
    # 1. <main> element (confidence = 1.0)
    # 2. <article> element (confidence = 0.9)
    # 3. role="main" element (confidence = 0.85)
    # 4. Fallback clean visible body text (confidence = 0.5)
    main_text = re.sub(r"\s+", " ", "".join(parser.main_tag_fragments)).strip()
    article_text = re.sub(r"\s+", " ", "".join(parser.article_tag_fragments)).strip()
    role_main_text = re.sub(r"\s+", " ", "".join(parser.role_main_fragments)).strip()

    if main_text:
        result.main_content_candidate = main_text
        result.main_content_confidence = 1.0
    elif article_text:
        result.main_content_candidate = article_text
        result.main_content_confidence = 0.9
    elif role_main_text:
        result.main_content_candidate = role_main_text
        result.main_content_confidence = 0.85
    elif clean_text:
        result.main_content_candidate = clean_text
        result.main_content_confidence = 0.5
    else:
        result.main_content_candidate = None
        result.main_content_confidence = None

    # 1. Title Extraction
    result.title_count = len(parser.titles)
    result.title_present = result.title_count > 0
    if result.title_present:
        first_title = html.unescape(parser.titles[0]).strip()
        result.title_text = first_title
        result.title_length = len(first_title)
        t_words = [w for w in first_title.split() if w]
        result.title_word_count = len(t_words)
        result.title_empty = result.title_length == 0
        result.title_duplicate = result.title_count > 1
        result.title_too_short = 0 < result.title_length < TITLE_TOO_SHORT_THRESHOLD
        result.title_too_long = result.title_length > TITLE_TOO_LONG_THRESHOLD
    else:
        result.title_text = None
        result.title_length = 0
        result.title_word_count = 0
        result.title_empty = True
        result.title_duplicate = False
        result.title_too_short = False
        result.title_too_long = False

    # 2. Meta Descriptions
    result.meta_description_count = len(parser.raw_meta_descriptions)
    result.meta_description_present = result.meta_description_count > 0

    desc_items: list[MetaDescriptionItem] = []
    seen_texts: dict[str, int] = {}

    for idx, raw_desc in enumerate(parser.raw_meta_descriptions):
        if raw_desc is not None:
            unescaped = html.unescape(raw_desc).strip()
            length = len(unescaped)
            d_words = [w for w in unescaped.split() if w]
            word_count = len(d_words)
            empty = length == 0
            text_val: str | None = unescaped
            norm_key = unescaped.lower()
            seen_texts[norm_key] = seen_texts.get(norm_key, 0) + 1
        else:
            length = 0
            word_count = 0
            empty = True
            text_val = None

        too_short = 0 < length < META_DESC_TOO_SHORT_THRESHOLD
        too_long = length > META_DESC_TOO_LONG_THRESHOLD

        desc_items.append(
            MetaDescriptionItem(
                text=text_val,
                position=idx,
                length=length,
                word_count=word_count,
                empty=empty,
                duplicate_within_page=False,
                duplicate_in_scan=False,
                too_short=too_short,
                too_long=too_long,
            )
        )

    for item in desc_items:
        if item.text:
            norm_key = item.text.strip().lower()
            if seen_texts.get(norm_key, 0) > 1:
                item.duplicate_within_page = True

    result.meta_descriptions = desc_items

    # 3. Headings Extraction
    heading_items: list[HeadingItem] = []
    hierarchy_issues: list[dict] = []
    prev_level: int | None = None

    for idx, (level, raw_text) in enumerate(parser.raw_headings):
        text_unescaped = html.unescape(raw_text).strip()
        empty = len(text_unescaped) == 0

        if idx == 0 and level != 1:
            hierarchy_issues.append({
                "position": idx,
                "level": level,
                "issue": f"Document starts with H{level} instead of H1",
            })
        elif prev_level is not None and level > prev_level + 1:
            hierarchy_issues.append({
                "position": idx,
                "level": level,
                "previous_level": prev_level,
                "issue": f"Skipped heading level from H{prev_level} to H{level}",
            })

        prev_level = level

        heading_items.append(
            HeadingItem(
                level=level,
                text=text_unescaped,
                position=idx,
                empty=empty,
            )
        )

    result.headings = heading_items
    result.h1_count = sum(1 for h in heading_items if h.level == 1)
    result.missing_h1 = result.h1_count == 0
    result.multiple_h1 = result.h1_count > 1

    if result.missing_h1:
        if not any(iss.get("issue", "").startswith("Document starts") for iss in hierarchy_issues):
            hierarchy_issues.append({
                "issue": "Document is missing an H1 heading",
            })

    result.heading_hierarchy_issue = len(hierarchy_issues) > 0
    result.heading_hierarchy_details = hierarchy_issues if hierarchy_issues else None

    # 4. Canonical Extraction
    canonical_items: list[CanonicalItem] = []
    normalized_page_url = _normalize_url(page_url)
    unique_canonical_targets: set[str] = set()

    for idx, raw_href in enumerate(parser.raw_canonicals):
        if raw_href is not None:
            href_clean = html.unescape(raw_href).strip()
            empty = len(href_clean) == 0
            if empty:
                target_url = None
                valid = False
                self_ref = False
                cross_pg = False
            else:
                if page_url and not _is_valid_url(href_clean):
                    try:
                        resolved_url = urljoin(page_url, href_clean)
                    except Exception:
                        resolved_url = href_clean
                else:
                    resolved_url = href_clean

                target_url = resolved_url
                valid = _is_valid_url(resolved_url)
                norm_target = _normalize_url(resolved_url)

                if valid and norm_target:
                    unique_canonical_targets.add(norm_target)
                    if normalized_page_url:
                        self_ref = norm_target == normalized_page_url
                        cross_pg = norm_target != normalized_page_url
                    else:
                        self_ref = False
                        cross_pg = False
                else:
                    self_ref = False
                    cross_pg = False
        else:
            target_url = None
            empty = True
            valid = False
            self_ref = False
            cross_pg = False

        canonical_items.append(
            CanonicalItem(
                url=target_url,
                position=idx,
                empty=empty,
                valid=valid,
                self_reference=self_ref,
                cross_page=cross_pg,
            )
        )

    result.canonicals = canonical_items
    result.canonical_count = len(canonical_items)
    result.canonical_present = result.canonical_count > 0
    result.canonical_multiple = result.canonical_count > 1
    result.canonical_conflict = len(unique_canonical_targets) > 1

    # 5. Robots Extraction
    result.robots = _parse_robots(parser.raw_robots)

    # 6. Social Metadata (Open Graph & Twitter / X)
    social_items: list[SocialMetadataItem] = []
    seen_social_props: dict[tuple[str, str], int] = {}

    for idx, (platform, prop_name, raw_content) in enumerate(parser.raw_social_meta):
        if raw_content is not None:
            unescaped_content = html.unescape(raw_content).strip()
            empty = len(unescaped_content) == 0
            content_val: str | None = unescaped_content
        else:
            empty = True
            content_val = None

        key = (platform, prop_name)
        seen_count = seen_social_props.get(key, 0)
        duplicate = seen_count > 0
        seen_social_props[key] = seen_count + 1

        social_items.append(
            SocialMetadataItem(
                platform=platform,
                property_name=prop_name,
                content=content_val,
                position=idx,
                empty=empty,
                duplicate=duplicate,
            )
        )

    for item in social_items:
        key = (item.platform, item.property_name)
        if seen_social_props.get(key, 0) > 1:
            item.duplicate = True

    result.social_metadata = social_items

    # 7. JSON-LD / Structured Data Extraction
    sd_items: list[StructuredDataItem] = []
    all_json_ld_breadcrumbs: list[BreadcrumbItem] = []

    for idx, raw_block in enumerate(parser.raw_json_ld_blocks):
        if not raw_block or not raw_block.strip():
            sd_items.append(
                StructuredDataItem(
                    block_position=idx,
                    raw_block=raw_block,
                    parsed_json=None,
                    context=None,
                    types=None,
                    entity_names=None,
                    entity_urls=None,
                    parse_error="Empty JSON-LD block",
                )
            )
            continue

        try:
            parsed = json.loads(raw_block.strip())
            types_list: list[str] = []
            names_list: list[str] = []
            urls_list: list[str] = []
            contexts_list: list[str] = []

            _traverse_json_ld(parsed, types_list, names_list, urls_list, contexts_list)

            # Unique ordered elements
            unique_types = list(dict.fromkeys(types_list))
            unique_names = list(dict.fromkeys(names_list))
            unique_urls = list(dict.fromkeys(urls_list))
            context_str = contexts_list[0] if contexts_list else None

            sd_items.append(
                StructuredDataItem(
                    block_position=idx,
                    raw_block=raw_block,
                    parsed_json=parsed,
                    context=context_str,
                    types=unique_types if unique_types else None,
                    entity_names=unique_names if unique_names else None,
                    entity_urls=unique_urls if unique_urls else None,
                    parse_error=None,
                )
            )

            # Extract schema.org breadcrumbs if present
            bc_extracted = _extract_json_ld_breadcrumbs(parsed, page_url)
            all_json_ld_breadcrumbs.extend(bc_extracted)

        except Exception as exc:
            sd_items.append(
                StructuredDataItem(
                    block_position=idx,
                    raw_block=raw_block,
                    parsed_json=None,
                    context=None,
                    types=None,
                    entity_names=None,
                    entity_urls=None,
                    parse_error=str(exc),
                )
            )

    result.structured_data = sd_items

    # 8. Microdata Extraction
    micro_items: list[MicrodataItem] = []
    for idx, raw_item in enumerate(parser.raw_microdata_items):
        micro_items.append(
            MicrodataItem(
                item_position=idx,
                item_type=raw_item.get("item_type"),
                item_id=raw_item.get("item_id"),
                properties=raw_item.get("properties") if raw_item.get("properties") else None,
                raw_snippet=raw_item.get("raw_snippet"),
            )
        )
    result.microdata = micro_items

    # 9. Breadcrumbs Extraction (Schema.org preferred; semantic HTML as fallback/addition)
    if all_json_ld_breadcrumbs:
        result.breadcrumbs = all_json_ld_breadcrumbs
    elif parser.raw_semantic_breadcrumbs:
        semantic_bc: list[BreadcrumbItem] = []
        for idx, (b_name, b_href) in enumerate(parser.raw_semantic_breadcrumbs):
            resolved_bc_url = urljoin(page_url, b_href.strip()) if (b_href and page_url) else b_href
            semantic_bc.append(
                BreadcrumbItem(
                    position=idx + 1,
                    detection_method="semantic_html",
                    name=b_name,
                    url=resolved_bc_url,
                )
            )
        result.breadcrumbs = semantic_bc
    else:
        result.breadcrumbs = []

    # 10. Images Extraction
    image_items: list[ImageItem] = []
    for idx, raw_img in enumerate(parser.raw_images):
        src_raw = raw_img.get("src")
        resolved_img_url = urljoin(page_url, src_raw.strip()) if (src_raw and src_raw.strip() and page_url) else (src_raw.strip() if src_raw else None)
        file_type = _derive_file_type(resolved_img_url)

        image_items.append(
            ImageItem(
                position=idx,
                url=resolved_img_url,
                alt=raw_img.get("alt"),
                alt_missing=raw_img.get("alt_missing", False),
                alt_empty=raw_img.get("alt_empty", False),
                width=raw_img.get("width"),
                height=raw_img.get("height"),
                file_type=file_type,
                loading=raw_img.get("loading"),
                lazy_loaded=raw_img.get("lazy_loaded", False),
            )
        )

    result.images = image_items
    result.image_count = len(image_items)
    result.images_without_alt = sum(1 for img in image_items if img.alt_missing)

    # 11. Links Extraction
    link_items: list[LinkItem] = []
    page_netloc = urlparse(page_url).netloc.lower() if page_url else ""

    for idx, raw_link in enumerate(parser.raw_links):
        raw_href = raw_link.get("href")
        rel_raw = raw_link.get("rel")
        anchor_text = raw_link.get("text")

        if raw_href is not None and raw_href.strip():
            clean_href = raw_href.strip()
            resolved_dest = urljoin(page_url, clean_href) if page_url else clean_href
        else:
            resolved_dest = None

        rel_tokens = set(rel_raw.lower().split()) if rel_raw else set()
        nofollow = "nofollow" in rel_tokens
        sponsored = "sponsored" in rel_tokens
        ugc = "ugc" in rel_tokens

        # Classify link type
        if resolved_dest:
            parsed_dest = urlparse(resolved_dest)
            if parsed_dest.scheme in {"http", "https"}:
                dest_netloc = parsed_dest.netloc.lower()
                link_type = "internal" if (not page_netloc or dest_netloc == page_netloc) else "external"
            elif parsed_dest.scheme in {"mailto", "tel", "javascript"}:
                link_type = "internal"
            else:
                link_type = "internal"
        else:
            link_type = "internal"

        link_items.append(
            LinkItem(
                position=idx,
                source_url=page_url,
                destination_url=resolved_dest,
                anchor_text=anchor_text if anchor_text else None,
                rel_raw=rel_raw,
                nofollow=nofollow,
                sponsored=sponsored,
                ugc=ugc,
                link_type=link_type,
            )
        )

    result.links = link_items

    # 12. Hreflang Extraction
    hreflang_items: list[HreflangItem] = []
    seen_hreflangs: dict[str, list[str | None]] = {}

    for idx, (lang_reg, href_val) in enumerate(parser.raw_hreflang):
        resolved_target = urljoin(page_url, href_val.strip()) if (href_val and href_val.strip() and page_url) else (href_val.strip() if href_val else None)
        norm_lang = lang_reg.strip().lower()

        if norm_lang not in seen_hreflangs:
            seen_hreflangs[norm_lang] = [resolved_target]
        else:
            seen_hreflangs[norm_lang].append(resolved_target)

        hreflang_items.append(
            HreflangItem(
                position=idx,
                language_region=lang_reg,
                target_url=resolved_target,
                duplicate_declaration=False,
                conflicting_declaration=False,
            )
        )

    # Evaluate duplicates and conflicts
    for item in hreflang_items:
        norm_lang = item.language_region.strip().lower()
        targets = seen_hreflangs.get(norm_lang, [])
        if len(targets) > 1:
            if targets.count(item.target_url) > 1:
                item.duplicate_declaration = True
            unique_non_empty = {t for t in targets if t}
            if len(unique_non_empty) > 1:
                item.conflicting_declaration = True

    result.hreflang = hreflang_items

    return result


def extract_page(
    db: Session,
    page_result: PageResult,
) -> PageExtraction:
    """
    Extract structured page intelligence from a PageResult and persist it.
    """
    effective_url = page_result.final_url or page_result.url

    # Check for crawl-level error
    if page_result.error:
        extracted_data = ExtractionResult(
            html_available=False,
            clean_text_available=False,
            word_count=0,
            detected_language=None,
            html_lang=None,
            extraction_status="failed_crawl",
            extraction_error=page_result.error,
            title_present=False,
            title_empty=True,
            missing_h1=True,
        )
    else:
        extracted_data = extract_html(
            page_result.content,
            page_result.content_type,
            effective_url,
        )

    extraction = page_result.extraction
    if extraction is None:
        extraction = PageExtraction(
            page_result_id=page_result.id,
            scan_id=page_result.scan_id,
        )
        db.add(extraction)

    # Populate scalar PageExtraction fields
    extraction.html_available = extracted_data.html_available
    extraction.content_size_bytes = extracted_data.content_size_bytes
    extraction.clean_text_available = extracted_data.clean_text_available
    extraction.word_count = extracted_data.word_count
    extraction.paragraph_count = extracted_data.paragraph_count
    extraction.main_content_candidate = extracted_data.main_content_candidate
    extraction.main_content_confidence = extracted_data.main_content_confidence
    extraction.detected_language = extracted_data.detected_language
    extraction.extraction_status = extracted_data.extraction_status
    extraction.extraction_error = extracted_data.extraction_error
    extraction.extracted_at = datetime.utcnow()

    extraction.title_present = extracted_data.title_present
    extraction.title_text = extracted_data.title_text
    extraction.title_length = extracted_data.title_length
    extraction.title_word_count = extracted_data.title_word_count
    extraction.title_empty = extracted_data.title_empty
    extraction.title_duplicate = extracted_data.title_duplicate
    extraction.title_too_short = extracted_data.title_too_short
    extraction.title_too_long = extracted_data.title_too_long
    extraction.title_count = extracted_data.title_count

    extraction.meta_description_present = extracted_data.meta_description_present
    extraction.meta_description_count = extracted_data.meta_description_count

    extraction.h1_count = extracted_data.h1_count
    extraction.missing_h1 = extracted_data.missing_h1
    extraction.multiple_h1 = extracted_data.multiple_h1
    extraction.heading_hierarchy_issue = extracted_data.heading_hierarchy_issue
    extraction.heading_hierarchy_details = extracted_data.heading_hierarchy_details

    extraction.canonical_present = extracted_data.canonical_present
    extraction.canonical_count = extracted_data.canonical_count
    extraction.canonical_multiple = extracted_data.canonical_multiple
    extraction.canonical_conflict = extracted_data.canonical_conflict

    extraction.image_count = extracted_data.image_count
    extraction.images_without_alt = extracted_data.images_without_alt

    db.flush()

    # Clear existing child records
    for d in list(extraction.meta_descriptions):
        db.delete(d)
    for h in list(extraction.headings):
        db.delete(h)
    for c in list(extraction.canonicals):
        db.delete(c)
    if extraction.robots:
        db.delete(extraction.robots)
    for s in list(extraction.social_metadata):
        db.delete(s)
    for sd in list(extraction.structured_data):
        db.delete(sd)
    for m in list(extraction.microdata):
        db.delete(m)
    for b in list(extraction.breadcrumbs):
        db.delete(b)
    for img in list(extraction.images):
        db.delete(img)
    for lk in list(extraction.links):
        db.delete(lk)
    if extraction.language:
        db.delete(extraction.language)
    for hr in list(extraction.hreflang):
        db.delete(hr)
    if extraction.indexability_evidence:
        db.delete(extraction.indexability_evidence)

    db.flush()

    # 1. Meta descriptions
    for item in extracted_data.meta_descriptions:
        db.add(
            PageMetaDescription(
                page_extraction_id=extraction.id,
                position=item.position,
                text=item.text,
                length=item.length,
                word_count=item.word_count,
                empty=item.empty,
                duplicate_within_page=item.duplicate_within_page,
                duplicate_in_scan=item.duplicate_in_scan,
                too_short=item.too_short,
                too_long=item.too_long,
            )
        )

    # 2. Headings
    for item in extracted_data.headings:
        db.add(
            PageHeading(
                page_extraction_id=extraction.id,
                level=item.level,
                text=item.text,
                position=item.position,
                empty=item.empty,
            )
        )

    # 3. Canonicals
    for item in extracted_data.canonicals:
        db.add(
            PageCanonical(
                page_extraction_id=extraction.id,
                position=item.position,
                url=item.url,
                empty=item.empty,
                valid=item.valid,
                self_reference=item.self_reference,
                cross_page=item.cross_page,
            )
        )

    # 4. Robots
    if extracted_data.robots:
        db.add(
            PageRobots(
                page_extraction_id=extraction.id,
                raw_content=extracted_data.robots.raw_content,
                index=extracted_data.robots.index,
                follow=extracted_data.robots.follow,
                noindex=extracted_data.robots.noindex,
                nofollow=extracted_data.robots.nofollow,
                noarchive=extracted_data.robots.noarchive,
                nosnippet=extracted_data.robots.nosnippet,
                other_directives=extracted_data.robots.other_directives,
            )
        )

    # 5. Social metadata
    for item in extracted_data.social_metadata:
        db.add(
            PageSocialMetadata(
                page_extraction_id=extraction.id,
                platform=item.platform,
                property_name=item.property_name,
                content=item.content,
                position=item.position,
                empty=item.empty,
                duplicate=item.duplicate,
            )
        )

    # 6. Structured data (JSON-LD)
    for item in extracted_data.structured_data:
        db.add(
            PageStructuredData(
                page_extraction_id=extraction.id,
                block_position=item.block_position,
                raw_block=item.raw_block,
                parsed_json=item.parsed_json,
                context=item.context,
                types=item.types,
                entity_names=item.entity_names,
                entity_urls=item.entity_urls,
                parse_error=item.parse_error,
            )
        )

    # 7. Microdata
    for item in extracted_data.microdata:
        db.add(
            PageMicrodata(
                page_extraction_id=extraction.id,
                item_position=item.item_position,
                item_type=item.item_type,
                item_id=item.item_id,
                properties=item.properties,
                raw_snippet=item.raw_snippet,
            )
        )

    # 8. Breadcrumbs
    for item in extracted_data.breadcrumbs:
        db.add(
            PageBreadcrumb(
                page_extraction_id=extraction.id,
                position=item.position,
                detection_method=item.detection_method,
                name=item.name,
                url=item.url,
            )
        )

    # 9. Images
    for item in extracted_data.images:
        db.add(
            PageImage(
                page_extraction_id=extraction.id,
                position=item.position,
                url=item.url,
                alt=item.alt,
                alt_missing=item.alt_missing,
                alt_empty=item.alt_empty,
                width=item.width,
                height=item.height,
                file_type=item.file_type,
                loading=item.loading,
                lazy_loaded=item.lazy_loaded,
            )
        )

    # 10. Links
    for item in extracted_data.links:
        db.add(
            PageLink(
                page_extraction_id=extraction.id,
                position=item.position,
                source_url=item.source_url,
                destination_url=item.destination_url,
                anchor_text=item.anchor_text,
                rel_raw=item.rel_raw,
                nofollow=item.nofollow,
                sponsored=item.sponsored,
                ugc=item.ugc,
                link_type=item.link_type,
            )
        )

    # 11. Language
    if extracted_data.html_lang or extracted_data.detected_language:
        db.add(
            PageLanguage(
                page_extraction_id=extraction.id,
                html_lang=extracted_data.html_lang,
                detected_language=extracted_data.detected_language,
            )
        )

    # 12. Hreflang
    for item in extracted_data.hreflang:
        db.add(
            PageHreflang(
                page_extraction_id=extraction.id,
                position=item.position,
                language_region=item.language_region,
                target_url=item.target_url,
                duplicate_declaration=item.duplicate_declaration,
                conflicting_declaration=item.conflicting_declaration,
            )
        )

    # 13. Indexability Evidence
    page_noindex = extracted_data.robots.noindex if extracted_data.robots else False
    page_nofollow = extracted_data.robots.nofollow if extracted_data.robots else False

    canonical_url = None
    canonical_item = None
    if extracted_data.canonicals:
        for c in extracted_data.canonicals:
            if c.valid and c.url:
                canonical_url = c.url
                canonical_item = c
                break
        if not canonical_url and extracted_data.canonicals[0].url:
            canonical_url = extracted_data.canonicals[0].url
            canonical_item = extracted_data.canonicals[0]

    redirected = False
    if page_result.final_url and page_result.url:
        norm_final = _normalize_url(page_result.final_url)
        norm_orig = _normalize_url(page_result.url)
        if norm_final and norm_orig and norm_final != norm_orig:
            redirected = True

    robots_txt_allowed = page_result.robots_txt_allowed if page_result.robots_txt_allowed is not None else True

    evidence_summary = {
        "http_status": page_result.status_code,
        "robots_txt_allowed": robots_txt_allowed,
        "has_content": bool(page_result.content and page_result.content.strip()),
        "content_type": page_result.content_type,
        "redirected": redirected,
        "final_url": page_result.final_url,
        "robots_noindex": page_noindex,
        "robots_nofollow": page_nofollow,
        "canonical_url": canonical_url,
        "canonical_self_reference": canonical_item.self_reference if canonical_item else None,
        "canonical_conflict": extracted_data.canonical_conflict,
        "title_present": extracted_data.title_present,
        "meta_description_present": extracted_data.meta_description_present,
        "h1_count": extracted_data.h1_count,
    }

    db.add(
        PageIndexabilityEvidence(
            page_extraction_id=extraction.id,
            http_status=page_result.status_code,
            robots_txt_allowed=robots_txt_allowed,
            page_noindex=page_noindex,
            page_nofollow=page_nofollow,
            canonical_url=canonical_url,
            redirected=redirected,
            final_url=page_result.final_url,
            content_type=page_result.content_type,
            evidence_summary=evidence_summary,
        )
    )

    db.commit()
    db.refresh(extraction)

    return extraction


def extract_scan_pages(
    db: Session,
    scan_id: int,
) -> list[PageExtraction]:
    """
    Run page extraction on all crawled PageResults belonging to a scan,
    and calculate scan-level cross-page duplicates with strict scan isolation.
    """
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError("Scan not found")

    page_results = (
        db.query(PageResult)
        .filter(PageResult.scan_id == scan_id)
        .order_by(PageResult.id)
        .all()
    )

    extractions: list[PageExtraction] = []
    for page_result in page_results:
        try:
            extraction = extract_page(db, page_result)
            extractions.append(extraction)
        except Exception as exc:
            # Error isolation: ensure failed page extraction doesn't halt remaining pages
            ext = page_result.extraction
            if ext is None:
                ext = PageExtraction(
                    page_result_id=page_result.id,
                    scan_id=page_result.scan_id,
                )
                db.add(ext)
            ext.extraction_status = "error"
            ext.extraction_error = str(exc)
            ext.extracted_at = datetime.utcnow()
            db.commit()
            db.refresh(ext)
            extractions.append(ext)

    # Scan-level duplicate title analysis (strictly within scan_id)
    title_counts: dict[str, int] = {}
    for ext in extractions:
        if ext.title_text and ext.title_text.strip():
            norm_title = ext.title_text.strip().lower()
            title_counts[norm_title] = title_counts.get(norm_title, 0) + 1

    for ext in extractions:
        if ext.title_text and ext.title_text.strip():
            norm_title = ext.title_text.strip().lower()
            if title_counts.get(norm_title, 0) > 1 or ext.title_count > 1:
                ext.title_duplicate = True

    # Scan-level duplicate meta description analysis (strictly within scan_id)
    desc_scan_counts: dict[str, int] = {}
    for ext in extractions:
        for desc in ext.meta_descriptions:
            if desc.text and desc.text.strip():
                norm_desc = desc.text.strip().lower()
                desc_scan_counts[norm_desc] = desc_scan_counts.get(norm_desc, 0) + 1

    for ext in extractions:
        for desc in ext.meta_descriptions:
            if desc.text and desc.text.strip():
                norm_desc = desc.text.strip().lower()
                if desc_scan_counts.get(norm_desc, 0) > 1:
                    desc.duplicate_in_scan = True

    db.commit()
    for ext in extractions:
        db.refresh(ext)

    return extractions
