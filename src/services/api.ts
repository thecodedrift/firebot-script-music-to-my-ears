import { getParams, logger } from "../modules";
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

/** Query-param values that can carry user content and must not reach the logs. */
const REDACTED_PARAMS = new Set(["q", "uri", "uris"]);

/**
 * Redacts user-content query values (search text, track uris) from an endpoint
 * so the failure-triage block is safe to paste into an issue. The path and
 * structural params (e.g. `type`, `limit`) are kept intact for context.
 */
export function redactEndpoint(endpoint: string): string {
  const [path, query] = endpoint.split("?");
  if (!query) {
    return endpoint;
  }
  const params = new URLSearchParams(query);
  for (const key of Array.from(params.keys())) {
    if (REDACTED_PARAMS.has(key)) {
      params.set(key, "REDACTED");
    }
  }
  return `${path}?${params.toString()}`;
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
        request: { method, endpoint: redactEndpoint(endpoint) },
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
    artistIds: item.artists.map((a) => a.id),
    explicit: item.explicit,
    durationMs: item.duration_ms,
  };
}

/**
 * The `market` parameter is the streamer's optional "Country of Play" code (see
 * `Params.spotifyCountryCode` and `market()` below). When it is set we send it on
 * search and track lookup; when it is empty we send none.
 *
 * We never send the deprecated `market=from_token` value — Spotify removed it in
 * Nov 2024 and now 400s on some accounts. With no code set and a valid user
 * token, the account's own country applies automatically, giving the correct
 * per-account catalog — but WITHOUT `is_playable`: that field only appears when
 * Spotify applies track relinking, which requires an explicit `market`. So a set
 * code is also what turns on the playability signal that `selectBest` filters on.
 * See https://developer.spotify.com/documentation/web-api/reference/search
 */

/** A 2-letter ISO 3166-1 alpha-2 country code. */
const COUNTRY_CODE_RE = /^[A-Za-z]{2}$/;

/**
 * The configured Spotify `market`, or undefined when none is set. Reads the
 * "Country of Play" parameter, accepts it only when it is exactly two ASCII
 * letters, and uppercases it. A malformed value is treated as unset rather than
 * forwarded to Spotify (a bad `market` can 400 or distort results).
 */
export function market(): string | undefined {
  const raw = (getParams().spotifyCountryCode ?? "").trim();
  return COUNTRY_CODE_RE.test(raw) ? raw.toUpperCase() : undefined;
}

/**
 * How many search results to fetch and rank.
 *
 * Selection ranks these candidates by token overlap with the query (see
 * `selectBest`) instead of blindly taking `items[0]`, so all five are used, not
 * only the first. Five is enough: the intended track reliably lands in the top
 * few, and fetching more does not improve the pick.
 *
 * When a "Country of Play" market is set, `selectBest` first drops candidates
 * Spotify marks unplayable, then ranks the rest; without a market `is_playable`
 * is absent and nothing is dropped (see the note above `market()`).
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
    // The `market` populates `is_playable`, so the guard below can reject a track
    // the configured country cannot play. Built with URLSearchParams to match the
    // rest of this file (runSearch, queueTrack) rather than string interpolation.
    const region = market();
    const params = new URLSearchParams();
    if (region) {
      params.set("market", region);
    }
    const query = params.toString();
    const endpoint = query ? `/tracks/${id}?${query}` : `/tracks/${id}`;
    ({ data } = await spotifyFetch<SpotifyTrack>(endpoint));
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
 * A leaked command trigger at the very front of a query: `!` + a letter, then
 * letters or digits, then any punctuation stuck to it, then whitespace and the
 * rest of the query.
 *
 * Every part of this is load-bearing. Anchoring to the start is what keeps
 * `Hello! by Someone` intact, since a `!` anywhere else belongs to the title.
 * Requiring a LETTER after the bang is what protects the band `!!!`, whose name
 * is exactly three bangs and whose albums (`!!! - Louden Up Now`) would
 * otherwise be mangled into a query starting with a bare dash. And requiring
 * trailing text means `!sr` on its own is left alone rather than turned into an
 * empty search.
 *
 * The trailing punctuation class covers `!sr, Toxic` and `!sr: Toxic` — typing
 * the trigger like an address is a habit, and without it the comma carries the
 * whole junk token into the search. It stops at the whitespace: the separator
 * is still a space, so a hyphenated first word (`!go-go dancers`) is one token
 * and is left alone rather than half-eaten.
 */
const COMMAND_PREFIX_RE = /^!\p{L}[\p{L}\p{N}]*[^\p{L}\p{N}\s]*\s+(?=\S)/u;

/**
 * Removes a leaked command trigger, e.g. `!sr Toxic by Britney Spears`.
 *
 * The trigger leaks whenever the streamer wires the raw message into the effect
 * — `$arg[all]` on a command that passes everything through, or a viewer who
 * types `!sr` inside a channel-point reward's text. Left in place it lands
 * INSIDE the quoted title filter (`track:"!sr Toxic"`), which Spotify matches
 * literally and answers with nothing, so the request wastes its filtered
 * attempt and falls through to a raw search that still carries the junk token.
 *
 * We cannot know which triggers the streamer configured — the script registers
 * no commands and is not told what invoked the effect — so this is a rule about
 * shape, kept deliberately narrow.
 */
export function stripCommandPrefix(query: string): string {
  return query.replace(COMMAND_PREFIX_RE, "");
}

/** Spotify query filters we recognize; a query using one is passed through as-is. */
const FIELD_FILTER_RE = /\b(?:track|artist|album|year|genre|isrc|upc|tag):/i;

/** `by` as a whole word. */
const BY_SEPARATOR_RE = /\bby\b/gi;
/**
 * A *spaced* hyphen only. Requiring the spaces is what keeps `Jay-Z` and
 * `Blink-182` from being torn into a bogus title/artist pair.
 */
const DASH_SEPARATOR = " - ";

/** The outcome of {@link normalizeQuery}: either field filters, or the raw text. */
type NormalizedQuery =
  | { kind: "filtered"; q: string; title: string; artist: string }
  | { kind: "raw"; q: string };

/**
 * Lowercases, strips diacritics and punctuation, and splits into a token set.
 * Token-level comparison is deliberate: substring matching would let the parsed
 * artist `me` (from `Stand By Me`) match `Mestizo`.
 */
export function tokenize(text: string): Set<string> {
  const cleaned = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
  return new Set(cleaned.split(/\s+/).filter(Boolean));
}

/**
 * Splits `<title> <sep> <artist>` when exactly one separator is present.
 *
 * A single `by` wins outright, even when the query also contains ` - `. That is
 * deliberate: Spotify's own titles use ` - ` for version suffixes, so in
 * `Toxic - Radio Edit by Britney Spears` the dash belongs to the title and only
 * the `by` separates artist from track. Preferring the dash there would split in
 * the wrong place.
 *
 * The reverse shape (`Stand By Me - Ben E. King`, where `by` sits inside the
 * title) does mis-split — into `track:"Stand" artist:"Me - Ben E. King"` — but
 * the leftover `me` token fails validation and the raw fallback recovers it. So
 * `by`-precedence is never less correct than refusing to split, only one request
 * more expensive when it guesses wrong.
 *
 * Two or more `by`s is the genuinely undecidable case: we cannot tell which one
 * is the delimiter, so we don't guess, and we don't fall through to the dash.
 */
function splitOnSeparator(query: string): { title: string; artist: string } | undefined {
  const byMatches = query.match(BY_SEPARATOR_RE);
  if (byMatches?.length === 1) {
    const at = query.search(BY_SEPARATOR_RE);
    return { title: query.slice(0, at), artist: query.slice(at + byMatches[0].length) };
  }
  if (byMatches) {
    return undefined;
  }
  const parts = query.split(DASH_SEPARATOR);
  if (parts.length === 2) {
    return { title: parts[0], artist: parts[1] };
  }
  return undefined;
}

/**
 * Turns free text into Spotify field filters when the shape is unambiguous.
 *
 * The split rule is deliberately dumb — a title containing the word `by` will
 * split wrongly. That is fine, and by design: `searchTrack` validates the result
 * of a filtered search and falls back to the raw query when it does not hold up.
 * Validation, not this function, is the gate.
 *
 * For the dash form we assume `Title - Artist`. `Artist - Title` is an equally
 * real convention and is syntactically indistinguishable, so it fails validation
 * and falls back — costing one extra request, never a wrong answer.
 */
export function normalizeQuery(query: string): NormalizedQuery {
  const raw: NormalizedQuery = { kind: "raw", q: query };

  // The requester already speaks Spotify's query language; don't second-guess it.
  if (FIELD_FILTER_RE.test(query)) {
    return raw;
  }

  const split = splitOnSeparator(query);
  if (!split) {
    return raw;
  }

  const title = split.title.trim();
  const artist = split.artist.trim();
  // A side that is empty, or is pure punctuation, carries no signal to match on.
  if (!tokenize(title).size || !tokenize(artist).size) {
    return raw;
  }

  return {
    kind: "filtered",
    // Stripping `"` keeps a crafted query from closing our filter and injecting
    // another one. Spotify's docs show the filters unquoted, but never say how a
    // multi-word value binds; quoting is the only unambiguous form. The opt-in
    // diagnostics log this `q` next to the raw response so we can confirm it.
    q: `track:"${title.replace(/"/g, "")}" artist:"${artist.replace(/"/g, "")}"`,
    title,
    artist,
  };
}

/** Why a filtered result was accepted or rejected. */
export interface MatchVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Checks that a filtered search actually returned what we asked for: every token
 * of the parsed title must appear in the track's name, and every token of the
 * parsed artist in the union of its artists' names.
 *
 * Containment is directional (parsed ⊆ actual), so Spotify's decorations survive:
 * `Seven Dollars - 2024 Remaster` still contains `{seven, dollars}`.
 */
export function validateMatch(item: SpotifyTrack, title: string, artist: string): MatchVerdict {
  const nameTokens = tokenize(item.name);
  const artistTokens = new Set(item.artists.flatMap((a) => [...tokenize(a.name)]));

  const missingTitle = [...tokenize(title)].filter((t) => !nameTokens.has(t));
  if (missingTitle.length) {
    return {
      ok: false,
      reason: `track name is missing title token(s): ${missingTitle.join(", ")}`,
    };
  }

  const missingArtist = [...tokenize(artist)].filter((t) => !artistTokens.has(t));
  if (missingArtist.length) {
    return { ok: false, reason: `artists are missing token(s): ${missingArtist.join(", ")}` };
  }

  return { ok: true };
}

interface SearchAttempt {
  endpoint: string;
  data: SpotifySearchResponse | undefined;
  items: SpotifyTrack[];
  selected: SpotifyTrack | undefined;
}

/**
 * Token overlap between a query and a candidate: how many distinct query tokens
 * appear in the union of the candidate's track-name tokens and its artists'-name
 * tokens. This is the relevance score selection ranks on.
 */
export function overlapScore(item: SpotifyTrack, queryTokens: Set<string>): number {
  const haystack = new Set<string>([
    ...tokenize(item.name),
    ...item.artists.flatMap((a) => [...tokenize(a.name)]),
  ]);
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Picks the candidate with the greatest token overlap with the query, keeping
 * Spotify's order as the tie-break. Returns undefined when there are no items.
 *
 * The returned candidate may still score zero (nothing overlapped); callers that
 * need a relevance floor check the score themselves. Candidates Spotify marks
 * unplayable (`is_playable === false`) are skipped before ranking; that field is
 * only populated when a market is set, so with none it excludes nothing (see the
 * note on SEARCH_LIMIT).
 */
export function selectBest(
  items: SpotifyTrack[],
  queryTokens: Set<string>
): SpotifyTrack | undefined {
  let best: SpotifyTrack | undefined;
  let bestScore = -1;
  for (const item of items) {
    // Skip tracks Spotify marks unplayable in the configured market. With no
    // market set, `is_playable` is absent and this never excludes anything.
    if (item.is_playable === false) {
      continue;
    }
    const score = overlapScore(item, queryTokens);
    // Strict `>` preserves Spotify's order on ties: the first item to reach a
    // score keeps it, so an equal-scoring later candidate never displaces it.
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/** Issues one `/search` call and picks the best-overlap candidate. */
async function runSearch(q: string, queryTokens: Set<string>): Promise<SearchAttempt> {
  const params = new URLSearchParams({ q, type: "track", limit: String(SEARCH_LIMIT) });
  const region = market();
  if (region) {
    params.set("market", region);
  }
  const endpoint = `/search?${params.toString()}`;
  const { data } = await spotifyFetch<SpotifySearchResponse>(endpoint);
  const items = data?.tracks?.items ?? [];
  const selected = selectBest(items, queryTokens);
  return { endpoint, data, items, selected };
}

/**
 * Detailed diagnostics for one search attempt.
 *
 * Deliberately does NOT call `redactEndpoint()`. That redaction exists so the
 * failure-triage block in `spotifyFetch` is safe to paste into a public issue.
 * This channel is the opposite: showing exactly the query text and the response
 * body is its entire purpose, because that is what answers "why did this request
 * match the wrong track". Do not "fix" one of these two sites into the other.
 *
 * Emitted at `debug`, and unconditionally. The script's own session debug log
 * captures every level (see `services/debugLog.ts`), so these records are always
 * kept for a bug report while Firebot's log file stays quiet unless the streamer
 * raises its level. This used to be `info` behind a per-effect checkbox, which
 * meant the records were missing from exactly the sessions that needed them.
 *
 * The invariant both channels share: never emit the bearer token, the refresh
 * token, or the client secret. We log the endpoint and body only, never headers.
 */
function logAttempt(
  kind: "filtered" | "raw",
  q: string,
  attempt: SearchAttempt,
  verdict: MatchVerdict | undefined
): void {
  // Compact single-line JSON on purpose: a pretty-printed record spans dozens of
  // lines per search and drowns the log. Parse it out of the line if you need to
  // read it (the tests do).
  logger.debug(
    `Song request search [${kind}]: ${JSON.stringify({
      attempt: kind,
      query: q,
      endpoint: attempt.endpoint,
      // `totalMatches` is how many tracks Spotify found; `returnedItems` is
      // just this page. Only the former answers "how many possible matches".
      totalMatches: attempt.data?.tracks?.total,
      returnedItems: attempt.items.length,
      candidates: attempt.items.map((item) => ({
        uri: item.uri,
        name: item.name,
        // Ids as well as names: the artist cooldowns key on the id, so a
        // surprise `artist-recently-played` is only debuggable with it.
        artists: item.artists.map((a) => `${a.name} (${a.id})`),
        explicit: item.explicit,
        durationMs: item.duration_ms,
        is_playable: item.is_playable,
      })),
      selected: attempt.selected?.uri,
      validation: verdict ?? "n/a",
      rawResponse: attempt.data,
    })}`
  );
}

/**
 * Resolves a track request. A Spotify URL/URI/id is looked up directly. Anything
 * else is normalized into `track:`/`artist:` filters when its shape is
 * unambiguous, searched (tracks only), and the result validated; a filtered
 * search that returns nothing or fails validation retries exactly once with the
 * raw query. At most two searches are issued. Returns undefined when nothing
 * matches.
 */
export async function searchTrack(original: string): Promise<Track | undefined> {
  // Above the id check on purpose: `!sr <track link>` is a direct lookup, and
  // only sees that it is one once the trigger is gone.
  const query = stripCommandPrefix(original);
  if (query !== original) {
    logger.debug(
      `Stripped a leaked command trigger from the request; searching ${JSON.stringify(query)}`
    );
  }

  const id = parseTrackId(query);
  if (id) {
    return getTrack(id);
  }

  const normalized = normalizeQuery(query);

  if (normalized.kind === "filtered") {
    // Rank filtered candidates against the parsed title+artist tokens, then
    // validate the pick. Behavior-preserving when the top result validates, and
    // it can surface a lower-ranked validating candidate instead of falling
    // straight through — but only best-effort: the score uses a merged
    // name+artist haystack, while validateMatch checks the two fields
    // separately, so a non-validating candidate can tie at the max score and, if
    // Spotify sorts it first, be picked and then rejected, falling through as
    // before. validateMatch gates every filtered result, so no wrong track is
    // queued either way.
    const tokens = new Set<string>([...tokenize(normalized.title), ...tokenize(normalized.artist)]);
    const attempt = await runSearch(normalized.q, tokens);
    const verdict = attempt.selected
      ? validateMatch(attempt.selected, normalized.title, normalized.artist)
      : { ok: false, reason: "filtered search returned no tracks" };
    logAttempt("filtered", normalized.q, attempt, verdict);
    if (attempt.selected && verdict.ok) {
      return toTrack(attempt.selected);
    }
    // Fall through: the split was wrong, or the filters were too narrow.
  }

  const rawTokens = tokenize(query);
  const attempt = await runSearch(query, rawTokens);
  const { selected } = attempt;
  // Relevance floor: the raw fallback has no parsed title/artist to validate
  // against, but a result that shares no token at all with the query is not a
  // match — accepting one is exactly how a fuzzy raw search once queued a wholly
  // unrelated track. Below the floor we report nothing found rather than queue it.
  const matched = selected !== undefined && overlapScore(selected, rawTokens) > 0;
  logAttempt(
    "raw",
    query,
    attempt,
    matched
      ? { ok: true }
      : {
          ok: false,
          reason: selected ? "no candidate shared a query token" : "raw search returned no tracks",
        }
  );
  if (!matched || selected === undefined) {
    // The effect turns `undefined` into a silent "not-found", so this is the only
    // place a search that resolved to nothing (empty, or all below the floor)
    // becomes diagnosable on its own line rather than only inside the attempt
    // record.
    logger.debug(
      `Spotify search for ${JSON.stringify(query)} returned ${attempt.items.length} track(s), ` +
        "none matched"
    );
    return undefined;
  }
  return toTrack(selected);
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
