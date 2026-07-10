/**
 * In-memory record of queued tracks, used for the no-repeat check, the artist
 * cooldowns, and requester attribution. Not persisted across restarts; cleared
 * on stop().
 *
 * One map, three keyspaces (see the key builders below). A single map is chosen
 * over three for simplicity, and because it reads as one registry when debugging
 * why a request was blocked. The cost of that choice: nothing in the type system
 * stops `requesterOf()` being handed an `artist:` key. It is only meaningful for
 * a `track:` key, and callers must respect that.
 */
interface LedgerEntry {
  requestedBy: string;
  ts: number;
}

const entries = new Map<string, LedgerEntry>();

/** Ledger key for a track URI. The only key `requesterOf` may be given. */
export function trackKey(uri: string): string {
  return `track:${uri}`;
}

/** Ledger key for an artist, gating that artist for every requester. */
export function artistKey(artistId: string): string {
  return `artist:${artistId}`;
}

/**
 * Ledger key for one requester's use of one artist. The username is lowercased
 * so Twitch's display-name/login casing resolves to a single bucket.
 */
export function userArtistKey(username: string, artistId: string): string {
  return `user-artist:${username.toLowerCase()}:${artistId}`;
}

/**
 * Records a successfully queued track: the track key, and — when the track has a
 * primary artist — the artist key and the requester-artist key.
 *
 * Writes are UNCONDITIONAL, on purpose. Cooldown windows are configured per
 * effect, and every effect shares this ledger. If an effect with its artist
 * cooldown disabled skipped writing artist keys, tracks queued through it would
 * not count toward a stricter effect's window, silently punching a hole in it.
 * Windows gate reads only.
 */
export function record(
  uri: string,
  requestedBy: string,
  primaryArtistId?: string,
  now: number = Date.now()
): void {
  const entry: LedgerEntry = { requestedBy, ts: now };
  entries.set(trackKey(uri), entry);

  if (!primaryArtistId) {
    return;
  }
  entries.set(artistKey(primaryArtistId), entry);
  // A blank requester means a non-user trigger (a timer, a startup event). Those
  // must not share one `user-artist::<id>` bucket, so no per-requester key is
  // written and the per-requester gate never fires for them.
  if (requestedBy) {
    entries.set(userArtistKey(requestedBy, primaryArtistId), entry);
  }
}

/**
 * Milliseconds remaining before `key` leaves its cooldown window. Returns 0 when
 * the key was never recorded, when the window has already elapsed, or when the
 * window is 0 or less (which disables the check).
 *
 * Returns the remaining time rather than a boolean because two callers need the
 * number: `errorCooldown`, and the tie-break that reports the longest-remaining
 * cooldown when several apply at once.
 */
export function remainingMs(key: string, windowMs: number, now: number = Date.now()): number {
  if (windowMs <= 0) {
    return 0;
  }
  const entry = entries.get(key);
  if (entry === undefined) {
    return 0;
  }
  return Math.max(0, entry.ts + windowMs - now);
}

/**
 * The requester recorded for a track URI, or undefined if it was not a request.
 * Only defined for track keys; passing an artist key yields whoever last queued
 * that artist, which is not what any caller means.
 */
export function requesterOf(uri: string): string | undefined {
  return entries.get(trackKey(uri))?.requestedBy;
}

/** Clears every entry, across all keyspaces (called on stop). */
export function clear(): void {
  entries.clear();
}
