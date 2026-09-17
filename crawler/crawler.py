import time
from dataclasses import dataclass, field
from typing import Callable

from crawler.config import CrawlerConfig
from crawler.discovery import (
    discover_links,
    is_internal_url,
    normalize_url,
)
from crawler.fetcher import PageFetcher, is_html_content_type
from crawler.models import CrawledPage
from crawler.queue import CrawlQueue, CrawlURL, URLState
from crawler.robots import RobotsChecker
from crawler.sitemap import parse_sitemap_xml


@dataclass
class CrawlResult:
    start_url: str
    pages_crawled: int = 0
    pages_skipped: int = 0
    pages_failed: int = 0
    pages: list[CrawledPage] = field(default_factory=list)
    urls: list[CrawlURL] = field(default_factory=list)


class Crawler:
    def __init__(
        self,
        config: CrawlerConfig | None = None,
    ) -> None:
        self.config = config or CrawlerConfig()

        self.queue = CrawlQueue(self.config)
        self.fetcher = PageFetcher(self.config)
        self.robots = RobotsChecker(
            self.config.respect_robots_txt
        )
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled
    def _discover_sitemap_urls(
        self,
        start_url: str,
    ) -> list[str]:
        """
        Discover page URLs from robots.txt declared sitemaps.

        Supports sitemap indexes recursively.
        """
        if not self.config.respect_robots_txt:
            return []

        discovered: set[str] = set()
        try:
            sitemaps = self.robots.get_sitemaps(start_url)
        except Exception:
            return []

        sitemap_queue = list(sitemaps)
        visited_sitemaps: set[str] = set()

        while sitemap_queue:
            if self._cancelled:
                break

            sitemap_url = sitemap_queue.pop(0)

            if sitemap_url in visited_sitemaps:
                continue

            visited_sitemaps.add(sitemap_url)

            response = self.fetcher.fetch(
                sitemap_url
            )

            if not response.success:
                continue

            result = parse_sitemap_xml(
                response.content
            )

            for sitemap in result.sitemaps:
                if sitemap not in visited_sitemaps:
                    sitemap_queue.append(sitemap)

            for url in result.urls:
                try:
                    normalized = normalize_url(
                        url
                    )
                except ValueError:
                    continue

                if not is_internal_url(
                    normalized,
                    self.config.allowed_domains,
                ):
                    continue

                discovered.add(normalized)

        return sorted(discovered)

    def crawl(
        self,
        start_url: str,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> CrawlResult:
        result = CrawlResult(
            start_url=start_url,
        )

        start_item = self.queue.add_with_robots(
            url=start_url,
            depth=0,
            robots_checker=self.robots,
        )

        if start_item is None:
            return result

        sitemap_urls = self._discover_sitemap_urls(
            start_url
        )

        for sitemap_url in sitemap_urls:
            self.queue.add_with_robots(
                url=sitemap_url,
                depth=1,
                robots_checker=self.robots,
                parent_url=start_url,
            )

        while True:
            if self._cancelled or (is_cancelled and is_cancelled()):
                break

            if len(result.pages) >= self.config.max_pages:
                break

            pending = self.queue.pending()

            if not pending:
                break

            item = pending[0]

            if item.depth > self.config.max_depth:
                self.queue.set_state(
                    item.url,
                    URLState.SKIPPED,
                    "Exceeds max depth",
                )
                continue

            if (result.pages_crawled + result.pages_failed) > 0 and self.config.request_delay_seconds > 0:
                time.sleep(self.config.request_delay_seconds)

            if self._cancelled or (is_cancelled and is_cancelled()):
                break

            self.queue.set_state(
                item.url,
                URLState.CRAWLING,
            )

            response = self.fetcher.fetch(
                item.url
            )

            if not response.success:
                self.queue.set_state(
                    item.url,
                    URLState.FAILED,
                    response.error,
                )

                result.pages.append(
                    CrawledPage(
                        url=item.url,
                        depth=item.depth,
                        status_code=response.status_code,
                        content_type=response.content_type,
                        content=response.content,
                        error=response.error,
                        final_url=getattr(response, "final_url", None),
                        robots_txt_allowed=True,
                    )
                )

                result.pages_failed += 1
                continue

            self.queue.set_state(
                item.url,
                URLState.COMPLETED,
            )

            result.pages_crawled += 1

            result.pages.append(
                CrawledPage(
                    url=item.url,
                    depth=item.depth,
                    status_code=response.status_code,
                    content_type=response.content_type,
                    content=response.content,
                    final_url=getattr(response, "final_url", None),
                    robots_txt_allowed=True,
                )
            )

            if not is_html_content_type(
                response.content_type
            ):
                continue

            if item.depth >= self.config.max_depth:
                continue

            links = discover_links(
                response.content,
                item.url,
                self.config.allowed_domains,
            )

            for link in links:
                self.queue.add_with_robots(
                    url=link,
                    depth=item.depth + 1,
                    robots_checker=self.robots,
                    parent_url=item.url,
                )

        result.pages_skipped = sum(
            1
            for item in self.queue.all()
            if item.state == URLState.SKIPPED
        )

        result.urls = self.queue.all()

        return result