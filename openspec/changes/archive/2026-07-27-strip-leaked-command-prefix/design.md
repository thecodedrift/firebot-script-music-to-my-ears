## Context

`searchTrack` receives whatever text the streamer wired into the effect's query field — usually
`$arg[all]` or `$redemptionMessage`. Neither is guaranteed to have the command trigger removed:
`$arg[all]` on a command that passes the raw message, a viewer who types `!sr` inside a
channel-point reward's text, or a viewer who repeats the trigger out of habit all deliver it
intact.

Nothing downstream copes with that. `normalizeQuery` splits on `by` and quotes each side, so the
trigger ends up **inside** the quoted title filter, where Spotify matches it literally and returns
zero results. The raw fallback then runs with the trigger still present.

## Goals / Non-Goals

**Goals:**

- A leaked trigger costs nothing: the filtered attempt matches on the real title, and the request
  resolves in one search rather than two.
- The rule is narrow enough that no legitimate query is damaged by it.

**Non-Goals:**

- Knowing which triggers the streamer has configured. The script registers no commands and is not
  told what invoked the effect, so this is a shape rule, not a lookup.
- Stripping triggers anywhere but the front. A `!` in the middle of a query is part of the title
  (`Hello! by Someone`), and removing it would be the bug this change is trying to avoid.

## Decisions

### Require a letter after the bang

The rule is `^!\p{L}[\p{L}\p{N}]*` on the first token. Requiring a letter immediately after the `!`
is what protects the band **`!!!`** — a real artist whose name is exactly three bangs, and whose
albums (`!!! - Louden Up Now`) would otherwise be mangled into a query starting with a bare `-`.
`!sr` matches; `!!!` does not.

Alternatives rejected: stripping any leading `!`-prefixed token (breaks `!!!`); stripping a
configurable list of triggers (the script cannot know them); stripping every `!` in the query
(destroys titles like `Hello!` and artists like `Panic! At The Disco`).

### Strip only when something remains

`!sr` on its own leaves nothing to search for. Rather than issue an empty search, the query is left
untouched and the existing "not found" path handles it — the viewer gets the normal not-found
message rather than a silent no-op with a different cause.

### Strip in `searchTrack`, above the id check

Placing it above `parseTrackId` means `!sr https://open.spotify.com/track/…` is recognized as the
direct lookup it is, instead of being searched as text. Placing it in `searchTrack` rather than in
`normalizeQuery` means both the filtered attempt and the raw fallback see the cleaned query — the
fallback carrying the trigger is half of the current bug.

## Risks / Trade-offs

- **A track whose title genuinely begins with `!word`** → It would lose that token. No such title
  is known, the token would have to be first, and the raw fallback still searches the remainder.
  Weighed against leaked triggers, which are common, this is the better trade.
- **The stripped token is invisible in the outputs** → The stripped prefix is logged at `debug` with
  the resulting query, so a surprising match can still be traced to what was actually searched.
