"""Backward-compat re-exports; canonical definitions live in domain.errors."""
from app.domain.errors import (
    GarminAuthError as GarminAuthError,
    GarminDataError as GarminDataError,
    GarminTransientError as GarminTransientError,
    NodeGatewayPermanentError as NodeGatewayPermanentError,
    NodeGatewayTransientError as NodeGatewayTransientError,
    NodeGatewayUnauthorizedError as NodeGatewayUnauthorizedError,
)

__all__ = [
    "GarminAuthError",
    "GarminDataError",
    "GarminTransientError",
    "NodeGatewayPermanentError",
    "NodeGatewayTransientError",
    "NodeGatewayUnauthorizedError",
]
