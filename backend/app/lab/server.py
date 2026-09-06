"""
Local HTTP Test Server for Controlled Site Lab (Task 12 Step 1).

Provides a lightweight, thread-safe, non-blocking in-process HTTP server powered by
standard library http.server to host all lab fixtures concurrently for live crawling,
page extraction, and closed-loop validation testing.
"""

from __future__ import annotations

import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

from .fixtures.dynamic_site import build_dynamic_site_fixture
from .fixtures.server_rendered_site import build_server_rendered_fixture
from .fixtures.static_site import build_static_site_fixture
from .fixtures.wordpress_site import build_wordpress_fixture

logger = logging.getLogger(__name__)


class LabHTTPRequestHandler(BaseHTTPRequestHandler):
    """Dispatches incoming HTTP requests to the corresponding lab fixture based on URL path."""

    def log_message(self, format: str, *args: Any) -> None:
        """Suppress default stderr logging during automated test runs."""
        pass

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # ----------------------------------------------------------------------
        # 1. Static HTML Fixture (/static/...)
        # ----------------------------------------------------------------------
        if path.startswith("/static"):
            subpath = path[len("/static"):] or "/"
            static_fixture = build_static_site_fixture()

            if subpath in static_fixture.redirects:
                code, target = static_fixture.redirects[subpath]
                self.send_response(code)
                self.send_header("Location", f"/static{target}")
                self.end_headers()
                return

            if subpath == "/robots.txt" and static_fixture.robots_txt:
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(static_fixture.robots_txt.encode("utf-8"))
                return

            if subpath == "/sitemap.xml" and static_fixture.sitemap_xml:
                self.send_response(200)
                self.send_header("Content-Type", "application/xml; charset=utf-8")
                self.end_headers()
                self.wfile.write(static_fixture.sitemap_xml.encode("utf-8"))
                return

            if subpath in static_fixture.raw_html_pages:
                res_meta = static_fixture.resources.get(subpath)
                status = res_meta.status_code if res_meta else 200
                content = static_fixture.raw_html_pages[subpath]
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(content.encode("utf-8"))
                return

            # Default 404
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>")
            return

        # ----------------------------------------------------------------------
        # 2. Server-Rendered HTML Fixture (/ssr/...)
        # ----------------------------------------------------------------------
        if path.startswith("/ssr"):
            subpath = path[len("/ssr"):] or "/"
            ssr_fixture = build_server_rendered_fixture()

            if subpath in ssr_fixture.redirects:
                code, target = ssr_fixture.redirects[subpath]
                self.send_response(code)
                self.send_header("Location", f"/ssr{target}")
                self.end_headers()
                return

            if subpath == "/robots.txt" and ssr_fixture.robots_txt:
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("X-Rendered-By", "Server-Side-Engine")
                self.end_headers()
                self.wfile.write(ssr_fixture.robots_txt.encode("utf-8"))
                return

            if subpath == "/sitemap.xml" and ssr_fixture.sitemap_xml:
                self.send_response(200)
                self.send_header("Content-Type", "application/xml; charset=utf-8")
                self.send_header("X-Rendered-By", "Server-Side-Engine")
                self.end_headers()
                self.wfile.write(ssr_fixture.sitemap_xml.encode("utf-8"))
                return

            if subpath in ssr_fixture.raw_html_pages:
                res_meta = ssr_fixture.resources.get(subpath)
                status = res_meta.status_code if res_meta else 200
                content = ssr_fixture.raw_html_pages[subpath]
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("X-Rendered-By", "Server-Side-Engine")
                self.send_header("X-SSR-Latency-Ms", "12")
                self.end_headers()
                self.wfile.write(content.encode("utf-8"))
                return

            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>")
            return

        # ----------------------------------------------------------------------
        # 3. Dynamic Browser / SPA Fixture (/dynamic/...)
        # ----------------------------------------------------------------------
        if path.startswith("/dynamic"):
            subpath = path[len("/dynamic"):] or "/"
            dyn_fixture = build_dynamic_site_fixture()

            if subpath == "/robots.txt" and dyn_fixture.robots_txt:
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(dyn_fixture.robots_txt.encode("utf-8"))
                return

            if subpath == "/sitemap.xml" and dyn_fixture.sitemap_xml:
                self.send_response(200)
                self.send_header("Content-Type", "application/xml; charset=utf-8")
                self.end_headers()
                self.wfile.write(dyn_fixture.sitemap_xml.encode("utf-8"))
                return

            # Check if rendered snapshot requested (via query param ?rendered=true or header)
            is_render_request = (
                query.get("rendered", ["false"])[0].lower() in ("true", "1")
                or self.headers.get("X-Render-Mode", "").lower() == "browser"
            )

            target_map = dyn_fixture.rendered_html_pages if is_render_request else dyn_fixture.raw_html_pages
            if subpath in target_map:
                content = target_map[subpath]
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("X-Hydrated", "true" if is_render_request else "false")
                self.end_headers()
                self.wfile.write(content.encode("utf-8"))
                return

            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>")
            return

        # ----------------------------------------------------------------------
        # 4. WordPress Public Mock Fixture (/wp/...)
        # ----------------------------------------------------------------------
        if path.startswith("/wp"):
            subpath = path[len("/wp"):] or "/"
            wp_fixture = build_wordpress_fixture()

            if subpath == "/robots.txt" and wp_fixture.robots_txt:
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(wp_fixture.robots_txt.encode("utf-8"))
                return

            if subpath in wp_fixture.raw_html_pages:
                content = wp_fixture.raw_html_pages[subpath]
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("X-Powered-By", "WordPress-Lab-Mock/6.4")
                self.end_headers()
                self.wfile.write(content.encode("utf-8"))
                return

            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>")
            return

        # Fallback root route
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"<html><head><title>Controlled Site Lab Hub</title></head><body><h1>Controlled Site Lab Active</h1><p>Routes: /static, /ssr, /dynamic, /wp</p></body></html>")


class LabTestServer:
    """
    Manages an in-process ThreadingHTTPServer for deterministic local lab testing.
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 0) -> None:
        self.host = host
        self.requested_port = port
        self.server: ThreadingHTTPServer | None = None
        self.server_thread: threading.Thread | None = None
        self.port: int = 0

    def start(self) -> str:
        """Starts the server in a background thread and returns the base URL."""
        if self.server is not None:
            return self.base_url

        self.server = ThreadingHTTPServer((self.host, self.requested_port), LabHTTPRequestHandler)
        self.port = self.server.server_port
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        return self.base_url

    def stop(self) -> None:
        """Stops and tears down the server cleanly."""
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
            self.server_thread = None

    @property
    def base_url(self) -> str:
        """Returns the full base URL for the running server."""
        if not self.server or not self.port:
            raise RuntimeError("LabTestServer is not running. Call start() first.")
        return f"http://{self.host}:{self.port}"

    def get_static_url(self, path: str = "/") -> str:
        clean_path = path if path.startswith("/") else f"/{path}"
        return f"{self.base_url}/static{clean_path}"

    def get_ssr_url(self, path: str = "/") -> str:
        clean_path = path if path.startswith("/") else f"/{path}"
        return f"{self.base_url}/ssr{clean_path}"

    def get_dynamic_url(self, path: str = "/") -> str:
        clean_path = path if path.startswith("/") else f"/{path}"
        return f"{self.base_url}/dynamic{clean_path}"

    def get_wp_url(self, path: str = "/") -> str:
        clean_path = path if path.startswith("/") else f"/{path}"
        return f"{self.base_url}/wp{clean_path}"

    def __enter__(self) -> LabTestServer:
        self.start()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.stop()
