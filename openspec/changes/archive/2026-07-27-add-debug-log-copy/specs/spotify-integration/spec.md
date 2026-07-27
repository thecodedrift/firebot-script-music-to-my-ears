## MODIFIED Requirements

### Requirement: Authenticated API Client
The script SHALL expose a single API helper that injects the Spotify base URL and current bearer
token and raises a typed error on non-OK responses.

The script SHALL maintain exactly two logging channels for Spotify traffic, with distinct redaction
rules:

1. A **failure-triage** channel, emitted by the API helper when a request fails. It SHALL redact
   user-content query parameters (`q`, `uri`, `uris`) so the record is safe to share in a public
   bug report, while retaining the path and structural parameters such as `type` and `limit`.
2. A **detailed diagnostics** channel, emitted by callers for every search attempt. It SHALL NOT
   redact the query text or the response body, because surfacing exactly those values is its
   purpose. It SHALL be emitted at `debug`, where the session debug log captures it while Firebot's
   own log file stays quiet, and it SHALL NOT be gated on any option.

Both channels SHALL be governed by one absolute invariant: neither SHALL ever emit the
`Authorization` header, the access token, the refresh token, or the client secret.

#### Scenario: Calling the API
- **WHEN** an effect calls the Spotify API helper
- **THEN** the request includes the current bearer token and Spotify base URL
- **AND** a non-2xx response raises a typed error carrying the HTTP status

#### Scenario: Failure triage redacts user content
- **WHEN** a Spotify request fails and the triage record is written
- **THEN** the `q`, `uri`, and `uris` parameter values are replaced with `REDACTED`
- **AND** the request path and the `type` and `limit` parameters are retained

#### Scenario: Detailed diagnostics retain user content
- **WHEN** a search attempt is logged on the detailed diagnostics channel
- **THEN** the query text and the raw response body are logged unredacted

#### Scenario: Detailed diagnostics are not gated
- **WHEN** a search attempt is issued
- **THEN** its diagnostic record is written at `debug` with no option required to enable it

#### Scenario: Credentials never logged on either channel
- **WHEN** any record is written on either the failure-triage channel or the detailed diagnostics channel
- **THEN** the record contains no `Authorization` header, access token, refresh token, or client secret

### Requirement: Artist Identity
The normalized track shape SHALL carry the Spotify artist ids of the track's artists, in the order
Spotify returns them, alongside the artist names it already carries. Features that key on an artist
SHALL use the artist id, never the artist name, because names are neither unique nor stable across
catalog entries, casing, or diacritics.

The **primary artist** SHALL be the first artist in that order. This relies on a Spotify convention
rather than a documented guarantee, and is adopted knowingly.

#### Scenario: Artist ids are carried through
- **WHEN** a track is resolved from a search result or a direct lookup
- **THEN** the normalized track exposes the Spotify artist id of each artist, positionally aligned with the artist names

#### Scenario: Primary artist is the first artist
- **WHEN** a track credits several artists
- **THEN** the primary artist is the first one Spotify returns

#### Scenario: Identity survives name variation
- **WHEN** the same artist appears under different casing or with different diacritics across two tracks
- **THEN** both resolve to the same artist id

#### Scenario: Artist ids appear in search diagnostics
- **WHEN** a search attempt is logged
- **THEN** each logged candidate includes its artists' ids
- **AND** a streamer can determine which artist id a restriction matched
