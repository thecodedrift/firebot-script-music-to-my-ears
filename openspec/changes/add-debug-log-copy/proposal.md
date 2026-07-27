## Why

When a streamer reports that a song request went wrong, we have no reliable way to see what
happened: the interesting diagnostics are behind a per-effect "Enable logging" checkbox that is off
by default, so by the time the bug is noticed the evidence was never recorded. Firebot's own log
file is also filtered by a global log level the streamer has usually not raised, which is why the
diagnostics we do emit are shouted at `info`. The result is bug reports with no logs and no way to
reproduce them.

Resolves [#21](https://github.com/thecodedrift/firebot-script-music-to-my-ears/issues/21).

## What Changes

- The script keeps its own **in-memory debug log** for the running Firebot session. Every record
  the script logs — at any level, including `debug` — is captured there regardless of Firebot's
  global log level.
- The script configuration page gains a **"Copy debug log" button**. Clicking it puts the whole
  session log on the clipboard, prefixed with a header identifying the script version, the Firebot
  version, the platform, and the current configuration with secrets redacted, ready to paste into a
  bug report.
- The per-effect **"Enable logging" checkbox is removed** from the Request Song effect. Search and
  rejection diagnostics are now always recorded. They move from `info` to `debug`, so Firebot's own
  log file gets *quieter*, while the debug log gets everything.
- This is not a compatibility break: the removed checkbox only ever gated logging, so a saved
  effect keeps working unchanged and simply logs more.

## Capabilities

### New Capabilities
- `debug-log`: an in-memory, session-scoped log of everything the script records, a header that
  identifies the script and host versions and the redacted configuration, and the configuration-page
  button that copies the whole thing to the clipboard.

### Modified Capabilities
- `song-requests`: "Opt-In Request Diagnostics" becomes always-on request diagnostics — the
  checkbox and its default-off behavior are removed, and the records are emitted at `debug`
  instead of `info`.
- `spotify-integration`: the second logging channel is no longer "opt-in"; it is always-on
  detailed diagnostics. Its redaction rules are unchanged, but the reason it may retain user
  content changes from streamer consent to the debug log being local until the streamer copies it.

## Impact

- `src/modules.ts` — the `logger` proxy also records into the buffer.
- New `src/services/debugLog.ts` — the ring buffer, the header, and the snapshot formatter.
- `src/main.ts` — the button parameter, the `frontendCommunicator` handler registered in `run()`
  and removed in `stop()`.
- `src/services/api.ts` — `logAttempt` loses its gate and drops to `debug`.
- `src/firebot/effects/requestSongEffect.ts` — the `enableLogging` model field, its checkbox, its
  default, and the gate around rejection logging are removed.
- No new dependencies. Uses Firebot's existing `copy-to-clipboard` frontend event, the same one
  Firebot's own "Copy Debug Info" button uses.
