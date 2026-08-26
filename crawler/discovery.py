from urllib.parse import urljoin, urlparse, urlunparse


def normalize_url(url: str, base_url: str | None = None) -> str:
    """
    Convert a URL into a consistent representation for crawling.
    """

    if base_url:
        url = urljoin(base_url, url)

    parsed = urlparse(url)

    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only HTTP and HTTPS URLs are supported")

    if not parsed.netloc:
        raise ValueError("URL must contain a valid domain")

    normalized_path = parsed.path or "/"

    if normalized_path != "/" and normalized_path.endswith("/"):
        normalized_path = normalized_path.rstrip("/")

    normalized = urlunparse(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            normalized_path,
            "",
            parsed.query,
            "",
        )
    )

    return normalized


def is_internal_url(url: str, allowed_domains: list[str]) -> bool:
    """
    Determine whether a URL belongs to one of the allowed domains.
    """

    hostname = urlparse(url).hostname

    if not hostname:
        return False

    hostname = hostname.lower()

    return any(
        hostname == domain.lower()
        or hostname.endswith("." + domain.lower())
        for domain in allowed_domains
    )


def classify_url(
    url: str,
    allowed_domains: list[str],
) -> str:
    """
    Classify a URL as internal or external.
    """

    if is_internal_url(url, allowed_domains):
        return "internal"

    return "external"

from html.parser import HTMLParser
class LinkExtractor(HTMLParser):
    """
    Extract href values from HTML anchor tags.
    """

    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        if tag.lower() != "a":
            return

        for name, value in attrs:
            if name.lower() == "href" and value:
                self.links.append(value)


def extract_links(html: str) -> list[str]:
    """
    **Extract raw href values from HTML content.**
    """

    parser = LinkExtractor()
    parser.feed(html)
    parser.close()

    return parser.links

def discover_links(
    html: str,
    base_url: str,
    allowed_domains: list[str],
) -> list[str]:
    """
    Extract, normalize, classify, and deduplicate internal links.

    External links are ignored for crawling.
    """

    raw_links = extract_links(html)

    discovered: set[str] = set()

    for raw_link in raw_links:
        try:
            normalized = normalize_url(
                raw_link,
                base_url,
            )
        except ValueError:
            continue

        if not is_internal_url(
            normalized,
            allowed_domains,
        ):
            continue

        discovered.add(normalized)
    return sorted(discovered)