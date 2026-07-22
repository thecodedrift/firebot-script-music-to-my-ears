## Why

Spotify has no API that exposes a user's own "don't play this artist" blocks, so the script cannot
honor them — a viewer's request for a blocked artist is queued silently and the streamer never
learns why their own preferences were ignored. Today the only tool is the per-effect blocked-terms
list, which matches names as substrings: banning an artist means banning their name as a word, which
is brittle (it also catches unrelated tracks) and unmaintainable across a roster. There is also no
way to set one policy that applies to every Request Song effect at once.

## What Changes

- A new **global blocklist** script parameter, a textarea with one entry per line, defaulting to
  empty (blocks nothing). It applies to every song request, merged with each effect's own list.
- Each blocklist line is **classified by shape**, so a streamer pastes whatever they have:
  - a Spotify **artist** link/URI (e.g. `https://open.spotify.com/artist/<id>` or
    `spotify:artist:<id>`) blocks that exact artist by id — banning the artist without banning
    their name as a word;
  - a Spotify **track** link/URI blocks that exact track by id;
  - a bare 22-char id (no `track:`/`artist:` context) blocks whichever it names — the track id or
    any credited artist id;
  - anything else is a **term**, matched case-insensitively as a substring of the artist or track
    name (today's behavior).
- The per-effect **blocked-terms** field becomes the same one-per-line textarea and is run through
  the same classifier, so an artist/track link works there too. Effects saved as an editable-list
  (`string[]`) are **migrated automatically**: the backend still accepts an array, and the options
  controller rewrites it to newline text on open.
- Two new `errorReason` values, **`blocked-artist`** and **`blocked-track`**, so a streamer can tell
  a viewer exactly why ("that artist is blocked") instead of the generic term message. A term match
  still reports `blocked-term`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `song-requests`: the substring-only moderation requirement is generalized to a blocklist that
  classifies each entry (term, artist, or track), matches artist/track entries by Spotify id, merges
  a new global list with the per-effect list, and reports `blocked-artist` / `blocked-track` in
  addition to `blocked-term`. The per-effect field becomes a one-per-line textarea that still
  accepts a legacy `string[]`.

## Impact

- Code: `src/services/moderation.ts` (entry classifier `parseBlockEntry` / `parseBlockList` and
  id-aware `findBlock`, replacing `findBlockedTerm`); `src/shared/types.ts` (+`blocked-artist`,
  `blocked-track`); `src/services/errorText.ts` (messages for the two reasons); `src/types/params.ts`
  and `src/main.ts` (global `spotifyBlockList` textarea param); `src/firebot/effects/requestSongEffect.ts`
  (textarea + array→text migration; merge global + per-effect; map match kind to reason);
  `tools/spotify/firebotStub.ts` (harness param).
- Tests: `src/services/moderation.test.ts` (classification and id/term matching), effect tests for
  the three block reasons and the legacy-array migration, `errorText`/`main` reason and param
  updates.
- Behavior: default (empty global list, unchanged per-effect terms) is a no-op — existing effects
  keep working, their term arrays upgrade in place with no re-entry. Composes with the relevance
  ranking and Country of Play changes already shipped.
