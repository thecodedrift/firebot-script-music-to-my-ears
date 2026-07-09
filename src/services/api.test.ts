import {
  normalizeQuery,
  NotPlayableError,
  parseTrackId,
  redactEndpoint,
  searchTrack,
  spotifyFetch,
  SpotifyApiError,
  toErrorReason,
  tokenize,
  validateMatch,
} from "./api";
import { getAccessToken, NotLinkedError } from "./auth";
import { SpotifyTrack } from "../types/spotify";

jest.mock("../modules", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  getModules: jest.fn(),
  getParams: jest.fn(),
}));

jest.mock("./auth", () => {
  const actual = jest.requireActual("./auth");
  return { ...actual, getAccessToken: jest.fn() };
});

describe("toErrorReason", () => {
  it("maps NotLinkedError to not-linked", () => {
    expect(toErrorReason(new NotLinkedError())).toBe("not-linked");
  });

  it("maps NotPlayableError to not-playable", () => {
    expect(toErrorReason(new NotPlayableError("market"))).toBe("not-playable");
  });

  it("maps the NO_ACTIVE_DEVICE reason to no-active-device", () => {
    expect(toErrorReason(new SpotifyApiError(404, "no device", "NO_ACTIVE_DEVICE"))).toBe(
      "no-active-device"
    );
  });

  it("maps a 404 to no-active-device", () => {
    expect(toErrorReason(new SpotifyApiError(404, "not found"))).toBe("no-active-device");
  });

  it("maps the PREMIUM_REQUIRED reason to not-premium", () => {
    expect(toErrorReason(new SpotifyApiError(403, "premium", "PREMIUM_REQUIRED"))).toBe(
      "not-premium"
    );
  });

  it("maps a 403 to not-premium", () => {
    expect(toErrorReason(new SpotifyApiError(403, "forbidden"))).toBe("not-premium");
  });

  it("maps anything else to unknown", () => {
    expect(toErrorReason(new Error("boom"))).toBe("unknown");
    expect(toErrorReason(new SpotifyApiError(500, "server error"))).toBe("unknown");
  });
});

describe("parseTrackId", () => {
  const id = "1O9XsjLUaxsYCRh9vyF8xS";

  it("extracts the id from a share URL (with query and locale segment)", () => {
    expect(parseTrackId(`https://open.spotify.com/track/${id}?si=abc123`)).toBe(id);
    expect(parseTrackId(`https://open.spotify.com/intl-de/track/${id}`)).toBe(id);
  });

  it("extracts the id from a spotify:track: URI", () => {
    expect(parseTrackId(`spotify:track:${id}`)).toBe(id);
  });

  it("accepts a bare 22-char id", () => {
    expect(parseTrackId(id)).toBe(id);
    expect(parseTrackId(`  ${id}  `)).toBe(id);
  });

  it("returns undefined for an ordinary search query", () => {
    expect(parseTrackId("Walk The Dinosaur by Ninja Sex Party")).toBeUndefined();
    expect(parseTrackId("daft punk")).toBeUndefined();
  });
});

describe("redactEndpoint", () => {
  it("redacts search text but keeps the path and structural params", () => {
    const out = redactEndpoint("/search?q=daft%20punk&type=track&limit=5");
    expect(out).toContain("/search");
    expect(out).toContain("type=track");
    expect(out).toContain("limit=5");
    expect(out).toContain("q=REDACTED");
    expect(out).not.toContain("daft");
  });

  it("redacts the track uri on queue requests", () => {
    const out = redactEndpoint("/me/player/queue?uri=spotify%3Atrack%3Aabc123");
    expect(out).toContain("uri=REDACTED");
    expect(out).not.toContain("abc123");
  });

  it("returns the endpoint unchanged when there is no query string", () => {
    expect(redactEndpoint("/tracks/1O9XsjLUaxsYCRh9vyF8xS")).toBe("/tracks/1O9XsjLUaxsYCRh9vyF8xS");
  });
});

describe("spotifyFetch error handling", () => {
  const mockFetch = jest.fn();

  function mockResponse(init: {
    status: number;
    body: unknown;
    ok?: boolean;
    statusText?: string;
    headers?: Record<string, string>;
  }) {
    const {
      status,
      body,
      ok = status >= 200 && status < 300,
      statusText = "",
      headers = {},
    } = init;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return {
      status,
      ok,
      statusText,
      headers: { get: (key: string) => headers[key.toLowerCase()] ?? undefined },
      text: async () => text,
      json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    };
  }

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    (getAccessToken as jest.Mock).mockResolvedValue("secret-token-value");
  });

  it("throws SpotifyApiError with the message and reason from a JSON error body", async () => {
    mockFetch.mockResolvedValue(
      mockResponse({
        status: 404,
        body: {
          error: { status: 404, message: "No active device found", reason: "NO_ACTIVE_DEVICE" },
        },
      })
    );

    await expect(spotifyFetch("/me/player/queue?uri=spotify:track:abc")).rejects.toMatchObject({
      name: "SpotifyApiError",
      status: 404,
      message: "No active device found",
      reason: "NO_ACTIVE_DEVICE",
    });
  });

  it("falls back to a default message for a non-JSON error body", async () => {
    mockFetch.mockResolvedValue(mockResponse({ status: 502, body: "<html>Bad Gateway</html>" }));

    await expect(spotifyFetch("/search?q=test&type=track")).rejects.toMatchObject({
      name: "SpotifyApiError",
      status: 502,
      message: "Spotify API returned status 502",
    });
  });

  it("logs a triage block without leaking the token or raw query", async () => {
    const { logger } = jest.requireMock("../modules") as { logger: { debug: jest.Mock } };
    mockFetch.mockResolvedValue(
      mockResponse({ status: 400, body: { error: { status: 400, message: "invalid" } } })
    );

    await expect(spotifyFetch("/search?q=daft%20punk&type=track")).rejects.toBeInstanceOf(
      SpotifyApiError
    );

    const logged = logger.debug.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("Spotify request failed");
    expect(logged).toContain("q=REDACTED");
    expect(logged).not.toContain("secret-token-value");
    expect(logged).not.toContain("daft");
  });
});

describe("normalizeQuery", () => {
  it("splits on a single `by` into track/artist filters", () => {
    expect(normalizeQuery("seven dollars by happy birthday mr baskets")).toEqual({
      kind: "filtered",
      q: 'track:"seven dollars" artist:"happy birthday mr baskets"',
      title: "seven dollars",
      artist: "happy birthday mr baskets",
    });
  });

  it("splits on a single spaced hyphen, taking the title first", () => {
    expect(normalizeQuery("Toxic - Britney Spears")).toMatchObject({
      kind: "filtered",
      q: 'track:"Toxic" artist:"Britney Spears"',
    });
  });

  it("does not treat an unspaced hyphen as a separator", () => {
    expect(normalizeQuery("Blink-182")).toEqual({ kind: "raw", q: "Blink-182" });
    expect(normalizeQuery("Jay-Z")).toEqual({ kind: "raw", q: "Jay-Z" });
  });

  it("refuses to split when `by` appears more than once", () => {
    // We cannot tell which `by` is the delimiter, so we don't guess.
    const query = "Stand By Me by Ben E. King";
    expect(normalizeQuery(query)).toEqual({ kind: "raw", q: query });
  });

  it("refuses to split when there are two spaced hyphens", () => {
    const query = "A - B - C";
    expect(normalizeQuery(query)).toEqual({ kind: "raw", q: query });
  });

  it("leaves a query with no separator alone", () => {
    expect(normalizeQuery("Jump")).toEqual({ kind: "raw", q: "Jump" });
  });

  it("refuses to split when a side is empty or pure punctuation", () => {
    expect(normalizeQuery("by someone")).toEqual({ kind: "raw", q: "by someone" });
    expect(normalizeQuery("something by")).toEqual({ kind: "raw", q: "something by" });
    expect(normalizeQuery('!!! by "')).toEqual({ kind: "raw", q: '!!! by "' });
  });

  it("strips quotes from filter values so they cannot break out of the filter", () => {
    expect(normalizeQuery('say "hello" by some"one')).toMatchObject({
      kind: "filtered",
      q: 'track:"say hello" artist:"someone"',
    });
  });

  it("passes a query that already uses field filters straight through", () => {
    const query = "track:Doxy artist:Miles Davis";
    expect(normalizeQuery(query)).toEqual({ kind: "raw", q: query });
  });

  it("does not build filters from a query carrying a filter prefix", () => {
    // Defense in depth: passthrough means no filter is ever built from this text.
    const query = 'a" artist:"evil by someone';
    expect(normalizeQuery(query)).toEqual({ kind: "raw", q: query });
  });
});

describe("tokenize", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect([...tokenize("  Happy Birthday   Mr. Baskets! ")]).toEqual([
      "happy",
      "birthday",
      "mr",
      "baskets",
    ]);
  });

  it("strips diacritics", () => {
    expect([...tokenize("Beyoncé")]).toEqual(["beyonce"]);
    expect([...tokenize("Sigur Rós")]).toEqual(["sigur", "ros"]);
  });
});

function makeTrack(over: Partial<SpotifyTrack> = {}): SpotifyTrack {
  return {
    uri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa",
    name: "Seven Dollars",
    explicit: false,
    duration_ms: 235000,
    artists: [{ name: "Happy Birthday Mr. Baskets" }, { name: "Kasane Teto" }],
    type: "track",
    ...over,
  };
}

describe("validateMatch", () => {
  it("passes when title and artist tokens are all present", () => {
    expect(validateMatch(makeTrack(), "seven dollars", "happy birthday mr baskets")).toEqual({
      ok: true,
    });
  });

  it("passes when Spotify decorates the track name", () => {
    const track = makeTrack({ name: "Seven Dollars - 2024 Remaster" });
    expect(validateMatch(track, "seven dollars", "kasane teto")).toEqual({ ok: true });
  });

  it("satisfies the artist check from the union of all artists", () => {
    expect(validateMatch(makeTrack(), "seven dollars", "kasane teto")).toEqual({ ok: true });
  });

  it("fails on a substring that is not a whole token", () => {
    // The `Stand By Me` mis-split: `me` is inside `Mestizo` but is not a token of it.
    const track = makeTrack({ name: "Stand", artists: [{ name: "Mestizo" }] });
    const verdict = validateMatch(track, "stand", "me");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("me");
  });

  it("fails and names the missing title tokens", () => {
    const verdict = validateMatch(makeTrack(), "eight dollars", "kasane teto");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("eight");
  });
});

describe("searchTrack", () => {
  const mockFetch = jest.fn();
  const { logger } = jest.requireMock("../modules") as {
    logger: { debug: jest.Mock; info: jest.Mock };
  };

  function searchBody(items: SpotifyTrack[], total = items.length) {
    return { tracks: { items, total, limit: 5 } };
  }

  function okResponse(body: unknown) {
    return {
      status: 200,
      ok: true,
      statusText: "",
      headers: { get: () => undefined },
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  }

  /** The decoded `q` sent on the nth fetch call. */
  function sentQuery(call: number): string | null {
    const url = new URL(String(mockFetch.mock.calls[call][0]));
    return url.searchParams.get("q");
  }

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    (getAccessToken as jest.Mock).mockResolvedValue("secret-token-value");
  });

  it("issues one filtered search and accepts a validated result", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(searchBody([makeTrack()], 412)));

    const track = await searchTrack("seven dollars by happy birthday mr baskets");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sentQuery(0)).toBe('track:"seven dollars" artist:"happy birthday mr baskets"');
    expect(track?.name).toBe("Seven Dollars");
  });

  it("falls back to the raw query exactly once when validation fails", async () => {
    const wrong = makeTrack({ name: "Stand", artists: [{ name: "Ben E. King" }] });
    const right = makeTrack({ name: "Stand By Me", artists: [{ name: "Ben E. King" }] });
    mockFetch
      .mockResolvedValueOnce(okResponse(searchBody([wrong])))
      .mockResolvedValueOnce(okResponse(searchBody([right])));

    const track = await searchTrack("Stand By Me");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(sentQuery(0)).toBe('track:"Stand" artist:"Me"');
    expect(sentQuery(1)).toBe("Stand By Me");
    expect(track?.name).toBe("Stand By Me");
  });

  it("falls back to the raw query when the filtered search returns nothing", async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse(searchBody([])))
      .mockResolvedValueOnce(okResponse(searchBody([makeTrack()])));

    const track = await searchTrack("seven dollars by happy birthday mr baskets");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(track?.name).toBe("Seven Dollars");
  });

  it("issues exactly one unvalidated search for an unsplit query", async () => {
    const unrelated = makeTrack({ name: "Something Else", artists: [{ name: "Nobody" }] });
    mockFetch.mockResolvedValueOnce(okResponse(searchBody([unrelated])));

    const track = await searchTrack("daft punk");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sentQuery(0)).toBe("daft punk");
    // No validation on the raw path: whatever Spotify ranked first is accepted.
    expect(track?.name).toBe("Something Else");
  });

  it("never issues more than two searches", async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse(searchBody([])))
      .mockResolvedValueOnce(okResponse(searchBody([])));

    await expect(searchTrack("Stand By Me")).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("bypasses search entirely for a track id, and logs nothing new", async () => {
    const id = "1O9XsjLUaxsYCRh9vyF8xS";
    mockFetch.mockResolvedValueOnce(okResponse(makeTrack()));

    const track = await searchTrack(`spotify:track:${id}`, { log: true });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toContain(`/tracks/${id}`);
    expect(logger.info).not.toHaveBeenCalled();
    expect(track?.name).toBe("Seven Dollars");
  });

  describe("opt-in diagnostics", () => {
    it("emits nothing when logging is off", async () => {
      mockFetch.mockResolvedValueOnce(okResponse(searchBody([makeTrack()])));

      await searchTrack("seven dollars by happy birthday mr baskets");

      expect(logger.info).not.toHaveBeenCalled();
    });

    it("emits one record for a validated filtered search", async () => {
      mockFetch.mockResolvedValueOnce(okResponse(searchBody([makeTrack()], 412)));

      await searchTrack("seven dollars by happy birthday mr baskets", { log: true });

      expect(logger.info).toHaveBeenCalledTimes(1);
      const record = JSON.parse(String(logger.info.mock.calls[0][0]).replace(/^[^{]*/, ""));
      expect(record.attempt).toBe("filtered");
      expect(record.validation).toEqual({ ok: true });
      expect(record.selected).toBe("spotify:track:aaaaaaaaaaaaaaaaaaaaaa");
    });

    it("reports total matches distinctly from the returned page size", async () => {
      mockFetch.mockResolvedValueOnce(okResponse(searchBody([makeTrack()], 412)));

      await searchTrack("seven dollars by happy birthday mr baskets", { log: true });

      const record = JSON.parse(String(logger.info.mock.calls[0][0]).replace(/^[^{]*/, ""));
      expect(record.totalMatches).toBe(412);
      expect(record.returnedItems).toBe(1);
    });

    it("emits both attempts on fallback, with the failing reason", async () => {
      const wrong = makeTrack({ name: "Stand", artists: [{ name: "Ben E. King" }] });
      const right = makeTrack({ name: "Stand By Me", artists: [{ name: "Ben E. King" }] });
      mockFetch
        .mockResolvedValueOnce(okResponse(searchBody([wrong])))
        .mockResolvedValueOnce(okResponse(searchBody([right])));

      await searchTrack("Stand By Me", { log: true });

      expect(logger.info).toHaveBeenCalledTimes(2);
      const first = JSON.parse(String(logger.info.mock.calls[0][0]).replace(/^[^{]*/, ""));
      const second = JSON.parse(String(logger.info.mock.calls[1][0]).replace(/^[^{]*/, ""));
      expect(first.attempt).toBe("filtered");
      expect(first.validation.ok).toBe(false);
      expect(first.validation.reason).toContain("me");
      expect(second.attempt).toBe("raw");
      expect(second.query).toBe("Stand By Me");
    });

    it("logs the candidates and the raw response body", async () => {
      const other = makeTrack({ uri: "spotify:track:bbbbbbbbbbbbbbbbbbbbbb", name: "Decoy" });
      mockFetch.mockResolvedValueOnce(okResponse(searchBody([makeTrack(), other], 2)));

      await searchTrack("seven dollars by happy birthday mr baskets", { log: true });

      const record = JSON.parse(String(logger.info.mock.calls[0][0]).replace(/^[^{]*/, ""));
      expect(record.candidates).toHaveLength(2);
      expect(record.candidates[1]).toMatchObject({ name: "Decoy", explicit: false });
      expect(record.rawResponse.tracks.items).toHaveLength(2);
    });

    it("never logs the bearer token", async () => {
      mockFetch.mockResolvedValueOnce(okResponse(searchBody([makeTrack()])));

      await searchTrack("seven dollars by happy birthday mr baskets", { log: true });

      const logged = logger.info.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).not.toContain("secret-token-value");
      expect(logged).not.toContain("Authorization");
    });
  });
});
