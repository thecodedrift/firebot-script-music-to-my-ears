## Context

Bug reports about song requests arrive without evidence. Two things cause that:

1. The detailed search/rejection diagnostics are gated behind a per-effect "Enable logging"
   checkbox that defaults to off, so the interesting records are never written until *after* the
   streamer has already hit the bug and been asked to turn it on and reproduce.
2. Firebot's log file only shows `debug` records when the streamer raises the global log level.
   That is why the diagnostics we do emit are pushed out at `info` — a workaround that makes the
   Firebot log noisy for everyone in exchange for being visible to the few.

Issue #21 asks for the script version and a copyable dump of the session's logs on the script
configuration page, and notes that a central log makes the per-effect toggle unnecessary.

Firebot's configuration page constrains how that dump can be surfaced. Reading
`src/gui/app/directives/controls/custom-script-settings.js` in the Firebot source: when the page
opens, Firebot **deletes the require cache and re-`require()`s the bundle in the renderer
process**, then calls `getDefaultParameters({ modules: {} })`. That call therefore runs in a fresh
module instance of our script, in a different process from the one `run()` executes in, with no
Firebot modules. It cannot read anything the running script holds in memory.

Two useful facts fall out of the same code. `getScriptManifest().version` is already rendered next
to the script name in that page's header, and parameter `title`, `description`, and `tip` are run
through `marked` + DOMPurify, so they can carry formatted text. And Firebot's own "Copy Debug Info"
button (`src/backend/common/debug-info.ts`) works by sending the frontend event
`copy-to-clipboard` with `{ text, toastMessage }` — a listener registered globally in
`app-main.js`, available to any backend code including a script.

## Goals / Non-Goals

**Goals:**

- Every record the script logs during a Firebot session is retained and retrievable, whatever the
  streamer's Firebot log level is.
- Getting that log into a bug report is one click from the script configuration page, and the
  result identifies the script version it came from.
- Firebot's own log file gets quieter, not louder.
- Delete the per-effect toggle rather than leave two overlapping mechanisms.

**Non-Goals:**

- Persisting the log to disk. Clipboard only; the log lives and dies with the Firebot session.
- A live rendering of the log inside the configuration page. As established above, that page
  cannot reach the running script's memory.
- Reworking the existing redaction rules. The invariant that no bearer token, refresh token, or
  client secret is ever logged is unchanged and still enforced where it is enforced today.

## Decisions

### A button that copies, not a text area that displays

Issue #21 asks for a default-hidden text area holding the logs. That is not implementable: the
configuration page evaluates `getDefaultParameters` in a separate process from the running script,
so there is nothing to put in the text area. A `useTextArea` string parameter is worse than
useless here — its value is persisted into the saved script settings, so it would both bloat the
settings file and show a snapshot that is stale the moment it is written.

Instead the page gets a `button` parameter whose `backendEventName` reaches the running script,
which answers by sending Firebot's `copy-to-clipboard` event. This is the same mechanism as
Firebot's own Copy Debug Info button, it delivers exactly the outcome the issue is after ("ask
people to post their logs"), and it is one click instead of select-all-and-copy.

Rejected alternative: have the backend write a file and have `getDefaultParameters` read it back
in the renderer to render into a `<details>` block. It would display the log, but it needs the two
processes to agree on a path neither is told about, and it writes to disk for a benefit the
clipboard already provides.

### The buffer lives in the `logger` proxy

`src/modules.ts` already proxies every log call the script makes. Recording there means capture is
automatic and total: no call site has to opt in, and nothing can be added later that forgets to.
The proxy records first and forwards second, so a record is captured even if forwarding to Firebot
fails.

### Bounded by characters, not just by lines

A single search diagnostic carries the raw Spotify response and can run to tens of kilobytes, so a
line count alone does not bound memory. The buffer therefore caps three ways: at most 2000
records, at most 1 MB of text in total, and any single record truncated at 16 KB with an explicit
marker naming how much was dropped. Oldest records are evicted first. A ten-hour session with a
request every two minutes is a few thousand records, so the caps sit above normal use and exist to
stop a pathological session from growing without bound — and to keep the copied result something a
human can actually paste somewhere.

### Diagnostics move from `info` to `debug`

The comment in `api.ts` is explicit that `info` was chosen only because Firebot hides `debug`.
Once the script's own buffer captures every level, that reason is gone. Emitting at `debug` means
the records always reach the debug log while Firebot's log file stays clean unless the streamer
deliberately raises the level.

### The header is part of the snapshot, not part of the buffer

Version, host, and configuration are captured when the log is copied, not when it is recorded, so
the snapshot describes the state the streamer is reporting from. The configuration is summarized,
not dumped: the client secret and client id are reported as set/not-set rather than by value, the
Country of Play is shown verbatim, and the blocklist is reported as a line count. The script
version is baked in at build time via `__SCRIPT_VERSION__`, so it is available in both processes —
the header carries it, and the configuration page text carries it too.

## Risks / Trade-offs

- **The log is lost when Firebot restarts** → Accepted, and it is the direct consequence of the
  clipboard-only decision. The bug being reported is almost always still reproducible in the
  session where it happened, which is when the streamer copies.
- **Always-on diagnostics could leak something the opt-in gate used to contain** → The gate never
  protected against this: the redaction invariant is what protects credentials, and it is
  unchanged and still covered by tests. What does change is that the query text and raw response
  bodies are now always in memory. They stay local until the streamer chooses to copy them, and
  the header states what the dump contains.
- **A very long session's copy is large** → Bounded to ~1 MB by the caps above, with the oldest
  records dropped first, which are the least likely to describe the bug being reported.
- **Removing `enableLogging` orphans the field on saved effects** → Harmless. Firebot stores the
  effect model as-is; an unread extra field is ignored, and nothing in the script reads it after
  this change.
