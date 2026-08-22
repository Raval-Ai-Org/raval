from dataclasses import dataclass

import requests

from crawler.config import CrawlerConfig


@dataclass
class FetchResult:
    url: str
    status_code: int | None
    content: str
    content_type: str
    error: str | None = None
    final_url: str | None = None

    @property
    def success(self) -> bool:
        return self.error is None and self.status_code is not None


class PageFetcher:
    def __init__(
        self,
        config: CrawlerConfig | None = None,
    ) -> None:
        self.config = config or CrawlerConfig()

    def fetch(self, url: str) -> FetchResult:
        last_error: str | None = None

        for attempt in range(self.config.retry_count + 1):
            try:
                response = requests.get(
                    url,
                    timeout=self.config.timeout_seconds,
                    headers={
                        "User-Agent": "RavalGeoIntelligenceCrawler/1.0"
                    },
                )

                content_type = response.headers.get(
                    "Content-Type",
                    "",
                )

                final_url = getattr(response, "url", None)

                if response.status_code >= 400:
                    last_error = f"HTTP {response.status_code}"

                    if attempt == self.config.retry_count:
                        return FetchResult(
                            url=url,
                            final_url=final_url,
                            status_code=response.status_code,
                            content=response.text,
                            content_type=content_type,
                            error=last_error,
                        )

                    continue

                return FetchResult(
                    url=url,
                    final_url=final_url,
                    status_code=response.status_code,
                    content=response.text,
                    content_type=content_type,
                )

            except requests.RequestException as exc:
                last_error = str(exc)

                if attempt == self.config.retry_count:
                    break

        return FetchResult(
            url=url,
            final_url=None,
            status_code=None,
            content="",
            content_type="",
            error=last_error or "Request failed",
        )



def is_html_content_type(content_type: str) -> bool:
    content_type = content_type.lower()

    return (
        content_type.startswith("text/html")
        or content_type.startswith("application/xhtml+xml")
    )