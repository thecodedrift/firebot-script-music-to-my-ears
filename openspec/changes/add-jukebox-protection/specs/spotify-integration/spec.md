## ADDED Requirements

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

## MODIFIED Requirements

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
