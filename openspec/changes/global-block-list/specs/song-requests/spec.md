## RENAMED Requirements

- FROM: `### Requirement: Substring Moderation`
- TO: `### Requirement: Blocklist Moderation`

## MODIFIED Requirements

### Requirement: Blocklist Moderation
The Request Song effect SHALL reject a matched track when it is caught by a blocklist. Two
blocklists apply and SHALL be merged for each request: a **global** blocklist configured in the
script settings, applied to every request, and the **per-effect** list configured on each Request
Song effect. The global list SHALL take precedence: the merged list is the global entries followed
by the per-effect entries, and the first matching entry decides the outcome.

Each blocklist is one entry per line. Every entry SHALL be classified by shape:

- an entry that is a Spotify **track** link or URI (`spotify:track:<id>`, or a
  `open.spotify.com/track/<id>` URL, tolerating a `intl-xx/` locale segment and any query string)
  SHALL match a track by comparing the id to the id of the matched track;
- an entry that is a Spotify **artist** link or URI SHALL match when the id is any of the matched
  track's credited artist ids;
- a bare 22-character Spotify id with no `track:`/`artist:` context SHALL match when it equals the
  track id or any credited artist id;
- any other entry SHALL be treated as a **term** and match when it appears, as a case-insensitive
  substring, in the track's artist name or track name.

When a term matches, the effect SHALL output `errorReason: blocked-term`. When an artist entry (or a
bare id resolving to an artist) matches, it SHALL output `errorReason: blocked-artist`. When a track
entry (or a bare id resolving to a track) matches, it SHALL output `errorReason: blocked-track`. In
every case the track SHALL NOT be queued.

The global blocklist parameter SHALL default to empty, which blocks nothing. The per-effect list
SHALL ship pre-filled with the editable default terms `karaoke`, `instrumental`, and `inst.`, SHALL
be entered as text with one entry per line, and SHALL still accept a value saved as a list of terms
by an earlier version (each list element is treated as one entry), so existing effects keep working
without re-entry. An emptied per-effect list SHALL mean "no entries" rather than reverting to the
defaults.

#### Scenario: Blocked term present
- **WHEN** a matched track's artist or track name contains a configured blocked term as a substring (case-insensitive)
- **THEN** the effect outputs `success: false` and `errorReason: blocked-term`
- **AND** the track is not queued

#### Scenario: Default blocked terms
- **WHEN** the streamer has not modified the per-effect blocked list
- **THEN** `karaoke`, `instrumental`, and `inst.` are in effect as default terms

#### Scenario: Global list applies to every effect
- **WHEN** the global blocklist contains an entry that matches the track, and the per-effect list does not
- **THEN** the request is rejected, because the two lists are merged

#### Scenario: Blocked artist by link
- **WHEN** an entry is a Spotify artist link or URI whose id is one of the matched track's credited artist ids
- **THEN** the effect outputs `success: false` and `errorReason: blocked-artist`
- **AND** the track is not queued, even though the artist's name was never banned as a term

#### Scenario: Blocked track by link
- **WHEN** an entry is a Spotify track link or URI whose id equals the matched track's id
- **THEN** the effect outputs `success: false` and `errorReason: blocked-track`
- **AND** the track is not queued

#### Scenario: Bare id resolves by what it names
- **WHEN** an entry is a bare 22-character Spotify id with no `track:`/`artist:` context
- **THEN** it matches when the id equals the track id or any credited artist id
- **AND** the reason reported is `blocked-track` or `blocked-artist` respectively

#### Scenario: Legacy list value still blocks
- **WHEN** a Request Song effect was saved by an earlier version with its blocked terms as a list of strings
- **THEN** each element is treated as one blocklist entry and the term match still applies

#### Scenario: Empty means block nothing
- **WHEN** the global blocklist is empty and the per-effect list has been emptied
- **THEN** no entry blocks the track and moderation proceeds to the remaining checks
