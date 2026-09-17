import pytest

from crawler.queue import CrawlQueue, URLState


def test_add_url_starts_as_discovered():
    queue = CrawlQueue()

    item = queue.add(
        "https://example.com/",
        0,
    )

    assert item.url == "https://example.com/"
    assert item.depth == 0
    assert item.state == URLState.DISCOVERED
    assert item.parent_url is None
    assert item.error is None


def test_duplicate_url_is_not_added_twice():
    queue = CrawlQueue()

    first = queue.add(
        "https://example.com/about",
        1,
    )

    second = queue.add(
        "https://example.com/about",
        1,
    )

    assert first is second
    assert len(queue) == 1


def test_url_state_can_be_updated():
    queue = CrawlQueue()

    queue.add(
        "https://example.com/",
        0,
    )

    queue.set_state(
        "https://example.com/",
        URLState.QUEUED,
    )

    item = queue.get(
        "https://example.com/",
    )

    assert item is not None
    assert item.state == URLState.QUEUED


def test_failed_url_stores_error():
    queue = CrawlQueue()

    queue.add(
        "https://example.com/",
        0,
    )

    queue.set_state(
        "https://example.com/",
        URLState.FAILED,
        error="Connection timeout",
    )

    item = queue.get(
        "https://example.com/",
    )

    assert item is not None
    assert item.state == URLState.FAILED
    assert item.error == "Connection timeout"


def test_pending_returns_discovered_and_queued_urls():
    queue = CrawlQueue()

    queue.add(
        "https://example.com/",
        0,
    )

    queue.add(
        "https://example.com/about",
        1,
    )

    queue.set_state(
        "https://example.com/about",
        URLState.QUEUED,
    )

    queue.add(
        "https://example.com/services",
        1,
    )

    queue.set_state(
        "https://example.com/services",
        URLState.COMPLETED,
    )

    pending = queue.pending()

    assert len(pending) == 2
    assert {
        item.url
        for item in pending
    } == {
        "https://example.com/",
        "https://example.com/about",
    }


def test_get_unknown_url_returns_none():
    queue = CrawlQueue()

    assert queue.get(
        "https://example.com/unknown"
    ) is None


def test_updating_unknown_url_raises_error():
    queue = CrawlQueue()

    with pytest.raises(
        KeyError,
        match="URL is not in the queue",
    ):
        queue.set_state(
            "https://example.com/unknown",
            URLState.COMPLETED,
        )
def test_max_pages_limit():
    from crawler.config import CrawlerConfig

    queue = CrawlQueue(
        CrawlerConfig(max_pages=2)
    )

    assert queue.add(
        "https://example.com/",
        0,
    ) is not None

    assert queue.add(
        "https://example.com/about",
        1,
    ) is not None

    assert queue.add(
        "https://example.com/services",
        1,
    ) is None

    assert len(queue) == 2


def test_max_depth_limit():
    from crawler.config import CrawlerConfig

    queue = CrawlQueue(
        CrawlerConfig(max_depth=2)
    )

    assert queue.add(
        "https://example.com/",
        0,
    ) is not None

    assert queue.add(
        "https://example.com/a",
        1,
    ) is not None

    assert queue.add(
        "https://example.com/b",
        2,
    ) is not None

    assert queue.add(
        "https://example.com/c",
        3,
    ) is None


def test_depth_equal_to_max_depth_is_allowed():
    from crawler.config import CrawlerConfig

    queue = CrawlQueue(
        CrawlerConfig(max_depth=3)
    )

    item = queue.add(
        "https://example.com/depth-3",
        3,
    )

    assert item is not None
    assert item.depth == 3


def test_depth_above_max_depth_is_rejected():
    from crawler.config import CrawlerConfig

    queue = CrawlQueue(
        CrawlerConfig(max_depth=3)
    )

    item = queue.add(
        "https://example.com/depth-4",
        4,
    )

    assert item is None
class FakeRobotsChecker:
    def can_fetch(
        self,
        url: str,
        user_agent: str = "*",
    ) -> bool:
        return False


def test_robots_blocked_url_is_skipped():
    from crawler.config import CrawlerConfig

    queue = CrawlQueue(
        CrawlerConfig(max_pages=10)
    )

    checker = FakeRobotsChecker()

    item = queue.add_with_robots(
        "https://example.com/private",
        1,
        checker,
    )

    assert item is not None
    assert item.state == URLState.SKIPPED
    assert item.error == "Blocked by robots.txt"