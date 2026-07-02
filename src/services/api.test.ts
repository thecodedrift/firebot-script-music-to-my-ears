import {
  NotPlayableError,
  parseTrackId,
  redactEndpoint,
  spotifyFetch,
  SpotifyApiError,
  toErrorReason,
} from "./api";
import { getAccessToken, NotLinkedError } from "./auth";

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
    const { status, body, ok = status >= 200 && status < 300, statusText = "", headers = {} } = init;
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
