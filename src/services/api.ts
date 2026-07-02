import { logger } from "../modules";
import { SPOTIFY_API_BASE } from "../shared/constants";
import { ErrorReason, Track } from "../shared/types";
import {
  SpotifyCurrentlyPlayingResponse,
  SpotifyErrorResponse,
  SpotifySearchResponse,
  SpotifyTrack,
} from "../types/spotify";
import { getAccessToken, NotLinkedError } from "./auth";

/** Thrown when a specifically-requested track can't be played for the account. */
export class NotPlayableError extends Error {
  /** Spotify restriction reason, e.g. market / product / explicit. */
  reason?: string;

  constructor(reason?: string) {
    super(`Track is not playable${reason ? ` (${reason})` : ""}`);
    this.name = "NotPlayableError";
    this.reason = reason;
  }
}

/** Error thrown for a non-OK Spotify API response, carrying the HTTP status. */
export class SpotifyApiError extends Error {
  status: number;
  /** Spotify player `reason` code, e.g. NO_ACTIVE_DEVICE / PREMIUM_REQUIRED. */
  reason?: string;

  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
    this.reason = reason;
  }
}

interface FetchResult<T> {
  status: number;
  ok: boolean;
  data: T | undefined;
}

/**
 * Single Spotify API helper: injects the base URL + bearer token and throws a
 * typed {@link SpotifyApiError} on non-OK responses. Non-GET and 204 responses
 * resolve with `data: undefined`.
 */
export async function spotifyFetch<T>(
  endpoint: string,
  method = "GET",
  options: RequestInit = {}
): Promise<FetchResult<T>> {
  const send = async (forceRefresh: boolean): Promise<Response> => {
    const token = await getAccessToken(forceRefresh);
    return fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
      ...options,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });
  };

  let response = await send(false);
  // A 401 means the token was rejected (expired, revoked, or rotated behind our
  // back). Force a refresh and retry once before surfacing the failure.
  if (response.status === 401) {
    logger.debug("Spotify returned 401; forcing token refresh and retrying once");
    response = await send(true);
  }

  if (!response.ok) {
    let reason: string | undefined;
    let message = `Spotify API returned status ${response.status}`;
    // Read the body as text first so a non-JSON error page is still captured
    // for triage; parse it as Spotify's error shape when it is JSON.
    const rawBody = await response.text().catch(() => "");
    let body: unknown = rawBody || undefined;
    try {
      const parsed = JSON.parse(rawBody) as SpotifyErrorResponse;
      body = parsed;
      reason = parsed.error?.reason;
      if (parsed.error?.message) {
        message = parsed.error.message;
      }
    } catch {
      // non-JSON error body; keep the raw text and the default message
    }
    // Triage block for us. Deliberately excludes the Authorization header, the
    // access token, and the client secret — only the request shape, the
    // response, and the derived error are recorded.
    logger.debug(
      `Spotify request failed: ${JSON.stringify({
        request: { method, endpoint },
        response: {
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get("retry-after") ?? undefined,
          requestId: response.headers.get("x-request-id") ?? undefined,
          body,
        },
        error: { status: response.status, message, reason },
      })}`
    );
    throw new SpotifyApiError(response.status, message, reason);
  }

  if (response.status === 204 || method !== "GET") {
    return { status: response.status, ok: true, data: undefined };
  }
  return { status: response.status, ok: true, data: (await response.json()) as T };
}

/** Maps a thrown error to the effect-facing {@link ErrorReason}. */
export function toErrorReason(error: unknown): ErrorReason {
  if (error instanceof NotLinkedError) {
    return "not-linked";
  }
  if (error instanceof NotPlayableError) {
    return "not-playable";
  }
  if (error instanceof SpotifyApiError) {
    if (error.reason === "NO_ACTIVE_DEVICE" || error.status === 404) {
      return "no-active-device";
    }
    if (error.reason === "PREMIUM_REQUIRED" || error.status === 403) {
      return "not-premium";
    }
  }
  return "unknown";
}

/** Normalizes a Spotify track object into our domain {@link Track}. */
function toTrack(item: SpotifyTrack): Track {
  const artists = item.artists.map((a) => a.name);
  return {
    uri: item.uri,
    name: item.name,
    artist: artists.join(", "),
    artists,
    explicit: item.explicit,
    durationMs: item.duration_ms,
  };
}

/**
 * We intentionally send no `market` parameter. Spotify deprecated the
 * `market=from_token` value (Nov 2024) and now rejects it with a 400 on some
 * endpoints/accounts. Per the current docs, when a valid user access token is
 * present the account's own country takes priority automatically, so omitting
 * `market` gives the correct per-account catalog (and `is_playable`) without the
 * deprecated value. See https://developer.spotify.com/documentation/web-api/reference/search
 */

/**
 * How many search results to fetch. Spotify's relevance ranking is unreliable
 * at limit=1 (it can return a worse match than the obvious one); fetching a
 * handful and taking the first playable result fixes that. See search tests.
 */
const SEARCH_LIMIT = 5;

/** A Spotify track id is 22 base62 characters. */
const TRACK_ID = "[A-Za-z0-9]{22}";
const BARE_ID_RE = new RegExp(`^${TRACK_ID}$`);
const URI_RE = new RegExp(`^spotify:track:(${TRACK_ID})$`);
// open.spotify.com/track/<id> with optional locale segment (e.g. /intl-de/).
const URL_RE = new RegExp(`open\\.spotify\\.com/(?:[a-z-]+/)?track/(${TRACK_ID})`);

/**
 * Extracts a Spotify track id from a share URL, `spotify:track:` URI, or bare
 * id. Returns undefined when the input is an ordinary search query.
 */
export function parseTrackId(input: string): string | undefined {
  const value = input.trim();
  if (BARE_ID_RE.test(value)) {
    return value;
  }
  return value.match(URI_RE)?.[1] ?? value.match(URL_RE)?.[1];
}

/**
 * Fetches a single track by id with playability info. Throws
 * {@link NotPlayableError} when the linked account/region can't play it.
 * A malformed or nonexistent id (Spotify 400/404) resolves to `undefined`
 * (treated as "not found") rather than propagating as a playback-device error.
 */
export async function getTrack(id: string): Promise<Track | undefined> {
  let data: SpotifyTrack | undefined;
  try {
    ({ data } = await spotifyFetch<SpotifyTrack>(`/tracks/${id}`));
  } catch (error) {
    if (error instanceof SpotifyApiError && (error.status === 404 || error.status === 400)) {
      return undefined;
    }
    throw error;
  }
  if (!data) {
    return undefined;
  }
  if (data.is_playable === false) {
    throw new NotPlayableError(data.restrictions?.reason);
  }
  return toTrack(data);
}

/**
 * Resolves a track request. A Spotify URL/URI/id is looked up directly;
 * anything else is searched (tracks only) and the first playable result is
 * returned. Returns undefined when nothing playable matches.
 */
export async function searchTrack(query: string): Promise<Track | undefined> {
  const id = parseTrackId(query);
  if (id) {
    return getTrack(id);
  }

  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(SEARCH_LIMIT),
  });
  const { data } = await spotifyFetch<SpotifySearchResponse>(`/search?${params.toString()}`);
  const items = data?.tracks?.items ?? [];
  const playable = items.find((item) => item.is_playable !== false);
  if (!playable) {
    // The effect turns `undefined` into a silent "not-found"; log here so a
    // name search that resolves to nothing is diagnosable (empty result set vs.
    // results that were all filtered out as unplayable in the account's market).
    logger.debug(
      `Spotify search for ${JSON.stringify(query)} returned ${items.length} track(s), ` +
        "none playable"
    );
    return undefined;
  }
  return toTrack(playable);
}

/** Adds a track URI to the active device's playback queue. */
export async function queueTrack(uri: string): Promise<void> {
  const params = new URLSearchParams({ uri });
  await spotifyFetch(`/me/player/queue?${params.toString()}`, "POST");
}

/** Advances to the next track. */
export async function skip(): Promise<void> {
  await spotifyFetch("/me/player/next", "POST");
}

/** Resumes playback on the active device. */
export async function play(): Promise<void> {
  await spotifyFetch("/me/player/play", "PUT");
}

/** Pauses playback on the active device. */
export async function pause(): Promise<void> {
  await spotifyFetch("/me/player/pause", "PUT");
}

export interface CurrentTrack {
  track: Track | undefined;
  isPlaying: boolean;
}

/** Returns the currently playing track (if any) and playback state. */
export async function currentTrack(): Promise<CurrentTrack> {
  const { status, data } = await spotifyFetch<SpotifyCurrentlyPlayingResponse>(
    "/me/player/currently-playing"
  );
  // 204 = nothing playing.
  if (status === 204 || !data) {
    return { track: undefined, isPlaying: false };
  }
  return {
    track: data.item ? toTrack(data.item) : undefined,
    isPlaying: data.is_playing,
  };
}
