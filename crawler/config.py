from dataclasses import dataclass, field


@dataclass(frozen=True)
class CrawlerConfig:
    max_pages: int = 50
    max_depth: int = 3

    timeout_seconds: float = 10.0
    retry_count: int = 2

    request_delay_seconds: float = 0.5
    max_concurrency: int = 2

    allowed_domains: list[str] = field(default_factory=list)

    respect_robots_txt: bool = True

    def __post_init__(self) -> None:
        if self.max_pages <= 0:
            raise ValueError("max_pages must be greater than 0")

        if self.max_depth < 0:
            raise ValueError("max_depth cannot be negative")

        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than 0")

        if self.retry_count < 0:
            raise ValueError("retry_count cannot be negative")

        if self.request_delay_seconds < 0:
            raise ValueError("request_delay_seconds cannot be negative")

        if self.max_concurrency <= 0:
            raise ValueError("max_concurrency must be greater than 0")