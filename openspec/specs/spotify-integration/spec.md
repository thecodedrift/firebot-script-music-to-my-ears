# spotify-integration

## Purpose
Defines how the script links a Spotify account, authenticates API calls, and exposes the configuration parameters that govern Spotify-backed behavior.

## Requirements

### Requirement: Spotify Account Linking
The script SHALL register a Firebot integration that links a Spotify account through Firebot's
OAuth UI and refreshes the access token automatically.

#### Scenario: Linking an account
- **WHEN** the streamer enters their Spotify client id/secret and links the account in Firebot
- **THEN** Firebot completes the OAuth flow and stores the tokens
- **AND** an expired access token is refreshed automatically before the next API call

#### Scenario: Explanatory configuration page
- **WHEN** the script configuration page is shown
- **THEN** it explains that authentication is performed by linking the account (not from inside Firebot prompts) and where to obtain the client id/secret

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

### Requirement: Configuration Parameters
The script SHALL expose configuration parameters for the Spotify client id and client secret only.
Moderation filters and request restrictions SHALL be configured per effect rather than as script
parameters, so that changing them takes effect without restarting Firebot.

#### Scenario: Applying saved parameters
- **WHEN** the streamer saves the script parameters
- **THEN** the Spotify client id and secret are applied to subsequent authentication

#### Scenario: Restrictions are not script parameters
- **WHEN** the streamer opens the script parameters
- **THEN** no no-repeat window, blocked-terms list, artist cooldown, or maximum track length appears there
- **AND** each is configured on the Request Song effect instead

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
- **WHEN** opt-in request diagnostics are enabled
- **THEN** each logged candidate includes its artists' ids
- **AND** a streamer can determine which artist id a restriction matched
