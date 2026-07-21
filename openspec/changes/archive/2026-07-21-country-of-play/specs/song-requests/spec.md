## MODIFIED Requirements

### Requirement: Filtered Search Validation And Raw Fallback
When a filtered search is issued, the Request Song effect SHALL validate the selected result before
accepting it. Validation SHALL compare normalized token sets: every token of the parsed title MUST
appear in the token set of the result's track name, and every token of the parsed artist MUST
appear in the union of the token sets of the result's artist names. Token normalization SHALL
lowercase, strip diacritics, strip punctuation, and collapse whitespace. Comparison SHALL be by
whole token, never by substring. When the filtered search returns zero results, or the selected
result fails validation, the effect SHALL retry exactly once with the raw free-text query. The
effect SHALL NOT issue more than two searches for one request.

For every search — filtered or raw — the effect SHALL select from the returned candidates the one
with the greatest **token overlap** with the query it issued: the number of distinct query tokens
(normalized as above) that appear in the union of the candidate's track-name tokens and its
artists'-name tokens. Ties SHALL be broken by Spotify's original result order, so the earliest of
the equally-scoring candidates is chosen. On the filtered path the query tokens are the parsed
title and artist tokens; on the raw path they are the tokens of the raw free-text query.

Selection SHALL exclude candidates Spotify marks unplayable (`is_playable === false`) before
ranking. `is_playable` is only populated when a `market` is in effect (see the Configuration
Parameters requirement); when none is set the field is absent, nothing is excluded, and selection is
unchanged. When every returned candidate is excluded as unplayable, the search SHALL resolve as
though it returned nothing — the filtered path falls through and the raw path outputs `not-found`.

The raw fallback SHALL apply a **zero-overlap floor**: when the best-overlap candidate shares no
query token — including when the raw search returns no candidates at all — the effect SHALL treat
the raw search as finding nothing and output `not-found`, rather than queuing an irrelevant track.
The raw result is otherwise accepted without the filtered path's title/artist containment
validation; only the floor gates it.

#### Scenario: Filtered result validates
- **WHEN** the filtered search for `track:"seven dollars" artist:"happy birthday mr baskets"` returns a track named `Seven Dollars` by `Happy Birthday Mr. Baskets, Kasane Teto`
- **THEN** validation passes, because the title and artist tokens are all present
- **AND** that track is used, with no second search

#### Scenario: Decorated track name still validates
- **WHEN** the parsed title is `seven dollars` and the result is named `Seven Dollars - 2024 Remaster`
- **THEN** validation passes, because containment is directional: the parsed tokens are a subset of the result's tokens

#### Scenario: Mis-split title recovers via fallback
- **WHEN** the query `Stand By Me` splits into title `Stand` and artist `Me`, and the filtered search returns a track whose artist tokens do not include `me`
- **THEN** validation fails
- **AND** the effect retries once with the raw query `Stand By Me`
- **AND** the best token-overlap candidate of that raw search is used

#### Scenario: Substring matches do not satisfy validation
- **WHEN** the parsed artist is `me` and a result's artist is `Mestizo`
- **THEN** validation fails, because `me` is a substring but not a token of `Mestizo`

#### Scenario: Filtered search returns nothing
- **WHEN** the filtered search returns zero tracks
- **THEN** the effect retries once with the raw query

#### Scenario: Raw fallback picks the most relevant candidate, not the first
- **WHEN** the filtered search for `Come play - advance` fails validation and the raw search for `Come play - advance` returns `Tippy Toes` by `XG` first and `Come Play` (matching the query tokens `come` and `play`) later in the same page
- **THEN** the effect selects `Come Play`, because it has the greater token overlap with the query
- **AND** `Tippy Toes`, which shares no query token, is not selected

#### Scenario: Zero-overlap raw result is rejected as not-found
- **WHEN** the raw fallback search returns only candidates that share no token with the query
- **THEN** the effect selects none of them and outputs `success: false` and `errorReason: not-found`

#### Scenario: Ties keep Spotify order
- **WHEN** two raw candidates have equal token overlap with the query
- **THEN** the effect selects the one Spotify returned first

#### Scenario: Unplayable candidates are excluded when a market is in effect
- **WHEN** a Country of Play code is set and the highest-overlap candidate is marked `is_playable: false` while a lower-overlap candidate is playable
- **THEN** the effect selects the playable candidate, skipping the unplayable one

#### Scenario: All candidates unplayable resolves to not-found
- **WHEN** a Country of Play code is set and every returned candidate is marked `is_playable: false`
- **THEN** the raw path selects none of them and outputs `success: false` and `errorReason: not-found`

#### Scenario: Fallback also finds nothing
- **WHEN** the filtered search fails validation and the raw fallback search returns no track
- **THEN** the effect outputs `success: false` and `errorReason: not-found`

#### Scenario: Unsplit query issues one search
- **WHEN** no split applies
- **THEN** exactly one search is issued, with the raw query
- **AND** the best token-overlap candidate is selected, subject to the zero-overlap floor
