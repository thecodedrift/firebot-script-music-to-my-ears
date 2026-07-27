## ADDED Requirements

### Requirement: Always-On Request Diagnostics
The Request Song effect SHALL log, for each search attempt it issues, a record containing: the
attempt kind (`filtered` or `raw`), the outgoing `q` value, the resolved request endpoint,
Spotify's total match count and the number of items returned in the page, the full list of returned
candidates, the raw response body, the candidate that was selected, and the validation verdict
including the reason for any failure. The effect SHALL additionally log, for each request it
rejects, a record naming the rejection's `errorReason` and the rejected track, plus the remaining
wait when the reason is a cooldown.

These records SHALL be emitted unconditionally — no per-effect option gates them — and at `debug`
level, so that they always reach the session debug log while leaving Firebot's own log file
unchanged unless the streamer raises its level. Diagnostics SHALL NOT emit the bearer token, the
refresh token, or the client secret.

#### Scenario: Diagnostics need no configuration
- **WHEN** a Request Song effect is newly created and run
- **THEN** its search and rejection diagnostics are logged without any option being enabled
- **AND** no logging option is presented on the effect

#### Scenario: Logging a rejected request
- **WHEN** a request is rejected by moderation or a restriction
- **THEN** one record is logged at `debug` naming the rejection's `errorReason` and the rejected track
- **AND** when the reason is a cooldown, the record includes the remaining wait

#### Scenario: Logging a successful filtered search
- **WHEN** a filtered search succeeds validation
- **THEN** one diagnostic record is logged at `debug` for the `filtered` attempt
- **AND** it contains the outgoing `q`, the total match count, the number of returned items, every returned candidate, the raw response body, the selected candidate, and a passing validation verdict

#### Scenario: Logging both attempts on fallback
- **WHEN** a filtered search fails validation and the raw fallback runs
- **THEN** two diagnostic records are logged: one for the `filtered` attempt carrying the failing validation verdict and its reason, and one for the `raw` attempt
- **AND** the streamer can determine from the logs which attempt produced the queued track

#### Scenario: Total matches distinguished from returned items
- **WHEN** Spotify reports a total of 412 matches and returns a page of 5 items
- **THEN** the diagnostic record reports both values distinctly

#### Scenario: Credentials never logged
- **WHEN** a diagnostic record is written
- **THEN** it contains no bearer token, refresh token, or Spotify client secret

#### Scenario: Diagnostics reach the debug log
- **WHEN** a request is searched or rejected and the streamer later copies the debug log
- **THEN** the search and rejection records for that request are in the copied text

## MODIFIED Requirements

### Requirement: Restricted Options Grouping
The Request Song effect options SHALL present content filters and request restrictions as two
distinct sections. A `Moderation` section SHALL contain the allow-explicit checkbox and the blocked
terms list. A `Restrictions` section SHALL contain the no-repeat window, the global artist cooldown,
the per-requester artist cooldown, and the maximum track length. The `Restrictions` section SHALL
remain last.

The `Moderation` filters SHALL remain post-search gates applied to the single selected candidate;
grouping them under that heading SHALL NOT be taken to mean they are applied to the search query, nor
that a rejected candidate causes the effect to try the next search result.

#### Scenario: Sections presented
- **WHEN** a streamer opens the Request Song effect options
- **THEN** the moderation filters and the request restrictions appear under separate headings
- **AND** the restrictions section appears last

#### Scenario: Moderation does not skip to the next candidate
- **WHEN** the selected candidate is rejected by a blocked term or the explicit filter
- **THEN** the effect fails with that reason
- **AND** it does not search again or evaluate another candidate

## REMOVED Requirements

### Requirement: Opt-In Request Diagnostics
**Reason**: The checkbox defaulted to off, so the records it gated were never captured before the
bug that needed them. The session debug log now captures every record at every level, which makes
the gate both unnecessary and harmful.

**Migration**: None required of the streamer. The "Enable Logging" checkbox disappears from the
Request Song effect and the diagnostics it gated are now always recorded, at `debug` rather than
`info`. A saved effect keeps working; its stored `enableLogging` value is simply no longer read.
See the replacement requirement "Always-On Request Diagnostics".
