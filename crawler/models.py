from dataclasses import dataclass


@dataclass
class CrawledPage:
    url: str
    depth: int
    status_code: int | None
    content_type: str
    content: str = ""
    error: str | None = None
    final_url: str | None = None

    @property
    def success(self) -> bool:
        return (
            self.error is None
            and self.status_code is not None
            and 200 <= self.status_code < 400
        )