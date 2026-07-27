## 1. The debug log buffer

- [x] 1.1 Add `src/services/debugLog.ts` with a bounded ring buffer: `record(level, message, meta)`, `entries()`, `clear()`, enforcing the 2000-record / 1 MB / 16 KB-per-record caps with oldest-first eviction and a truncation marker
- [x] 1.2 Record into the buffer from the `logger` proxy in `src/modules.ts`, capturing before forwarding to Firebot so a forwarding failure cannot lose the record
- [x] 1.3 Add `src/services/debugLog.test.ts` covering every level captured, oldest-first eviction at each bound, per-record truncation with its marker, and capture surviving a throwing Firebot logger

## 2. The snapshot header

- [x] 2.1 Stash the Firebot version in `src/modules.ts` (from `runRequest.firebot.version`) so the header can report it
- [x] 2.2 Add the snapshot formatter to `debugLog.ts`: script version, Firebot version, OS and Node version, then the configuration summary (client id and secret as set/not-set, Country of Play verbatim, blocklist as an entry count), then the records — with an explicit note when no records were captured
- [x] 2.3 Test the header: version present, credentials reported as set without their values appearing anywhere in the snapshot, blocklist reported as a count, empty-log note

## 3. The configuration-page button

- [x] 3.1 Add the button parameter to `getDefaultParameters()` in `src/main.ts` as the last parameter, with `backendEventName: "music-to-my-ears:copy-debug-log"`, and text naming the script version and what gets copied
- [x] 3.2 Add the corresponding field to `Params` in `src/types/params.ts`, documented as a UI-only control that carries no value
- [x] 3.3 Register the handler with `frontendCommunicator.onAsync` in `run()`, answering with `frontendCommunicator.send("copy-to-clipboard", { text, toastMessage })`; keep the returned id and `off()` it in `stop()`, and clear the buffer in `stop()`
- [x] 3.4 Extend `src/main.test.ts`: the button parameter exists and is last, the handler is registered in `run()`, `stop()` unregisters it and clears the buffer, and invoking the handler sends `copy-to-clipboard` with the snapshot

## 4. Remove the per-effect logging toggle

- [x] 4.1 Drop the gate in `logAttempt` in `src/services/api.ts`, emit at `debug` instead of `info`, remove `SearchOptions.log` and its plumbing through `searchTrack`, and rewrite the channel comment to describe the two channels as they now are
- [x] 4.2 Remove `enableLogging` from the effect model, the `Troubleshooting` container, and the `optionsController` default in `src/firebot/effects/requestSongEffect.ts`; make `reject()` log unconditionally at `debug` and update its comment
- [x] 4.3 Update `src/services/api.test.ts` and `src/firebot/effects/requestSongEffect.test.ts` for the removed option: diagnostics assert on `debug` and no longer pass `log`, and the checkbox assertions become assertions that no logging option is rendered

## 5. Docs and release

- [x] 5.1 Update `README.md` where it documents the "Enable logging" checkbox, describing the debug log and the copy button instead
- [x] 5.2 Add a `patch` changeset describing this as a fix for missing logs in bug reports
- [x] 5.3 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm openspec validate add-debug-log-copy --strict`
