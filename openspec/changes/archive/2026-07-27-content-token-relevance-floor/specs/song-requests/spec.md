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
title and artist tokens; on the raw path they are the tokens of the raw free-text query. Ranking
SHALL weigh every query token equally, function words included, because it is choosing between
candidates that already relate to the query.

Selection SHALL exclude candidates Spotify marks unplayable (`is_playable === false`) before
ranking. `is_playable` is only populated when a `market` is in effect (see the Configuration
Parameters requirement); when none is set the field is absent, nothing is excluded, and selection is
unchanged. When every returned candidate is excluded as unplayable, the search SHALL resolve as
though it returned nothing — the filtered path falls through and the raw path outputs `not-found`.

The raw fallback SHALL apply a **content-token floor**: the selected candidate SHALL share at least
one *content token* with the query, where a content token is a query token that is not an English
function word (articles, conjunctions, prepositions, and the feature markers `feat`, `ft`,
`featuring`, `vs`). When it shares none — including when the raw search returns no candidates at
all — the effect SHALL treat the raw search as finding nothing and output `not-found`, rather than
queuing an irrelevant track. The floor asks whether a candidate relates to the request at all, and a
shared function word is no evidence that it does.

The list of function words SHALL be short and closed, covering only words that are meaningless as a
search term on their own. Pronouns SHALL NOT be treated as function words, because they carry real
signal in titles (`Stand By Me`, `Call Me Maybe`).

When a query consists entirely of function words (`The The`, `You And Me`), there is no content
token to require, and the floor SHALL fall back to requiring any shared token, so that such a
request remains findable.

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

#### Scenario: A shared function word does not clear the floor
- **WHEN** the raw fallback for `walk the dinosaur by ninja sex party` returns a candidate named `The Decision`, whose only shared token is `the`
- **THEN** the candidate is rejected and the effect outputs `errorReason: not-found`

#### Scenario: A shared content word clears the floor
- **WHEN** the raw fallback for `walk the dinosaur by ninja sex party` returns a candidate whose name shares the token `dinosaur`
- **THEN** the candidate is accepted, because `dinosaur` is a content token

#### Scenario: An all-function-word query keeps the any-token floor
- **WHEN** the raw fallback for `the the` returns a candidate whose only shared token is `the`
- **THEN** the candidate is accepted, because the query has no content token to require

#### Scenario: Pronouns are content tokens
- **WHEN** the raw fallback for `stand by me` returns a candidate sharing only the token `me`
- **THEN** the candidate is accepted, because `me` is not treated as a function word

#### Scenario: Ranking still counts function words
- **WHEN** two candidates are ranked for the raw query `stand by me`, one sharing `stand` and `by` and one sharing `stand` alone
- **THEN** the candidate sharing two tokens is selected, because ranking weighs every query token equally
