## Why

When a viewer's command trigger leaks into the query — `!sr Walk The Dinosaur by Ninja Sex Party`,
which happens whenever a command is configured to pass the whole message through, or a viewer
repeats the trigger inside a channel-point message — the `!sr` is carried into the Spotify search.
The filtered attempt becomes `track:"!sr Walk The Dinosaur"`, which matches **nothing**, so every
such request wastes a request on a guaranteed-empty search and falls through to the raw query,
which still contains the junk token. The result is then whatever Spotify's raw ranking makes of it.

Refs [#23](https://github.com/thecodedrift/firebot-script-music-to-my-ears/issues/23).

## What Changes

- A leading command trigger is stripped from the query before anything else looks at it: a first
  token of `!` followed by a letter, e.g. `!sr`, `!songrequest`, `!request`.
- Stripping is deliberately narrow. It applies only to the **first** token, only when the bang is
  followed by a **letter**, and only when text remains afterwards — so the band `!!!` and a query
  that is nothing but punctuation are left alone.
- Applies ahead of link/URI detection too, so `!sr https://open.spotify.com/track/…` resolves as
  the direct track lookup it is.

## Capabilities

### Modified Capabilities
- `song-requests`: adds a normalization step ahead of the existing query normalization, defining
  what counts as a leaked command trigger and what is deliberately left alone.

## Impact

- `src/services/api.ts` — a `stripCommandPrefix` helper, applied at the top of `searchTrack`.
- No parameters, no effect options, no outputs change. A request that already worked is unaffected;
  a request carrying a trigger now costs one search instead of two and matches on the real title.
