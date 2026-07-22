import { Track } from "../shared/types";

/**
 * A blocklist line, once classified. A streamer's list mixes three kinds of
 * entry, told apart by shape rather than by which field they were typed into:
 *
 * - `term`  — any plain text; matched case-insensitively as a substring of the
 *             track's artist or track name (the historical behavior).
 * - `track` — a Spotify track link/URI; matched against the track's own id.
 * - `artist`— a Spotify artist link/URI; matched against any credited artist id.
 * - `id`    — a bare 22-char Spotify id with no `track:`/`artist:` context, so
 *             its type is unknown; matched against the track id OR any artist id.
 */
export interface BlockEntry {
  kind: "term" | "track" | "artist" | "id";
  /** For `term`, the lowercased text; otherwise the Spotify id. */
  value: string;
  /** The original line, verbatim, for logging which entry matched. */
  raw: string;
}

/** What a block matched, mapped to a reason by the caller. */
export interface BlockHit {
  /** `id` entries resolve to `track` or `artist` by what actually matched. */
  kind: "term" | "track" | "artist";
  /** The blocklist line that matched. */
  raw: string;
}

// A Spotify id is 22 base62 characters. That length-and-alphabet shape is what
// separates a pasted id from an ordinary blocked word.
const ID = "[A-Za-z0-9]{22}";
// spotify:track:<id> / spotify:artist:<id>
const URI_RE = new RegExp(`^spotify:(track|artist):(${ID})$`, "i");
// A link like https://open.spotify.com/track/<id>?si=... , tolerating the
// locale prefix Spotify adds when you copy from a localized client
// (open.spotify.com/intl-de/track/<id>).
const URL_RE = new RegExp(`spotify\\.com/(?:intl-[a-z]{2}/)?(track|artist)/(${ID})`, "i");
const BARE_ID_RE = new RegExp(`^${ID}$`);

/**
 * Classifies one blocklist line. Returns `undefined` for a blank line so the
 * caller can drop it. A recognized Spotify track/artist link or URI becomes an
 * id block; a bare id becomes an untyped id block; anything else is a substring
 * term (kept lowercased, so matching is case-insensitive).
 */
export function parseBlockEntry(raw: string): BlockEntry | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const uri = URI_RE.exec(trimmed);
  if (uri) {
    return { kind: uri[1].toLowerCase() as "track" | "artist", value: uri[2], raw: trimmed };
  }

  const url = URL_RE.exec(trimmed);
  if (url) {
    return { kind: url[1].toLowerCase() as "track" | "artist", value: url[2], raw: trimmed };
  }

  if (BARE_ID_RE.test(trimmed)) {
    return { kind: "id", value: trimmed, raw: trimmed };
  }

  return { kind: "term", value: trimmed.toLowerCase(), raw: trimmed };
}

/**
 * Splits a blocklist parameter into classified entries. Accepts a newline-
 * separated string (the textarea form) or a `string[]` (a Request Song effect
 * saved before the field became a textarea — those upgrade in place, no
 * re-entry required). Blank lines are dropped.
 */
export function parseBlockList(value: string | string[] | undefined): BlockEntry[] {
  const lines = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : [];
  const entries: BlockEntry[] = [];
  for (const line of lines) {
    const entry = parseBlockEntry(line);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

/** The track's own Spotify id, parsed from its `spotify:track:<id>` uri. */
function trackId(track: Track): string {
  const parts = track.uri.split(":");
  return parts[parts.length - 1] ?? "";
}

/**
 * Returns the first blocklist entry that matches the track, or `undefined`.
 * First match wins, in the order given, so a caller merges lists by
 * concatenating them highest-priority first.
 */
export function findBlock(track: Track, entries: BlockEntry[]): BlockHit | undefined {
  const haystack = `${track.artist} ${track.name}`.toLowerCase();
  const id = trackId(track);
  for (const entry of entries) {
    switch (entry.kind) {
      case "term":
        if (entry.value && haystack.includes(entry.value)) {
          return { kind: "term", raw: entry.raw };
        }
        break;
      case "track":
        if (id === entry.value) {
          return { kind: "track", raw: entry.raw };
        }
        break;
      case "artist":
        if (track.artistIds.includes(entry.value)) {
          return { kind: "artist", raw: entry.raw };
        }
        break;
      case "id":
        // Untyped: block whichever it turns out to name.
        if (id === entry.value) {
          return { kind: "track", raw: entry.raw };
        }
        if (track.artistIds.includes(entry.value)) {
          return { kind: "artist", raw: entry.raw };
        }
        break;
    }
  }
  return undefined;
}

/** True when the track is explicit and explicit tracks are not allowed. */
export function isExplicitBlocked(track: Track, allowExplicit: boolean): boolean {
  return !allowExplicit && track.explicit;
}

/**
 * True when the track runs longer than `maxSeconds`. A maximum of 0 (or less)
 * disables the check, per Firebot's convention.
 */
export function isTooLong(track: Track, maxSeconds: number): boolean {
  if (maxSeconds <= 0) {
    return false;
  }
  return track.durationMs > maxSeconds * 1000;
}
