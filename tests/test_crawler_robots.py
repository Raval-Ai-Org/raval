from unittest.mock import patch

from crawler.robots import RobotsChecker


def test_robots_disabled_allows_crawling():
    checker = RobotsChecker(
        respect_robots_txt=False
    )

    assert checker.can_fetch(
        "https://example.com/private"
    ) is True


def test_robots_allowed_url():
    with patch(
        "crawler.robots.RobotFileParser"
    ) as mock_parser_class:
        parser = mock_parser_class.return_value

        parser.can_fetch.return_value = True

        checker = RobotsChecker(
            respect_robots_txt=True
        )

        result = checker.can_fetch(
            "https://example.com/about"
        )

        assert result is True
        parser.can_fetch.assert_called_once_with(
            "*",
            "https://example.com/about",
        )


def test_robots_disallowed_url():
    with patch(
        "crawler.robots.RobotFileParser"
    ) as mock_parser_class:
        parser = mock_parser_class.return_value

        parser.can_fetch.return_value = False

        checker = RobotsChecker(
            respect_robots_txt=True
        )

        result = checker.can_fetch(
            "https://example.com/private"
        )

        assert result is False


def test_robots_parser_is_cached():
    with patch(
        "crawler.robots.RobotFileParser"
    ) as mock_parser_class:
        parser = mock_parser_class.return_value
        parser.can_fetch.return_value = True

        checker = RobotsChecker(
            respect_robots_txt=True
        )

        checker.can_fetch(
            "https://example.com/about"
        )

        checker.can_fetch(
            "https://example.com/services"
        )

        # Same domain should reuse the same parser.
        mock_parser_class.assert_called_once()