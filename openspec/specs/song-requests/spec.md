# song-requests

## Purpose
Defines the Request Song effect and the moderation, filtering, no-repeat, and requester-attribution rules that govern viewer song requests.

## Requirements

### Requirement: Request Song Effect
The script SHALL provide a single Request Song effect that, in one atomic invocation, searches
Spotify for tracks only, applies moderation and the configured restrictions, and adds the matched
track to the Spotify playback queue. It SHALL output a single `success` flag and, on failure, an
`errorReason` identifying the stage that failed, an `errorText` describing that reason in prose, and
an `errorCooldown` giving the remaining wait when the reason is a cooldown. The search stage MAY
issue a normalized filtered search followed by a single raw fallback search; both are part of the one
atomic invocation and neither is separately observable in the effect's outputs.

#### Scenario: Successful request
- **WHEN** the Request Song effect runs with a query that matches a track passing all moderation and all restrictions, and an active device is available
- **THEN** the track is added to the Spotify playback queue
- **AND** the effect outputs `success: true` with `trackUri`, `trackName`, and `artistName` populated
- **AND** `errorReason` and `errorText` are empty and `errorCooldown` is `0`

#### Scenario: No result
- **WHEN** the search returns no track
- **THEN** the effect outputs `success: false` and `errorReason: not-found`

#### Scenario: Podcasts excluded
- **WHEN** the query would otherwise match a podcast or episode
- **THEN** it is not returned, because search is limited to `type=track`

#### Scenario: Single branch point for the streamer
- **WHEN** the request fails at any stage (search, moderation, restrictions, or queue)
- **THEN** the failure is reported through the one `success: false` output with a specific `errorReason`, so the streamer can branch (e.g. refund a redemption) with a single condition
- **AND** a streamer who does not wish to branch per reason MAY send `errorText` directly

#### Scenario: Fallback is invisible to downstream effects
- **WHEN** a filtered search fails validation and the raw fallback produces the queued track
- **THEN** the effect's outputs describe only the queued track, with no indication that two searches occurred
- **AND** moderation, the restriction checks, and the ledger write are applied to that track exactly once

### Requirement: Substring Moderation
The Request Song effect SHALL reject a matched track when any configured blocked term appears, as a
case-insensitive substring, in the track's artist name or track name. The blocked-terms parameter
SHALL ship pre-filled with the editable default terms `karaoke`, `instrumental`, and `inst.`.

#### Scenario: Blocked term present
- **WHEN** a matched track's artist or track name contains a configured blocked term as a substring (case-insensitive)
- **THEN** the effect outputs `success: false` and `errorReason: blocked-term`
- **AND** the track is not queued

#### Scenario: Default blocked terms
- **WHEN** the streamer has not modified the blocked-terms parameter
- **THEN** `karaoke`, `instrumental`, and `inst.` are in effect as default blocked terms

### Requirement: Explicit Track Filter
The Request Song effect SHALL expose a per-effect "allow explicit tracks" checkbox (default off).
When it is off, a matched track whose Spotify `explicit` field is true SHALL be rejected.

#### Scenario: Explicit track blocked
- **WHEN** the "allow explicit tracks" checkbox is off and a matched track is marked explicit
- **THEN** the effect outputs `success: false` and `errorReason: explicit`
- **AND** the track is not queued

#### Scenario: Explicit track allowed
- **WHEN** the "allow explicit tracks" checkbox is on
- **THEN** an explicit track is not rejected on the basis of being explicit

### Requirement: No-Repeat Window
The Request Song effect SHALL reject a matched track whose URI was queued within the configured
no-repeat window. The window SHALL be configured **per effect** in minutes and SHALL default to `30`;
a window of `0` disables the check. The no-repeat check and the ledger write SHALL occur within the
same atomic effect invocation so the same track cannot pass the check twice before being recorded.

The no-repeat window is a transient restriction and SHALL participate in the precedence rule defined
by the Rejection Precedence requirement: when a longer cooldown also applies, that longer cooldown is
the one reported.

#### Scenario: Recently queued
- **WHEN** a matched track's URI was recorded in the ledger within the no-repeat window
- **THEN** the effect outputs `success: false` and `errorReason: recently-played`
- **AND** the track is not queued again

#### Scenario: Configured per effect
- **WHEN** two Request Song effects are configured with different no-repeat windows
- **THEN** each applies its own window when reading the ledger
- **AND** both record every successfully queued track, so neither effect's window is undermined by the other

#### Scenario: Window of 0 disables the check
- **WHEN** the no-repeat window is `0`
- **THEN** no track is rejected with `errorReason: recently-played`

### Requirement: Queue Failure Reporting
When moderation passes but the track cannot be queued, the Request Song effect SHALL report the
failure without recording the track in the ledger.

#### Scenario: No active device or not Premium
- **WHEN** moderation passes but no active device is available, or the account is not Premium
- **THEN** the effect outputs `success: false` and `errorReason` of `no-active-device` or `not-premium`
- **AND** nothing is written to the ledger

### Requirement: Requester Ledger
The script SHALL maintain an in-memory ledger of namespaced keys mapped to the requester and the time
the entry was written, used for the no-repeat check, the artist cooldowns, and requester attribution.
The keyspace SHALL distinguish tracks (`track:<uri>`), artists (`artist:<artistId>`), and
requester-artist pairs (`user-artist:<lowercased-username>:<artistId>`). Requester attribution SHALL
be read only from `track:` keys.

On a successful queue the ledger SHALL record every applicable key **unconditionally**, including keys
whose corresponding window is `0` on the effect that queued the track. Only reads are gated by the
window. The ledger SHALL NOT be persisted across restarts and SHALL be cleared in its entirety on
`stop()`.

The ledger SHALL expose the remaining wait for a key in milliseconds rather than a boolean, returning
`0` when the key is absent, its window has elapsed, or the window is `0` or less.

#### Scenario: Recorded on successful queue
- **WHEN** the Request Song effect successfully queues a track
- **THEN** the track key, the primary artist key, and the requester-artist key are each recorded with the requester and a timestamp

#### Scenario: Recorded even when a window is disabled
- **WHEN** an effect with its artist cooldown set to `0` successfully queues a track
- **THEN** the artist key is still recorded
- **AND** a different effect with a non-zero artist cooldown observes that entry

#### Scenario: Requester attribution reads only track keys
- **WHEN** requester attribution is resolved for a currently-playing track
- **THEN** it is read from the `track:` key for that URI

#### Scenario: Remaining wait rather than a boolean
- **WHEN** a key was recorded 2 minutes ago and its window is 5 minutes
- **THEN** the ledger reports approximately 3 minutes of remaining wait

#### Scenario: No remaining wait when the window is disabled
- **WHEN** a key was recorded and its window is `0`
- **THEN** the ledger reports `0` remaining wait

#### Scenario: Cleared on teardown
- **WHEN** the script stops
- **THEN** every key in the ledger is cleared

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

The two separators SHALL NOT be weighed equally. A single `by` SHALL take precedence over a spaced
hyphen when both appear, because Spotify's own track titles use ` - ` to introduce version suffixes
(`Toxic - Radio Edit`), so in a mixed query the hyphen usually belongs to the title. The spaced
hyphen SHALL be considered only when the query contains no `by` at all. Two or more `by`s SHALL
leave the query unsplit and SHALL NOT fall through to the hyphen, because the delimiter is then
genuinely undecidable.

Where `by`-precedence guesses wrong — a title that itself contains `by`, followed by a hyphen
separator — the mis-split SHALL be caught by the validation gate and recovered by the raw fallback.
`by`-precedence is therefore never less correct than refusing to split, only one request more
expensive when it guesses wrong.

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

#### Scenario: A single "by" outranks a hyphen belonging to the title
- **WHEN** the query is `Toxic - Radio Edit by Britney Spears`, containing one `by` and one spaced hyphen
- **THEN** the split occurs at the `by`, not at the hyphen
- **AND** the search is issued with `q` equal to `track:"Toxic - Radio Edit" artist:"Britney Spears"`

#### Scenario: A "by" inside the title mis-splits and is recovered
- **WHEN** the query is `Stand By Me - Ben E. King`, where `by` sits inside the title and the hyphen is the real separator
- **THEN** the split occurs at the `by`, yielding `track:"Stand" artist:"Me - Ben E. King"`
- **AND** the leftover `me` token causes validation to fail
- **AND** the raw fallback recovers the correct track, so the request still succeeds

#### Scenario: Two "by"s do not fall through to the hyphen
- **WHEN** the query is `Stand By Me - covered by Ben E. King`, containing two `by`s and one spaced hyphen
- **THEN** no split occurs on either separator
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
and the validation verdict including the reason for any failure. When the checkbox is on, the effect
SHALL additionally log, for each request it rejects, a record naming the rejection's `errorReason`
and the rejected track, plus the remaining wait when the reason is a cooldown. These records SHALL be
emitted at `info` level so that enabling the checkbox is sufficient to see them without also raising
Firebot's global log level. Diagnostics SHALL NOT emit the bearer token, the refresh token, or the
client secret.

#### Scenario: Logging disabled by default
- **WHEN** a Request Song effect is newly created
- **THEN** the "Enable Logging" checkbox is off
- **AND** running the effect emits no search-diagnostic or rejection logging

#### Scenario: Logging a rejected request
- **WHEN** the checkbox is on and a request is rejected by moderation or a restriction
- **THEN** one record is logged at `info` naming the rejection's `errorReason` and the rejected track
- **AND** when the reason is a cooldown, the record includes the remaining wait

#### Scenario: Rejections silent when logging is off
- **WHEN** the checkbox is off and a request is rejected
- **THEN** no rejection record is logged

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

### Requirement: Global Artist Cooldown
The Request Song effect SHALL reject a matched track whose primary artist was queued within the
configured global artist cooldown window, regardless of who requested it. The primary artist SHALL
be the first artist of the track, identified by Spotify artist id. The window SHALL be configured
per effect in minutes and SHALL default to `0`, which disables the check.

This requirement exists to protect playlist diversity, not to police requesters. A viewer who has
requested nothing can be rejected because another viewer queued that artist, and that is correct
behavior.

#### Scenario: Artist queued within the window
- **WHEN** a matched track's primary artist id was recorded in the ledger within the global artist cooldown window
- **THEN** the effect outputs `success: false` and `errorReason: artist-recently-played`
- **AND** the track is not queued

#### Scenario: The cooldown applies to every requester
- **WHEN** one viewer successfully queues a track by an artist, and a different viewer requests another track by the same primary artist within the window
- **THEN** the second request is rejected with `errorReason: artist-recently-played`

#### Scenario: Rejection text does not blame the requester
- **WHEN** a request is rejected with `errorReason: artist-recently-played`
- **THEN** the `errorText` output states that the artist was played recently
- **AND** it does not state or imply that the requester has requested that artist too often

#### Scenario: Window of 0 disables the check
- **WHEN** the global artist cooldown is `0`
- **THEN** no track is rejected with `errorReason: artist-recently-played`

#### Scenario: A featured artist does not trip their own cooldown
- **WHEN** an artist is queued as the primary artist of one track, and is then requested as a non-primary featured artist of a different track within the window
- **THEN** the second request is not rejected on the basis of the artist cooldown, because only the primary artist is gated
- **AND** this bypass is accepted deliberately: gating every credited artist would lock the solo work of a collaborator nobody requested, which is a worse and more confusing failure than the bypass

### Requirement: Per-Requester Artist Cooldown
The Request Song effect SHALL reject a matched track whose primary artist was queued by the same
requester within the configured per-requester artist cooldown window. The key SHALL be the
requester's lowercased username together with the primary artist's Spotify artist id. The window
SHALL be configured per effect in minutes and SHALL default to `0`, which disables the check.

When the effect trigger carries no username, the per-requester check SHALL be skipped entirely.

#### Scenario: Same requester, same artist
- **WHEN** a requester successfully queues a track, and requests another track by the same primary artist within the per-requester window
- **THEN** the effect outputs `success: false` and `errorReason: user-artist-recently-played`
- **AND** the track is not queued

#### Scenario: A different requester is unaffected
- **WHEN** one requester queues a track by an artist, and a different requester requests that artist within the per-requester window
- **THEN** the per-requester check does not reject the second request
- **AND** the request may still be rejected by the global artist cooldown, if that window is configured and has not elapsed

#### Scenario: Usernames are compared case-insensitively
- **WHEN** the same viewer's username is supplied with different casing across two requests
- **THEN** both requests resolve to the same per-requester cooldown key

#### Scenario: A trigger without a username skips the check
- **WHEN** the Request Song effect is fired by a trigger that supplies no username, such as a timer
- **THEN** the per-requester artist cooldown is not evaluated
- **AND** such requests do not share a common cooldown bucket with one another

#### Scenario: Window of 0 disables the check
- **WHEN** the per-requester artist cooldown is `0`
- **THEN** no track is rejected with `errorReason: user-artist-recently-played`

### Requirement: Maximum Track Length
The Request Song effect SHALL reject a matched track whose duration exceeds the configured maximum
track length. The maximum SHALL be configured per effect in seconds and SHALL default to `0`, which
disables the check.

#### Scenario: Track exceeds the maximum
- **WHEN** the maximum track length is 420 seconds and a matched track is 600 seconds long
- **THEN** the effect outputs `success: false` and `errorReason: too-long`
- **AND** the track is not queued

#### Scenario: Track within the maximum
- **WHEN** the maximum track length is 420 seconds and a matched track is 419 seconds long
- **THEN** the track is not rejected on the basis of its length

#### Scenario: Maximum of 0 disables the check
- **WHEN** the maximum track length is `0`
- **THEN** no track is rejected with `errorReason: too-long`

### Requirement: Rejection Precedence
When a matched track trips more than one restriction, the Request Song effect SHALL report exactly
one `errorReason`, chosen by the following two-part rule.

Restrictions SHALL be partitioned into **permanent** rejections — `blocked-term`, `explicit`, and
`too-long` — and **transient** rejections — `recently-played`, `artist-recently-played`, and
`user-artist-recently-played`.

Permanent rejections SHALL be evaluated first, and the first one that trips SHALL be reported,
because a track that is too long or explicit will never succeed and telling the requester to retry
later would be false.

When no permanent rejection trips and two or more transient rejections trip, the effect SHALL report
the one with the **greatest remaining wait**, not the most specific one. Reporting a shorter
remaining wait while a longer cooldown is still in force would tell the requester to retry at a time
they would be rejected again.

#### Scenario: A permanent rejection outranks a transient one
- **WHEN** a matched track is both longer than the maximum track length and within the no-repeat window
- **THEN** the effect outputs `errorReason: too-long`

#### Scenario: The longest remaining cooldown is reported
- **WHEN** a matched track trips the no-repeat window with 5 minutes remaining, the per-requester artist cooldown with 22 minutes remaining, and the global artist cooldown with 58 minutes remaining
- **THEN** the effect outputs `errorReason: artist-recently-played`
- **AND** `errorCooldown` reports the remaining wait for that cooldown, not for either shorter one

#### Scenario: Specificity does not decide the winner
- **WHEN** a matched track trips the no-repeat window with 5 minutes remaining and the global artist cooldown with 58 minutes remaining
- **THEN** the effect outputs `errorReason: artist-recently-played`, even though `recently-played` identifies the more specific cause
- **AND** the requester is told to retry after the cooldown that actually governs

#### Scenario: A disabled restriction never wins
- **WHEN** a restriction's window is `0`
- **THEN** it contributes no remaining wait and cannot be reported

### Requirement: Friendly Error Text
Every effect that outputs an `errorReason` SHALL also output an `errorText`: a human-readable
message describing the failure, suitable for sending to chat without modification. `errorText` SHALL
be derived from the `errorReason` by a single mapping that covers every reason exhaustively, and
SHALL be the empty string when the effect succeeds.

Where a message includes the track name, artist name, or a remaining wait, those values SHALL be
substituted using placeholders that are not prefixed with `$`, because artist names legitimately
contain `$` and Firebot's replacement-variable syntax uses that character.

#### Scenario: Text accompanies every failure
- **WHEN** any effect outputs a non-empty `errorReason`
- **THEN** it also outputs a non-empty `errorText` describing that reason

#### Scenario: Empty on success
- **WHEN** an effect succeeds
- **THEN** `errorText` is the empty string, matching `errorReason`

#### Scenario: Playback effects carry the text too
- **WHEN** a skip, play/resume, or pause effect fails with `no-active-device`, `not-premium`, or `not-linked`
- **THEN** it outputs the corresponding `errorText`

#### Scenario: An artist name containing a dollar sign renders intact
- **WHEN** a request by an artist named `A$AP Rocky` is rejected by a cooldown
- **THEN** the artist name appears intact in `errorText`, with no part of it interpreted as a variable

### Requirement: Remaining Cooldown Output
The Request Song effect SHALL output an `errorCooldown`: the remaining wait, in whole seconds,
before the reported cooldown expires. The value SHALL be computed by rounding the remaining
milliseconds **up** to the next second, and SHALL be `0` for every reason that is not a cooldown, and
on success.

Because a cooldown rejection always has a remaining wait greater than zero, rounding up guarantees
`errorCooldown` is at least `1` whenever a cooldown is reported. A value of `0` therefore
unambiguously means "not rejected by a cooldown".

#### Scenario: Reports the winning cooldown's remaining wait
- **WHEN** the effect reports a transient `errorReason`
- **THEN** `errorCooldown` is the remaining seconds of that same cooldown

#### Scenario: Rounded up, never to zero
- **WHEN** a cooldown has 400 milliseconds remaining
- **THEN** `errorCooldown` is `1`, not `0`

#### Scenario: Zero for non-cooldown failures
- **WHEN** the effect fails with `not-found`, `blocked-term`, `explicit`, `too-long`, `no-active-device`, `not-premium`, `not-linked`, or `unknown`
- **THEN** `errorCooldown` is `0`

#### Scenario: Zero on success
- **WHEN** the effect queues a track successfully
- **THEN** `errorCooldown` is `0`

### Requirement: Restricted Options Grouping
The Request Song effect options SHALL present content filters and request restrictions as two
distinct sections. A `Moderation` section SHALL contain the allow-explicit checkbox and the blocked
terms list. A `Restrictions` section SHALL contain the no-repeat window, the global artist cooldown,
the per-requester artist cooldown, and the maximum track length. The `Troubleshooting` section SHALL
remain last.

The `Moderation` filters SHALL remain post-search gates applied to the single selected candidate;
grouping them under that heading SHALL NOT be taken to mean they are applied to the search query, nor
that a rejected candidate causes the effect to try the next search result.

#### Scenario: Sections presented
- **WHEN** a streamer opens the Request Song effect options
- **THEN** the moderation filters and the request restrictions appear under separate headings
- **AND** the troubleshooting section appears last

#### Scenario: Moderation does not skip to the next candidate
- **WHEN** the selected candidate is rejected by a blocked term or the explicit filter
- **THEN** the effect fails with that reason
- **AND** it does not search again or evaluate another candidate
