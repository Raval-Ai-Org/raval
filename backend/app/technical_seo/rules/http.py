"""HTTP / response rules (category ``http``).

Owns every status-code-based finding (spec §6) so no other category
re-emits indexing-blocked signals for the same cause. Uses only existing
crawler evidence — never issues extra network requests (spec §6).
"""

from ..base import RuleFinding, register


@register(
    "SEO-HTTP-001", "http", "critical",
    "Server error (5xx)",
    "Detect 5xx server-error responses.",
)
def server_error(ctx):
    sc = ctx.status_code
    if sc is not None and 500 <= sc <= 599:
        return [
            RuleFinding(
                message=f"Page returned a server error (HTTP {sc}).",
                observed_value=f"HTTP {sc}",
                expected_state="a 2xx success response",
                reason="5xx responses cannot be indexed and signal an unhealthy endpoint.",
                recommendation="Fix the server error so the page returns a 2xx response.",
                evidence={"status_code": sc, "prevents_indexing": True},
            )
        ]
    return []


@register(
    "SEO-HTTP-002", "http", "high",
    "Client error (4xx)",
    "Detect 4xx client-error responses.",
)
def client_error(ctx):
    sc = ctx.status_code
    if sc is not None and 400 <= sc <= 499:
        return [
            RuleFinding(
                message=f"Page returned a client error (HTTP {sc}).",
                observed_value=f"HTTP {sc}",
                expected_state="a 2xx success response",
                reason="4xx responses are not indexable and usually indicate a missing or forbidden page.",
                recommendation="Restore the page or remove references to it if it is gone.",
                evidence={"status_code": sc, "prevents_indexing": True},
            )
        ]
    return []


@register(
    "SEO-HTTP-003", "http", "high",
    "Crawl failure",
    "Detect pages that could not be fetched at all (no HTTP status).",
)
def crawl_failure(ctx):
    if ctx.status_code is None and ctx.error:
        return [
            RuleFinding(
                message="Page could not be fetched during the crawl.",
                observed_value=f"no HTTP status; error: {ctx.error}",
                expected_state="a successful fetch with a 2xx response",
                reason="A page that cannot be fetched cannot be evaluated or indexed.",
                recommendation="Investigate the network/DNS/timeout error and ensure the URL responds.",
                evidence={"status_code": None, "error": ctx.error, "prevents_indexing": True},
            )
        ]
    return []


@register(
    "SEO-HTTP-004", "http", "info",
    "Redirect",
    "Detect pages whose final URL differs from the requested URL.",
)
def redirect(ctx):
    if not ctx.redirected:
        return []
    sc = ctx.status_code
    lands_on_error = sc is not None and 400 <= sc <= 599
    severity = "low" if lands_on_error else None  # None -> rule default (info)
    return [
        RuleFinding(
            message="Requested URL redirects to a different final URL.",
            observed_value=f"{ctx.url} -> {ctx.final_url}",
            expected_state="a direct 2xx response, or an intentional canonical redirect",
            reason=(
                "Redirects are often legitimate (canonicalisation, migrations) "
                "but chains or redirects to errors waste crawl budget and can "
                "break indexing."
            ),
            recommendation="Confirm the redirect is intentional and points to a live 2xx URL.",
            evidence={
                "requested_url": ctx.url,
                "final_url": ctx.final_url,
                "final_status": sc,
                "lands_on_error": lands_on_error,
            },
            severity=severity,
        )
    ]


@register(
    "SEO-HTTP-005", "http", "info",
    "Unexpected content type",
    "Detect successfully-fetched pages whose content type is not HTML.",
)
def unexpected_content_type(ctx):
    ct = (ctx.content_type or "").lower()
    if ctx.is_success and ct and "html" not in ct:
        return [
            RuleFinding(
                message="Fetched resource is not an HTML document.",
                observed_value=f"content-type: {ctx.content_type}",
                expected_state="text/html for an indexable page",
                reason="Non-HTML resources are indexed differently and may not carry page-level SEO signals.",
                recommendation="Confirm this URL is meant to be a crawlable HTML page.",
                evidence={"content_type": ctx.content_type, "status_code": ctx.status_code},
            )
        ]
    return []
