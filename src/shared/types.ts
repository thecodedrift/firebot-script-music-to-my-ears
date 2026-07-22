/**
 * Reason a Request Song (or playback) effect failed. Surfaced as the
 * `errorReason` effect output so the streamer can branch (e.g. refund a
 * redemption) on a single condition.
 */
export type ErrorReason =
  | "not-found"
  | "not-playable"
  | "blocked-term"
  | "blocked-artist"
  | "blocked-track"
  | "explicit"
  | "too-long"
  | "recently-played"
  | "artist-recently-played"
  | "user-artist-recently-played"
  | "no-active-device"
  | "not-premium"
  | "not-linked"
  | "unknown";

/** Normalized track shape used across services and effects. */
export interface Track {
  uri: string;
  name: string;
  /** Joined artist names, e.g. "Daft Punk, Pharrell Williams". */
  artist: string;
  artists: string[];
  /**
   * Spotify artist ids, positionally aligned with `artists`. Index 0 is the
   * primary artist — a Spotify convention rather than a documented guarantee,
   * which the artist cooldowns rely on knowingly. Cooldowns key on these ids and
   * never on names: names collide across unrelated artists and vary by casing
   * and diacritics.
   */
  artistIds: string[];
  explicit: boolean;
  durationMs: number;
}
