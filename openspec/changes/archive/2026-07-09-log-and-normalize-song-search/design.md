## Context

`searchTrack()` (`src/services/api.ts:235-260`) forwards the viewer's raw text as Spotify's `q`
and returns the first item. Spotify's `/v1/search` ranks the whole phrase against track titles,
album titles, and artist names at once, so extra words actively hurt: the observed failure was
`seven dollars by happy birthday mr baskets` resolving to an unrelated track even though
`seven dollars` alone resolves correctly.

Two constraints shape the design:

1. **Nothing is observable today.** The only non-error log on the search path is a `debug` line
   emitted when *zero* playable results come back. A wrong-but-present result logs nothing.
2. **`is_playable` is a no-op here.** Per the Spotify docs, `is_playable` is returned only when
   track relinking applies, which requires a `market` parameter. We deliberately send none
   (`api.ts:170-177`), correctly, because a user access token supplies the account country. The
   consequence is that `items.find((i) => i.is_playable !== false)` at `api.ts:248` is always
   `items[0]`, and `SEARCH_LIMIT = 5` fetches four results we throw away. Three comments assert
   otherwise (`api.ts:179-183`, `api.ts:249-256`, and `src/types/spotify.ts:36-39`, which claims
   `we use from_token`).

## Goals / Non-Goals

**Goals:**

- Make a wrong match diagnosable after the fact, without making the default logs noisy.
- Raise match quality for the common `<title> by <artist>` and `<title> - <artist>` request shapes.
- Never regress a query that works today: every normalization path can fall back to the raw query.
- Correct the three comments that misdescribe `is_playable` selection.

**Non-Goals:**

- Changing which candidate is selected from a result set (still `items[0]`). The `is_playable`
  behavior fix — sending `market` and genuinely ranking five candidates — is deferred to a
  separate change, at the user's direction.
- Adding a `market` parameter.
- Persisting logs anywhere other than Firebot's logger.
- Fuzzy/phonetic matching, spell correction, or a local track cache.

## Decisions

### D1: Split only on an unambiguous separator, exactly once

Split `<title> <sep> <artist>` when the separator occurs **exactly once**:

- `by` — matched as a whole word, case-insensitive (`/\bby\b/gi`).
- `-` — matched only as a **spaced** hyphen (` - `), so `Jay-Z` and `Blink-182` never split.

Zero occurrences, or two or more, means no split: use the raw query. Both sides must be non-empty
after trimming, else no split.

*Alternative rejected:* a filler-word stoplist (strip `by`, `the`, punctuation). It does not
address the actual problem, which is title tokens competing with artist tokens for rank — not the
presence of the word `by`.

*Accepted ambiguity:* for the dash form, `Title - Artist` and `Artist - Title` are both real-world
conventions and indistinguishable syntactically. We assume **title first**, matching the `by` form,
and let D3's validation catch the miss and fall back to raw. See Open Questions.

### D2: Quoted field filters

Emit `q=track:"<title>" artist:"<artist>"`. Any `"` inside a value is stripped before quoting, so
a user cannot break out of the filter or inject a second filter.

Spotify's documented example is **unquoted** — `q=remaster track:Doxy artist:Miles Davis` — and the
docs never state how a multi-word filter value binds. Unquoted, `artist:Miles Davis` plausibly
parses as `artist:Miles` plus free-text `Davis`. Quoting is the widely-used convention and is the
only form with unambiguous semantics for multi-word values, so we use it.

This is an **assumption, not a documented guarantee**. It is precisely why the opt-in logging in
D4 records the outgoing `q` alongside the raw response: the first real-world logs will confirm or
refute it against live Spotify behavior.

If the query already contains a `:` filter (`track:`, `artist:`, `album:`, `year:`, `genre:`,
`isrc:`, `upc:`, `tag:`), skip normalization entirely and pass it through — the requester is
already speaking Spotify's query language.

### D3: Validation is the gate; the split rule stays dumb

After the filtered search returns, validate the selected candidate by **token containment**:

- Normalize both sides: lowercase, strip diacritics, strip punctuation, collapse whitespace,
  split on whitespace into a token set.
- **Every** token of the parsed title must appear in the token set of the result's `name`.
- **Every** token of the parsed artist must appear in the union of the token sets of the result's
  `artists[].name`.

Token containment, not substring containment. Substring matching on short tokens is unsafe: the
parsed artist `me` from `Stand By Me` is a substring of `Mestizo` but is not one of its tokens.

Worked examples:

| Query | Split | Result checked | Verdict |
|---|---|---|---|
| `seven dollars by happy birthday mr baskets` | `seven dollars` / `happy birthday mr baskets` | *Seven Dollars* — Happy Birthday Mr. Baskets, Kasane Teto | title `{seven,dollars}` ⊆ name; artist `{happy,birthday,mr,baskets}` ⊆ artists → **pass** |
| `Stand By Me` | `Stand` / `Me` | *Stand* — some unrelated artist | artist `{me}` ⊄ `{ben,e,king}` → **fail → raw fallback** |
| `Toxic - Britney Spears` | `Toxic` / `Britney Spears` | *Toxic* — Britney Spears | **pass** |

Containment is directional (parsed ⊆ actual), so Spotify's decorations survive: the result
`Seven Dollars - 2024 Remaster` still contains `{seven, dollars}`.

*Trade-off:* a requester who adds words the real title lacks (`seven dollars song by ...`) fails
validation and falls back to raw — i.e. to exactly today's behavior. Conservative by construction.

### D4: One options flag, logged at `info`

`searchTrack(query, options?: { log?: boolean })` — an optional trailing argument, so
`getCurrentTrackEffect` and the other existing callers are untouched.

Opt-in diagnostics emit at **`info`**, not `debug`. Firebot suppresses `debug` unless the streamer
raises the global log level, which would defeat a per-effect checkbox: turning the box on must be
sufficient to see the output.

Each attempt logs one structured record: the attempt kind (`filtered` | `raw`), the outgoing `q`,
the resolved endpoint, `tracks.total` (Spotify's total match count) **and** `items.length` (what
this page returned — the two differ, and only the former answers "total # of possible matches"),
the full candidate list projected to `{uri, name, artists, explicit, is_playable}`, the raw
response body, the selected candidate, and the validation verdict with the reason it failed.

`SpotifySearchResponse` gains `tracks.total` and `tracks.limit`.

### D5: Two logging channels, one redaction rule each

`redactEndpoint()` / `REDACTED_PARAMS` exist so the **always-on** failure-triage block in
`spotifyFetch` is safe to paste into a GitHub issue — it scrubs `q`, `uri`, `uris`. That channel is
unchanged and stays redacted.

The new diagnostics are a **separate, opt-in** channel emitted by `searchTrack`, not by
`spotifyFetch`. Its entire purpose is to show the query text and the response, so it deliberately
does **not** redact them — the streamer opted in, and the data is their own viewer's request.

The invariant that binds both channels: **neither ever emits the bearer token, the refresh token,
or the client secret.** Diagnostics log the endpoint and body only; they never touch
`options.headers`.

## Risks / Trade-offs

- **Quoted filter syntax is undocumented (D2)** → Validation (D3) plus the raw fallback means a
  wrong guess degrades to today's behavior rather than breaking search. The logs are instrumented
  specifically to settle this against live responses.
- **Dash order assumed title-first (D1)** → `Artist - Title` requests fail validation and fall back
  to raw, costing one extra API call and landing on current behavior. No regression.
- **Up to 2 search calls per request** → Only when a split applies *and* validation fails. Spotify
  rate limits are per-app rolling-window; a song-request effect is human-paced. Accepted.
- **Opt-in logs are verbose and contain viewer-submitted text** → Default off, `info` level, and
  the checkbox copy states it is verbose and intended for troubleshooting.
- **`optionsController` runs eval'd on the frontend** → The `enableLogging` default must be seeded
  with a literal (`false`), never a bundled import. Same trap already documented at
  `requestSongEffect.ts:97-101`.
- **Comment-only fix leaves a latent bug (D-none)** → `SEARCH_LIMIT = 5` keeps fetching four
  unused results. Deliberate, per the user's scoping call; the corrected comments name it so the
  next reader is not misled, and the diagnostics will quantify how often `items[0]` is wrong.

## Migration Plan

No migration. The checkbox defaults off, so existing effects behave identically except for
normalization, which is itself fallback-guarded. Rollback is a revert; no persisted state or
schema is touched.

## Open Questions

- **Dash order.** Should a failed title-first dash split retry as `Artist - Title` before falling
  back to raw? It would cost a third API call. Deferred: ship title-first, let the logs show how
  often dash queries fall back, and revisit with data.
- **Filter-passthrough scope.** Skipping normalization when the query contains any `<field>:` token
  (D2) assumes a requester typing `artist:` means it. If viewers paste colons casually
  (`Chapter 1: The End`), this over-triggers. The `:` must be preceded by a known field name to
  count — worth confirming once logs show real query shapes.
