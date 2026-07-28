---
"firebot-script-music-to-my-ears": patch
---

Strip a leaked command trigger from a song request. `!sr Toxic by Britney Spears` used to search
Spotify for `track:"!sr Toxic"`, which matches nothing — so every request carrying a trigger burned
its first search and fell back to a raw query that still contained the junk token, leaving the match
to Spotify's ranking. The trigger is now removed first, so the request matches on the real title and
costs one search instead of two. `$arg[all]` is safe to wire straight into the effect.

The rule is deliberately narrow: only the first token, only when a letter follows the `!` (so the
band `!!!` is untouched), and never when nothing would be left to search for.
