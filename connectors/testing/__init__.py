"""
Testing Package for Website Connectors (Task 11 Step 1).
Exposes MockConnector and NullConnector.
"""

from .mock_connector import MockConnector, NullConnector

__all__ = [
    "MockConnector",
    "NullConnector",
]
