from crawler.discovery import (
    classify_url,
    discover_links,
    extract_links,
    is_internal_url,
    normalize_url,
)


def test_normalize_removes_fragment():
    result = normalize_url("https://Example.com/about/#team")

    assert result == "https://example.com/about"


def test_normalize_resolves_relative_url():
    result = normalize_url(
        "/services",
        "https://example.com",
    )

    assert result == "https://example.com/services"


def test_normalize_preserves_query_string():
    result = normalize_url(
        "https://example.com/products?id=123#details"
    )

    assert result == "https://example.com/products?id=123"


def test_internal_url():
    assert is_internal_url(
        "https://example.com/about",
        ["example.com"],
    )


def test_subdomain_is_internal():
    assert is_internal_url(
        "https://blog.example.com/article",
        ["example.com"],
    )


def test_external_url():
    assert not is_internal_url(
        "https://facebook.com/example",
        ["example.com"],
    )


def test_classify_internal_url():
    result = classify_url(
        "https://example.com/about",
        ["example.com"],
    )

    assert result == "internal"


def test_classify_external_url():
    result = classify_url(
        "https://facebook.com/example",
        ["example.com"],
    )

    assert result == "external"
def test_discover_links_normalizes_and_deduplicates():
    html = """
    <a href="/about">About</a>
    <a href="/about/">About duplicate</a>
    <a href="/about#team">Team</a>
    <a href="/services">Services</a>
    <a href="https://google.com">Google</a>
    """

    result = discover_links(
        html,
        "https://example.com/",
        ["example.com"],
    )

    assert result == [
        "https://example.com/about",
        "https://example.com/services",
    ]


def test_discover_links_resolves_relative_urls():
    html = """
    <a href="about">About</a>
    <a href="../contact">Contact</a>
    """

    result = discover_links(
        html,
        "https://example.com/products/",
        ["example.com"],
    )

    assert result == [
        "https://example.com/contact",
        "https://example.com/products/about",
    ]


def test_discover_links_ignores_invalid_and_external_urls():
    html = """
    <a href="/about">About</a>
    <a href="mailto:test@example.com">Email</a>
    <a href="javascript:void(0)">JavaScript</a>
    <a href="https://google.com">Google</a>
    """

    result = discover_links(
        html,
        "https://example.com/",
        ["example.com"],
    )

    assert result == [
        "https://example.com/about",
    ]


def test_subdomain_matching_explicit_rules():
    allowed = ["example.com"]
    # Exact domain and subdomains should match
    assert is_internal_url("https://example.com/page", allowed) is True
    assert is_internal_url("https://api.example.com/v1", allowed) is True
    assert is_internal_url("https://deep.sub.example.com/info", allowed) is True

    # Suffix lookalikes that are not actual subdomains must NOT match
    assert is_internal_url("https://fakeexample.com/page", allowed) is False
    assert is_internal_url("https://notexample.com/page", allowed) is False
    assert is_internal_url("https://my-example.com/page", allowed) is False


def test_specific_subdomain_allowed_does_not_allow_parent_or_sibling():
    allowed = ["app.example.com"]
    assert is_internal_url("https://app.example.com/dashboard", allowed) is True
    assert is_internal_url("https://sub.app.example.com/feature", allowed) is True
    assert is_internal_url("https://example.com/home", allowed) is False
    assert is_internal_url("https://api.example.com/v1", allowed) is False


def test_multiple_allowed_domains():
    allowed = ["example.com", "example.org", "cdn.example.net"]
    assert is_internal_url("https://example.com/about", allowed) is True
    assert is_internal_url("https://docs.example.org/guide", allowed) is True
    assert is_internal_url("https://cdn.example.net/assets/app.js", allowed) is True
    assert is_internal_url("https://google.com/", allowed) is False
    assert is_internal_url("https://example.net/", allowed) is False


def test_relative_url_resolved_to_absolute_before_domain_check():
    html = '<a href="../../team">Team</a>'
    result = discover_links(
        html,
        "https://example.com/company/about/",
        ["example.com"],
    )
    assert result == ["https://example.com/team"]


def test_fragment_removal_prevents_duplicate_urls():
    html = """
    <a href="/faq#q1">Question 1</a>
    <a href="/faq#q2">Question 2</a>
    <a href="/faq">FAQ Main</a>
    """
    result = discover_links(
        html,
        "https://example.com/",
        ["example.com"],
    )
    assert result == ["https://example.com/faq"]


def test_query_params_preserved_and_normalized():
    html = '<a href="/search?q=test&page=2#results">Search</a>'
    result = discover_links(
        html,
        "https://example.com/",
        ["example.com"],
    )
    assert result == ["https://example.com/search?q=test&page=2"]


def test_empty_allowed_domains_returns_no_discovered_links():
    html = '<a href="/about">About</a><a href="https://example.com/services">Services</a>'
    result = discover_links(
        html,
        "https://example.com/",
        [],
    )
    assert result == []

