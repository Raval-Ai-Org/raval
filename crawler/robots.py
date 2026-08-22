from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser


class RobotsChecker:
    def __init__(
        self,
        respect_robots_txt: bool = True,
    ) -> None:
        self.respect_robots_txt = respect_robots_txt
        self._parsers: dict[str, RobotFileParser] = {}
        self._sitemaps: dict[str, list[str]] = {}

    def _get_parser(self, url: str) -> RobotFileParser:
        parsed = urlparse(url)

        origin = f"{parsed.scheme}://{parsed.netloc}"
        robots_url = urljoin(origin, "/robots.txt")

        if origin in self._parsers:
            return self._parsers[origin]

        parser = RobotFileParser()
        parser.set_url(robots_url)

        try:
            parser.read()
        except Exception:
            # If robots.txt cannot be retrieved,
            # don't block crawling by default.
            pass

        self._parsers[origin] = parser

        return parser

    def can_fetch(
        self,
        url: str,
        user_agent: str = "*",
    ) -> bool:
        """
        Return whether the URL may be crawled.
        """

        if not self.respect_robots_txt:
            return True

        parser = self._get_parser(url)

        return parser.can_fetch(
            user_agent,
            url,
        )

    def get_sitemaps(
        self,
        url: str,
    ) -> list[str]:
        """
        Return sitemap URLs declared by robots.txt.

        Results are cached per website origin.
        """

        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"

        if origin in self._sitemaps:
            return list(self._sitemaps[origin])

        parser = self._get_parser(url)

        sitemaps = list(parser.site_maps() or [])

        self._sitemaps[origin] = sitemaps

        return list(sitemaps)