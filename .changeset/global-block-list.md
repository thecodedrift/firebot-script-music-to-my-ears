---
"firebot-script-music-to-my-ears": minor
---

Add a global blocklist for artists, tracks, and terms. A new script setting takes one entry per
line, applied to every song request on top of each Request Song effect's own list. Paste a Spotify
artist or track link (or URI) to block that exact artist or track by id — so you can ban an artist
without banning their name as a word — or type any other line as a case-insensitive term matched
against the artist and track names. The per-effect blocked-terms field becomes the same one-per-line
textarea and accepts links too; effects saved with the old list upgrade automatically. Blocks now
report `blocked-artist` or `blocked-track` (alongside the existing `blocked-term`) so you can tell a
viewer exactly why their request was turned away.
