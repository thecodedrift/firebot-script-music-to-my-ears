## ADDED Requirements

### Requirement: Session Debug Log
The script SHALL retain, in memory, every record it logs for the lifetime of the Firebot session,
independently of Firebot's configured log level. Capture SHALL happen in the shared logger proxy so
that no call site can opt out of it or forget to opt in, and SHALL record the record's level, its
message, and any structured metadata supplied with it, stamped with the time it was recorded.

The log SHALL be bounded so that a long or pathological session cannot grow it without limit: at
most 2000 records, at most 1 MB of text in total, and any single record longer than 16 KB truncated
with a marker stating how much was dropped. When a bound is reached the oldest records SHALL be
dropped first.

The log SHALL be cleared when the script stops, consistent with the script's teardown requirement
that all in-memory state is released.

#### Scenario: Debug records are retained regardless of log level
- **WHEN** the script logs a record at `debug` and Firebot's global log level hides `debug`
- **THEN** the record is still present in the session debug log

#### Scenario: Every level is captured
- **WHEN** the script logs records at `debug`, `info`, `warn`, and `error`
- **THEN** all four are present in the session debug log, each labeled with its level

#### Scenario: Capture does not depend on Firebot accepting the record
- **WHEN** forwarding a record to Firebot's logger throws
- **THEN** the record has already been captured in the session debug log

#### Scenario: Oldest records are dropped at the bound
- **WHEN** the number of records or the total retained text exceeds the bound
- **THEN** the oldest records are dropped until the log is within the bound

#### Scenario: An oversized single record is truncated
- **WHEN** a single record exceeds the per-record size limit
- **THEN** the retained record is truncated and carries a marker stating how many characters were dropped

#### Scenario: Stopping clears the log
- **WHEN** Firebot calls `stop()`
- **THEN** the session debug log is empty

### Requirement: Debug Log Snapshot Header
A copied debug log SHALL be prefixed with a header describing the state it was copied from,
assembled at copy time rather than at record time. The header SHALL identify the script version,
the Firebot version, the operating system and Node version, and the current script configuration.

The configuration SHALL be summarized, never dumped: the Spotify client id and client secret SHALL
be reported only as set or not set, the Country of Play SHALL be reported verbatim, and the global
blocklist SHALL be reported as a count of entries. The header SHALL NOT contain the client secret,
the client id, the access token, or the refresh token.

#### Scenario: Header identifies the script version
- **WHEN** the debug log is copied
- **THEN** the header names the script version that produced it

#### Scenario: Header identifies the host
- **WHEN** the debug log is copied
- **THEN** the header names the Firebot version, the operating system, and the Node version

#### Scenario: Credentials are summarized, not disclosed
- **WHEN** the debug log is copied and a client id and secret are configured
- **THEN** the header reports each as set
- **AND** the header contains neither value

#### Scenario: Configuration is summarized
- **WHEN** the debug log is copied and the global blocklist has entries
- **THEN** the header reports how many entries it has, not their contents
- **AND** the header reports the configured Country of Play verbatim

### Requirement: Copy Debug Log From Script Configuration
The script configuration page SHALL offer a button that copies the header and the full session
debug log to the clipboard, so a streamer can paste it into a bug report in one action. The button
SHALL be the last parameter on the page, and its accompanying text SHALL state the script version
and what the copied text contains.

Clicking the button SHALL reach the running script, which SHALL answer by asking Firebot to place
the text on the clipboard and confirm to the streamer that it was copied. The handler SHALL be
registered during `run()` and unregistered during `stop()`.

The script SHALL NOT attempt to render the log itself on the configuration page. Firebot evaluates
a script's parameters by re-loading the bundle in a separate process with no modules supplied, so
that process cannot reach the running script's state.

#### Scenario: Copying the log
- **WHEN** the streamer clicks the copy button on the script configuration page
- **THEN** the header and the session debug log are placed on the clipboard
- **AND** Firebot confirms the copy to the streamer

#### Scenario: Version is visible on the configuration page
- **WHEN** the streamer opens the script configuration page
- **THEN** the script version is shown there

#### Scenario: Handler is torn down
- **WHEN** Firebot calls `stop()`
- **THEN** the copy handler registered during `run()` is unregistered

#### Scenario: Copying an empty log
- **WHEN** the streamer clicks the copy button and the script has logged nothing
- **THEN** the header is still copied, with an explicit note that no records were captured
