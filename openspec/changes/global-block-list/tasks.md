## 1. Reasons and messages

- [x] 1.1 Add `blocked-artist` and `blocked-track` to `ErrorReason` in `src/shared/types.ts`.
- [x] 1.2 Add templates for both to `TEMPLATES` in `src/services/errorText.ts` (`{artistName} is a blocked artist.` / `{trackName} is a blocked track.`) and add them to `ALL_REASONS` in `errorText.test.ts`.

## 2. Classifier and matcher

- [x] 2.1 In `src/services/moderation.ts` add `parseBlockEntry(raw)` classifying a line as `term` (lowercased text), `track`/`artist` (id from a Spotify link/URI), or `id` (bare 22-char base62), returning `undefined` for blank.
- [x] 2.2 Add `parseBlockList(value)` accepting a newline string or a legacy `string[]`, dropping blank lines.
- [x] 2.3 Add `findBlock(track, entries)` returning the first match as `{ kind: term|artist|track, raw }`: terms match the artist+name haystack, `track` matches the id parsed from `track.uri`, `artist` matches any `track.artistIds`, and untyped `id` matches either. Remove `findBlockedTerm`.

## 3. Global parameter

- [x] 3.1 Add `spotifyBlockList: string` to `Params` in `src/types/params.ts` with a doc comment.
- [x] 3.2 Add a `spotifyBlockList` entry to `getDefaultParameters()` in `src/main.ts`: `type: "string"`, `useTextArea: true`, title "Blocked artists, tracks & terms", default `""`.
- [x] 3.3 Add the field to the harness `initModules` call in `tools/spotify/firebotStub.ts`.

## 4. Effect: textarea, migration, merge

- [x] 4.1 Change the `Model.blockedTerms` type to `string | string[]` and replace the `<editable-list>` in the options template with a `<textarea ng-model="effect.blockedTerms">` (one per line).
- [x] 4.2 In the options controller, migrate an existing `string[]` to newline text (`join("\n")`), seed the defaults as newline text on a fresh effect, and leave an emptied `""` alone. Drop the editable-list `blockedTermsSettings`.
- [x] 4.3 In `onTriggerEvent`, build `findBlock(track, [...parseBlockList(getParams().spotifyBlockList), ...parseBlockList(perEffect)])` (per-effect falls back to the defaults only when never set) and reject with the reason mapped from the match kind.
- [x] 4.4 Add `blocked-artist` and `blocked-track` to the Error Reason output description.

## 5. Tests

- [x] 5.1 `moderation.test.ts`: classification of terms, URIs, links (with `intl-` prefix and `?si=`), bare ids; `findBlock` term/track/artist/untyped-id matches, first-match order, legacy `string[]`, and no-match.
- [x] 5.2 Effect tests: per-effect term → `blocked-term`, legacy `string[]` still blocks, global artist link → `blocked-artist` (message names the artist), global track URI → `blocked-track`, and neither list matching queues.
- [x] 5.3 Effect options-controller tests: seeds default newline text, migrates a `string[]`, leaves `""` empty, and the template contains the bound textarea.
- [x] 5.4 Update `main.test.ts` param-key assertion and `runRequest` parameters to include `spotifyBlockList`.

## 6. Verify

- [x] 6.1 Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [x] 6.2 Run `pnpm openspec validate global-block-list --strict` and resolve findings.
- [x] 6.3 Add a changeset (`.changeset/*.md`, minor — new parameter and reasons) describing the global blocklist.
