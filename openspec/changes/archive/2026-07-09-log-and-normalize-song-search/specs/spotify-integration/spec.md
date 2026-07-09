## MODIFIED Requirements

### Requirement: Authenticated API Client
The script SHALL expose a single API helper that injects the Spotify base URL and current bearer
token and raises a typed error on non-OK responses.

The script SHALL maintain exactly two logging channels for Spotify traffic, with distinct redaction
rules:

1. An **always-on failure-triage** channel, emitted by the API helper when a request fails. It
   SHALL redact user-content query parameters (`q`, `uri`, `uris`) so the record is safe to share
   in a public bug report, while retaining the path and structural parameters such as `type` and
   `limit`.
2. An **opt-in diagnostics** channel, emitted by callers that the streamer has explicitly enabled.
   It SHALL NOT redact the query text or the response body, because surfacing exactly those values
   is its purpose and the streamer has consented by enabling it.

Both channels SHALL be governed by one absolute invariant: neither SHALL ever emit the
`Authorization` header, the access token, the refresh token, or the client secret.

#### Scenario: Calling the API
- **WHEN** an effect calls the Spotify API helper
- **THEN** the request includes the current bearer token and Spotify base URL
- **AND** a non-2xx response raises a typed error carrying the HTTP status

#### Scenario: Failure triage redacts user content
- **WHEN** a Spotify request fails and the always-on triage record is written
- **THEN** the `q`, `uri`, and `uris` parameter values are replaced with `REDACTED`
- **AND** the request path and the `type` and `limit` parameters are retained

#### Scenario: Opt-in diagnostics retain user content
- **WHEN** a caller has opt-in diagnostics enabled and logs a search attempt
- **THEN** the query text and the raw response body are logged unredacted

#### Scenario: Credentials never logged on either channel
- **WHEN** any record is written on either the failure-triage channel or the opt-in diagnostics channel
- **THEN** the record contains no `Authorization` header, access token, refresh token, or client secret
