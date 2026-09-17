from crawler.config import CrawlerConfig
from crawler.crawler import Crawler, CrawlResult


def run_website_crawl(
    url: str,
    max_pages: int = 50,
    max_depth: int = 3,
) -> CrawlResult:
    config = CrawlerConfig(
        max_pages=max_pages,
        max_depth=max_depth,
        allowed_domains=[],
        respect_robots_txt=True,
    )

    crawler = Crawler(config)

    return crawler.crawl(url)