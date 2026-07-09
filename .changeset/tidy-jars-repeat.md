---
"firebot-script-music-to-my-ears": minor
---

Normalize song-request searches with Spotify field filters, and add opt-in per-effect logging.

A request shaped `<title> by <artist>` (or `<title> - <artist>`) is now sent to Spotify as
`track:"<title>" artist:"<artist>"` instead of as one free-text blob, which stops artist words from
competing with track titles for rank. `seven dollars by happy birthday mr baskets` narrows from 13
loosely-related matches to the 1 correct one.

The split only happens when the separator appears exactly once, and the result is validated by
whole-token containment before it is accepted — so a title that contains the separator, like
`Stand By Me`, is caught and retried once with the raw query rather than queuing the wrong song.
Any query that does not split, or whose filtered result fails validation, behaves exactly as before.

The Request Song effect also gains an **Enable logging** checkbox (default off). When on, it logs
each search attempt: the query sent to Spotify, the total number of matches, every candidate
returned, which one was selected, and the raw response — enough to diagnose a wrong match after the
fact. It is verbose by design, which is why it is opt-in.
