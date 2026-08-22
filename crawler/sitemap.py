from dataclasses import dataclass
from xml.etree import ElementTree


@dataclass
class SitemapResult:
    urls: list[str]
    sitemaps: list[str]


def parse_sitemap_xml(
    content: str,
) -> SitemapResult:
    """
    Parse a sitemap XML document.

    Supports:
    - urlset
    - sitemapindex

    Returns:
    - page URLs from <url><loc>
    - child sitemap URLs from <sitemap><loc>
    """

    if not content.strip():
        return SitemapResult(
            urls=[],
            sitemaps=[],
        )

    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError:
        return SitemapResult(
            urls=[],
            sitemaps=[],
        )

    urls: list[str] = []
    sitemaps: list[str] = []

    for element in root.iter():
        tag = element.tag

        if "}" in tag:
            tag = tag.rsplit("}", 1)[-1]

        if tag != "loc":
            continue

        value = (element.text or "").strip()

        if not value:
            continue

        parent = element

        # ElementTree does not expose a direct parent,
        # so inspect the root structure instead below.
        _ = parent

    for container in root:
        container_tag = container.tag

        if "}" in container_tag:
            container_tag = container_tag.rsplit("}", 1)[-1]

        if container_tag == "url":
            for child in container:
                child_tag = child.tag

                if "}" in child_tag:
                    child_tag = child_tag.rsplit("}", 1)[-1]

                if child_tag == "loc":
                    value = (child.text or "").strip()

                    if value:
                        urls.append(value)

        elif container_tag == "sitemap":
            for child in container:
                child_tag = child.tag

                if "}" in child_tag:
                    child_tag = child_tag.rsplit("}", 1)[-1]

                if child_tag == "loc":
                    value = (child.text or "").strip()

                    if value:
                        sitemaps.append(value)

    return SitemapResult(
        urls=urls,
        sitemaps=sitemaps,
    )