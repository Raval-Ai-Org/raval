"""
SSRF Protection and Destination URL Validator (Task 11 Step 6).

Guarantees that external connector reads, rescans, webhooks, and validation requests:
1. Strictly use HTTP / HTTPS protocols.
2. Cannot target loopback, RFC 1918 private subnets, link-local addresses, or cloud metadata endpoints.
3. Reject encoded IP representations (octal, hex, decimal integers).
4. Block dangerous internal infrastructure service ports.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import urlparse

from connectors.base.errors import ConnectorValidationError


class SSRFValidationError(ConnectorValidationError):
    """Raised when a target URL violates SSRF security boundaries."""
    pass


# Private, loopback, link-local, and reserved IPv4 / IPv6 subnets
BLOCKED_IP_NETWORKS: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...] = (
    ipaddress.ip_network("0.0.0.0/8"),          # Current network
    ipaddress.ip_network("10.0.0.0/8"),         # RFC 1918 Private
    ipaddress.ip_network("100.64.0.0/10"),      # Carrier-grade NAT
    ipaddress.ip_network("127.0.0.0/8"),        # Loopback
    ipaddress.ip_network("169.254.0.0/16"),     # Link-local / Cloud Metadata (169.254.169.254)
    ipaddress.ip_network("172.16.0.0/12"),      # RFC 1918 Private
    ipaddress.ip_network("192.0.0.0/24"),       # IETF Protocol Assignments
    ipaddress.ip_network("192.0.2.0/24"),       # Documentation (TEST-NET-1)
    ipaddress.ip_network("192.168.0.0/16"),     # RFC 1918 Private
    ipaddress.ip_network("198.18.0.0/15"),      # Benchmark testing
    ipaddress.ip_network("198.51.100.0/24"),    # Documentation (TEST-NET-2)
    ipaddress.ip_network("203.0.113.0/24"),     # Documentation (TEST-NET-3)
    ipaddress.ip_network("224.0.0.0/4"),        # Multicast
    ipaddress.ip_network("240.0.0.0/4"),        # Reserved for future use
    ipaddress.ip_network("255.255.255.255/32"), # Broadcast
    # IPv6
    ipaddress.ip_network("::1/128"),            # IPv6 Loopback
    ipaddress.ip_network("::/128"),             # IPv6 Unspecified
    ipaddress.ip_network("fc00::/7"),           # IPv6 Unique Local Address (ULA)
    ipaddress.ip_network("fe80::/10"),          # IPv6 Link-Local
    ipaddress.ip_network("ff00::/8"),           # IPv6 Multicast
)

# Prohibited hostnames and domain keywords
BLOCKED_HOSTNAMES: tuple[str, ...] = (
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "metadata.google.internal",
    "metadata.internal",
    "instance-data",
    "169.254.169.254",
)

# High-risk internal ports that should never be targeted by web connectors
BLOCKED_PORTS: tuple[int, ...] = (
    20, 21,    # FTP
    22,        # SSH
    23,        # Telnet
    25, 465, 587, # SMTP
    110, 995,  # POP3
    143, 993,  # IMAP
    2375, 2376,# Docker
    3306,      # MySQL
    5432,      # PostgreSQL
    6379,      # Redis
    8500,      # Consul
    9200, 9300,# Elasticsearch
    11211,     # Memcached
    27017,     # MongoDB
    50070,     # Hadoop NameNode
)

ALLOWED_SCHEMES: tuple[str, ...] = ("http", "https")


class SSRFValidator:
    """
    Validates external target URLs against SSRF vulnerabilities.
    """

    @classmethod
    def validate_url(
        cls,
        url: str,
        allow_dns_resolution: bool = False,
        allow_private_ips_for_testing: bool = False,
    ) -> str:
        """
        Validates the URL syntax, scheme, hostname, port, and IP range.
        Returns the sanitized URL if valid, or raises SSRFValidationError.
        """
        if not url or not isinstance(url, str):
            raise SSRFValidationError(message="Target URL cannot be empty")

        clean_url = url.strip()
        parsed = urlparse(clean_url)

        # 1. Scheme Check
        if not parsed.scheme or parsed.scheme.lower() not in ALLOWED_SCHEMES:
            raise SSRFValidationError(
                message=f"Prohibited URL scheme '{parsed.scheme}'. Only HTTP and HTTPS are permitted.",
                details={"url": clean_url, "scheme": parsed.scheme},
            )

        # 2. Hostname Check
        hostname = parsed.hostname
        if not hostname:
            raise SSRFValidationError(
                message="Target URL is missing a valid hostname",
                details={"url": clean_url},
            )

        hostname_lower = hostname.lower()

        # Check blocked hostnames
        for blocked in BLOCKED_HOSTNAMES:
            if hostname_lower == blocked or hostname_lower.endswith(f".{blocked}"):
                if not allow_private_ips_for_testing:
                    raise SSRFValidationError(
                        message=f"Target hostname '{hostname}' is prohibited (SSRF protection)",
                        details={"hostname": hostname, "blocked_target": blocked},
                    )

        # Check for decimal / octal / hex encoded IP patterns (e.g. 2130706433, 0177.0.0.1, 0x7f000001)
        if re.match(r"^0[0-9]+", hostname_lower) or re.match(r"^0x[0-9a-f]+", hostname_lower) or hostname_lower.isdigit():
            if not allow_private_ips_for_testing:
                raise SSRFValidationError(
                    message=f"Encoded or numeric IP address '{hostname}' is prohibited",
                    details={"hostname": hostname},
                )

        # 3. Port Check
        port = parsed.port
        if port and port in BLOCKED_PORTS:
            raise SSRFValidationError(
                message=f"Target port '{port}' is prohibited (internal service port)",
                details={"port": port, "url": clean_url},
            )

        # 4. Direct IP address verification
        try:
            ip_obj = ipaddress.ip_address(hostname_lower)
            if not allow_private_ips_for_testing:
                cls._check_ip_against_blocked_networks(ip_obj)
        except ValueError:
            # Hostname is a domain name, not a raw IP literal
            pass

        # 5. Optional DNS Resolution Check
        if allow_dns_resolution and not allow_private_ips_for_testing:
            cls._resolve_and_check_dns(hostname_lower)

        return clean_url

    @classmethod
    def _check_ip_against_blocked_networks(cls, ip_obj: ipaddress.IPv4Address | ipaddress.IPv6Address) -> None:
        """Verifies an IP address is not within any prohibited subnet."""
        if ip_obj.is_loopback:
            raise SSRFValidationError(message=f"Loopback IP '{ip_obj}' is prohibited", details={"ip": str(ip_obj)})
        if ip_obj.is_private:
            raise SSRFValidationError(message=f"Private IP '{ip_obj}' is prohibited", details={"ip": str(ip_obj)})
        if ip_obj.is_link_local:
            raise SSRFValidationError(message=f"Link-local IP '{ip_obj}' is prohibited", details={"ip": str(ip_obj)})
        if ip_obj.is_multicast:
            raise SSRFValidationError(message=f"Multicast IP '{ip_obj}' is prohibited", details={"ip": str(ip_obj)})
        if ip_obj.is_reserved:
            raise SSRFValidationError(message=f"Reserved IP '{ip_obj}' is prohibited", details={"ip": str(ip_obj)})

        for net in BLOCKED_IP_NETWORKS:
            if ip_obj in net:
                raise SSRFValidationError(
                    message=f"IP address '{ip_obj}' is within restricted network '{net}'",
                    details={"ip": str(ip_obj), "network": str(net)},
                )

    @classmethod
    def _resolve_and_check_dns(cls, hostname: str) -> None:
        """Resolves DNS and verifies resolved IP addresses against blocked networks."""
        try:
            addr_info = socket.getaddrinfo(hostname, None)
            for item in addr_info:
                sockaddr = item[4]
                ip_str = sockaddr[0]
                ip_obj = ipaddress.ip_address(ip_str)
                cls._check_ip_against_blocked_networks(ip_obj)
        except socket.gaierror as exc:
            raise SSRFValidationError(
                message=f"DNS resolution failed for '{hostname}': {exc}",
                details={"hostname": hostname},
            )
