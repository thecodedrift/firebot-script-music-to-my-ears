## Context

The bug behind this change: a streamer wanted to block an artist (their Spotify has that artist
blocked) but the only lever was a substring term, which over-matches and does not survive a roster.
Spotify exposes no endpoint for a user's own artist blocks, so the script must own the list.

## Decisions

### One list, classified by shape — not three typed fields
A streamer copies whatever Spotify hands them: an artist link, a track link, or just a word. Asking
them to sort those into separate "artists / tracks / terms" fields is friction and invites
mis-filing. Instead every entry goes in one list and is classified when a request runs:

- `spotify:(track|artist):<id>` URI, or an `open.spotify.com/(track|artist)/<id>` link (tolerating
  the `intl-xx/` locale prefix and any `?si=…` query) → an id block of that kind.
- a bare 22-char base62 id, with no type context → an **untyped** `id` block, matched against the
  track id OR any credited artist id. Shape (length + alphabet) is what tells an id from a word; a
  22-char run of base62 with no spaces is not a plausible blocked term, and the ambiguity is
  resolved safely by matching either.
- everything else → a case-insensitive substring **term**, exactly as before.

### Match artist/track by id, never by name
Names collide and vary by casing/diacritics — the same reason the artist cooldowns already key on
ids. `findBlock` compares an artist entry against `track.artistIds` (any credited artist, so a
blocked artist is caught even as a feature) and a track entry against the id parsed from
`track.uri`. Terms keep matching the `"artist name"` haystack.

### Distinct reasons, generic on the wire
`blocked-artist` and `blocked-track` join `blocked-term` so a streamer can say precisely why. The
match kind maps to the reason (`term`→`blocked-term`, `artist`→`blocked-artist`, `track`→
`blocked-track`); an untyped `id` resolves to `blocked-track` or `blocked-artist` by what it
actually matched. First match wins, in list order, with the global list merged ahead of the
per-effect list — identical precedence to the prior single-term check, still ahead of explicit and
too-long.

### Textarea, with automatic migration off the editable-list
The field carried `string[]` (editable-list). A textarea (one per line) reads and pastes better for
links and is the same shape as the new global param. Migration is two-sided so no one re-enters a
list: the backend `parseBlockList` accepts a `string[]` as well as a newline string, and the effect's
options controller rewrites an existing array to `join("\n")` on open (and seeds the three default
terms as newline text on a fresh effect). An intentionally-cleared field (`""`) is left empty —
"no entries", not "reseed the defaults".

## Risks / Trade-offs

- A term that is coincidentally 22 base62 characters would be read as an id, not a substring. This
  is not a realistic blocked word, and the behavior is documented.
- The classifier does not resolve links to verify the id exists; a mistyped id simply never matches.
  That is strictly safer than guessing.
