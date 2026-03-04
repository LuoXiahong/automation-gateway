"""Domain and transport errors for biometric-proxy."""


class GarminAuthError(Exception):
    """Garmin API returned 401 or auth failed; session must be re-established."""


class GarminTransientError(Exception):
    """Transient Garmin/network error; retry with backoff."""


class GarminDataError(Exception):
    """Garmin data parsing or validation error."""


class NodeGatewayUnauthorizedError(Exception):
    """Node-gateway returned 401; API key invalid."""


class NodeGatewayTransientError(Exception):
    """Transient error calling node-gateway (5xx, timeout, connection)."""


class NodeGatewayPermanentError(Exception):
    """Permanent client error from node-gateway (4xx other than 401)."""
