## ADDED Requirements

### Requirement: Search Query Normalization
The Request Song effect SHALL attempt to normalize a free-text query into Spotify field filters
before searching. The query SHALL be split into a title and an artist only when a separator occurs
exactly once in the query: the word `by` (matched on word boundaries, case-insensitive) or a
spaced hyphen (` - `). Zero occurrences, two or more occurrences, or an empty side after trimming
SHALL leave the query unsplit. When a split applies, the effect SHALL search with
`track:"<title>" artist:"<artist>"`, taking the title as the portion before the separator. Any
double-quote character within a filter value SHALL be stripped before quoting. A query that already
contains a recognized Spotify field filter (`track:`, `artist:`, `album:`, `year:`, `genre:`,
`isrc:`, `upc:`, `tag:`) SHALL be passed through unmodified.

#### Scenario: Title and artist separated by "by"
- **WHEN** the query is `seven dollars by happy birthday mr baskets`
- **THEN** the search is issued with `q` equal to `track:"seven dollars" artist:"happy birthday mr baskets"`

#### Scenario: Title and artist separated by a spaced hyphen
- **WHEN** the query is `Toxic - Britney Spears`
- **THEN** the search is issued with `q` equal to `track:"Toxic" artist:"Britney Spears"`

#### Scenario: Hyphen inside a name is not a separator
- **WHEN** the query is `Blink-182` or `Jay-Z`
- **THEN** no split occurs, because the hyphen is not surrounded by spaces
- **AND** the search is issued with the raw query

#### Scenario: Separator occurs more than once
- **WHEN** the query contains the word `by` two or more times, such as `Stand By Me by Ben E. King`
- **THEN** no split occurs
- **AND** the search is issued with the raw query

#### Scenario: No separator present
- **WHEN** the query is `Jump`
- **THEN** no split occurs
- **AND** the search is issued with the raw query

#### Scenario: Quote injection is neutralized
- **WHEN** the query is `say "hello" by some"one`, which contains no recognized field filter
- **THEN** the double-quote characters are stripped from both filter values before the query is built
- **AND** the issued `q` is `track:"say hello" artist:"someone"`, containing exactly one `track:` filter and one `artist:` filter

#### Scenario: A query carrying a filter prefix cannot inject a second filter
- **WHEN** the query is `a" artist:"evil by someone`
- **THEN** normalization is skipped entirely, because the query contains the recognized prefix `artist:`
- **AND** the raw query is passed to Spotify, so no filter is ever constructed from attacker-controlled text

#### Scenario: Query already uses field filters
- **WHEN** the query is `track:Doxy artist:Miles Davis`
- **THEN** normalization is skipped and the query is passed to Spotify unmodified

### Requirement: Filtered Search Validation And Raw Fallback
When a filtered search is issued, the Request Song effect SHALL validate the selected result before
accepting it. Validation SHALL compare normalized token sets: every token of the parsed title MUST
appear in the token set of the result's track name, and every token of the parsed artist MUST
appear in the union of the token sets of the result's artist names. Token normalization SHALL
lowercase, strip diacritics, strip punctuation, and collapse whitespace. Comparison SHALL be by
whole token, never by substring. When the filtered search returns zero results, or the selected
result fails validation, the effect SHALL retry exactly once with the raw free-text query and
accept that result without validation. The effect SHALL NOT issue more than two searches for one
request.

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
- **AND** the result of that raw search is used

#### Scenario: Substring matches do not satisfy validation
- **WHEN** the parsed artist is `me` and a result's artist is `Mestizo`
- **THEN** validation fails, because `me` is a substring but not a token of `Mestizo`

#### Scenario: Filtered search returns nothing
- **WHEN** the filtered search returns zero tracks
- **THEN** the effect retries once with the raw query

#### Scenario: Fallback also finds nothing
- **WHEN** the filtered search fails validation and the raw fallback search returns no track
- **THEN** the effect outputs `success: false` and `errorReason: not-found`

#### Scenario: Unsplit query issues one search
- **WHEN** no split applies
- **THEN** exactly one search is issued, with the raw query, and its result is not validated

### Requirement: Opt-In Request Diagnostics
The Request Song effect SHALL expose a per-effect "Enable Logging" checkbox, rendered at the bottom
of the effect options and defaulting to off. When it is off, the effect SHALL emit no additional
logging beyond what it emits today. When it is on, the effect SHALL log, for each search attempt it
issues, a record containing: the attempt kind (`filtered` or `raw`), the outgoing `q` value, the
resolved request endpoint, Spotify's total match count and the number of items returned in the
page, the full list of returned candidates, the raw response body, the candidate that was selected,
and the validation verdict including the reason for any failure. These records SHALL be emitted at
`info` level so that enabling the checkbox is sufficient to see them without also raising Firebot's
global log level. Diagnostics SHALL NOT emit the bearer token, the refresh token, or the client
secret.

#### Scenario: Logging disabled by default
- **WHEN** a Request Song effect is newly created
- **THEN** the "Enable Logging" checkbox is off
- **AND** running the effect emits no search-diagnostic logging

#### Scenario: Logging a successful filtered search
- **WHEN** the checkbox is on and a filtered search succeeds validation
- **THEN** one diagnostic record is logged at `info` for the `filtered` attempt
- **AND** it contains the outgoing `q`, the total match count, the number of returned items, every returned candidate, the raw response body, the selected candidate, and a passing validation verdict

#### Scenario: Logging both attempts on fallback
- **WHEN** the checkbox is on, a filtered search fails validation, and the raw fallback runs
- **THEN** two diagnostic records are logged: one for the `filtered` attempt carrying the failing validation verdict and its reason, and one for the `raw` attempt
- **AND** the streamer can determine from the logs which attempt produced the queued track

#### Scenario: Total matches distinguished from returned items
- **WHEN** Spotify reports a total of 412 matches and returns a page of 5 items
- **THEN** the diagnostic record reports both values distinctly

#### Scenario: Credentials never logged
- **WHEN** the checkbox is on
- **THEN** no logged record contains the bearer token, the refresh token, or the Spotify client secret

## MODIFIED Requirements

### Requirement: Request Song Effect
The script SHALL provide a single Request Song effect that, in one atomic invocation, searches
Spotify for tracks only, applies moderation, and adds the matched track to the Spotify playback
queue. It SHALL output a single `success` flag and, on failure, an `errorReason` identifying the
stage that failed. The search stage MAY issue a normalized filtered search followed by a single raw
fallback search; both are part of the one atomic invocation and neither is separately observable in
the effect's outputs.

#### Scenario: Successful request
- **WHEN** the Request Song effect runs with a query that matches a track passing all moderation, and an active device is available
- **THEN** the track is added to the Spotify playback queue
- **AND** the effect outputs `success: true` with `trackUri`, `trackName`, and `artistName` populated

#### Scenario: No result
- **WHEN** the search returns no track
- **THEN** the effect outputs `success: false` and `errorReason: not-found`

#### Scenario: Podcasts excluded
- **WHEN** the query would otherwise match a podcast or episode
- **THEN** it is not returned, because search is limited to `type=track`

#### Scenario: Single branch point for the streamer
- **WHEN** the request fails at any stage (search, moderation, or queue)
- **THEN** the failure is reported through the one `success: false` output with a specific `errorReason`, so the streamer can branch (e.g. refund a redemption) with a single condition

#### Scenario: Fallback is invisible to downstream effects
- **WHEN** a filtered search fails validation and the raw fallback produces the queued track
- **THEN** the effect's outputs describe only the queued track, with no indication that two searches occurred
- **AND** moderation, the no-repeat check, and the ledger write are applied to that track exactly once
