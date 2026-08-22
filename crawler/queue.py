from dataclasses import dataclass
from enum import Enum

from crawler.config import CrawlerConfig
from crawler.robots import RobotsChecker


class URLState(str, Enum):
    DISCOVERED = "discovered"
    QUEUED = "queued"
    CRAWLING = "crawling"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class CrawlURL:
    url: str
    depth: int
    parent_url: str | None = None
    state: URLState = URLState.DISCOVERED
    error: str | None = None


class CrawlQueue:
    def __init__(
        self,
        config: CrawlerConfig | None = None,
    ) -> None:
        self.config = config or CrawlerConfig()
        self._items: dict[str, CrawlURL] = {}

    def add(
        self,
        url: str,
        depth: int,
        parent_url: str | None = None,
    ) -> CrawlURL | None:
        """
        Add a URL only when it satisfies crawler limits.
        """

        if url in self._items:
            return self._items[url]

        if len(self._items) >= self.config.max_pages:
            return None

        if depth > self.config.max_depth:
            return None

        item = CrawlURL(
            url=url,
            depth=depth,
            parent_url=parent_url,
        )

        self._items[url] = item

        return item

    def add_with_robots(
        self,
        url: str,
        depth: int,
        robots_checker: RobotsChecker,
        parent_url: str | None = None,
        user_agent: str = "*",
    ) -> CrawlURL | None:
        """
        Add a URL while respecting robots.txt.

        Allowed URLs become QUEUED.
        Disallowed URLs become SKIPPED.
        """

        existing = self.get(url)

        if existing is not None:
            return existing

        if len(self._items) >= self.config.max_pages:
            return None

        if depth > self.config.max_depth:
            return None

        item = self.add(
            url=url,
            depth=depth,
            parent_url=parent_url,
        )

        if item is None:
            return None

        if robots_checker.can_fetch(
            url,
            user_agent,
        ):
            item.state = URLState.QUEUED
        else:
            item.state = URLState.SKIPPED
            item.error = "Blocked by robots.txt"

        return item

    def get(
        self,
        url: str,
    ) -> CrawlURL | None:
        return self._items.get(url)

    def set_state(
        self,
        url: str,
        state: URLState,
        error: str | None = None,
    ) -> CrawlURL:
        """
        Update the state of an existing URL.
        """

        item = self._items.get(url)

        if item is None:
            raise KeyError(
                f"URL is not in the queue: {url}"
            )

        item.state = state
        item.error = error

        return item

    def all(self) -> list[CrawlURL]:
        return list(self._items.values())

    def pending(self) -> list[CrawlURL]:
        return [
            item
            for item in self._items.values()
            if item.state in {
                URLState.DISCOVERED,
                URLState.QUEUED,
            }
        ]

    def __len__(self) -> int:
        return len(self._items)

