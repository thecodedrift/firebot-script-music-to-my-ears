## MODIFIED Requirements

### Requirement: Configuration Parameters
The script SHALL expose configuration parameters for the Spotify client id, the client secret, and a
single optional **Country of Play** country code. Moderation filters and request restrictions SHALL
be configured per effect rather than as script parameters, so that changing them takes effect
without restarting Firebot.

The Country of Play parameter SHALL be a 2-letter ISO 3166-1 alpha-2 country code, defaulting to an
empty string. An empty value means no market is sent and behavior is unchanged. The script SHALL
treat a value that is not exactly two ASCII letters as unset and send no market for it.

#### Scenario: Applying saved parameters
- **WHEN** the streamer saves the script parameters
- **THEN** the Spotify client id and secret are applied to subsequent authentication

#### Scenario: Country of Play defaults to empty
- **WHEN** the script parameters are shown on a fresh install
- **THEN** the Country of Play code is empty
- **AND** no `market` parameter is sent on Spotify requests

#### Scenario: Restrictions are not script parameters
- **WHEN** the streamer opens the script parameters
- **THEN** no no-repeat window, blocked-terms list, artist cooldown, or maximum track length appears there
- **AND** each is configured on the Request Song effect instead

## ADDED Requirements

### Requirement: Market From The Country Of Play
When a valid Country of Play code is set, the script SHALL send it as the `market` query parameter on
track search and on direct track lookup, so Spotify applies track relinking and returns
`is_playable`. When the code is empty or invalid, the script SHALL send no `market`, and responses
carry no `is_playable`. The code SHALL be uppercased before it is sent. The `market` parameter is a
structural parameter, not user content, and SHALL NOT be redacted from the failure-triage log.

A direct track URL, URI, or id that the configured market cannot play SHALL surface as the
`not-playable` outcome rather than being resolved and queued.

#### Scenario: Market sent when a code is configured
- **WHEN** the Country of Play code is `US` and a search or track lookup is issued
- **THEN** the request includes `market=US`

#### Scenario: No market when the code is empty
- **WHEN** the Country of Play code is empty
- **THEN** no `market` parameter is included on the request

#### Scenario: Invalid code is dropped, not forwarded
- **WHEN** the Country of Play code is not exactly two ASCII letters (for example `USA` or `1`)
- **THEN** the script sends no `market` parameter

#### Scenario: Unplayable direct track surfaces as not-playable
- **WHEN** a market is in effect and a pasted Spotify track URL resolves to a track Spotify marks unplayable in that market
- **THEN** the request outputs `errorReason: not-playable`

#### Scenario: Market is not redacted from triage
- **WHEN** a Spotify request carrying a `market` fails and the always-on triage record is written
- **THEN** the `market` value is retained, like `type` and `limit`, while `q`/`uri`/`uris` are still redacted
