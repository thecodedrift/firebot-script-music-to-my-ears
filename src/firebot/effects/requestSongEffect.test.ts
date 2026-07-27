import { num, requestSongEffect } from "./requestSongEffect";
import { getParams } from "../../modules";
import { queueTrack, searchTrack } from "../../services/api";
import { clear as clearLedger } from "../../services/ledger";
import { Track } from "../../shared/types";

// Real 22-char base62 Spotify ids, so the id-shaped blocklist tests exercise the
// same matcher the runtime does.
const BLOCKED_ARTIST_ID = "2SI7Y8t34pQv0KOfj0lAd5";
const BLOCKED_TRACK_ID = "37ozVDmL5b6NNVWFYgAlkz";

jest.mock("../../modules", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  getModules: jest.fn(),
  getParams: jest.fn(() => ({})),
}));

jest.mock("../../services/api", () => ({
  ...jest.requireActual("../../services/api"),
  searchTrack: jest.fn(),
  queueTrack: jest.fn(),
}));

const track = (over: Partial<Track> = {}): Track => ({
  uri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa",
  name: "Seven Dollars",
  artist: "Happy Birthday Mr. Baskets",
  artists: ["Happy Birthday Mr. Baskets"],
  artistIds: ["artist-hbmb"],
  explicit: false,
  durationMs: 235000,
  ...over,
});

interface EffectOutputs {
  success: boolean;
  trackUri: string;
  trackName: string;
  artistName: string;
  errorReason: string;
  errorText: string;
  errorCooldown: number;
}

function runEffect(
  effect: Record<string, unknown>,
  username = "someviewer"
): Promise<{ outputs: EffectOutputs }> {
  const onTriggerEvent = requestSongEffect.onTriggerEvent as (
    arg: unknown
  ) => Promise<{ outputs: EffectOutputs }>;
  return onTriggerEvent({ effect, trigger: { metadata: { username } } });
}

/** No restriction is on unless a test turns it on. */
const NO_LIMITS = {
  blockedTerms: [],
  noRepeatMinutes: 0,
  artistCooldownMinutes: 0,
  userArtistCooldownMinutes: 0,
  maxTrackLengthSeconds: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  // The ledger is module state shared across every test in this file.
  clearLedger();
  (searchTrack as jest.Mock).mockResolvedValue(track());
  (queueTrack as jest.Mock).mockResolvedValue(undefined);
  // Default: no global blocklist. Tests that need one override this.
  (getParams as jest.Mock).mockReturnValue({});
});

describe("requestSongEffect diagnostics", () => {
  // The effect used to carry an "Enable logging" checkbox. It defaulted to off,
  // so the records it gated were missing from every session that hit a bug; the
  // session debug log replaced it.
  it("offers no logging option", () => {
    const scope = { effect: {} as Record<string, unknown> };
    const controller = requestSongEffect.optionsController as (s: unknown) => void;
    controller(scope);

    expect(scope.effect.enableLogging).toBeUndefined();
    expect(requestSongEffect.optionsTemplate).not.toContain("enableLogging");
    expect(requestSongEffect.optionsTemplate).not.toContain("Enable logging");
    expect(requestSongEffect.optionsTemplate).not.toContain("Troubleshooting");
  });

  it("searches without a per-call logging knob", async () => {
    await runEffect({ query: "seven dollars", ...NO_LIMITS });

    expect(searchTrack).toHaveBeenCalledWith("seven dollars");
  });
});

describe("requestSongEffect restriction defaults", () => {
  it("seeds every restriction default in the options controller", () => {
    const scope = { effect: {} as Record<string, unknown> };
    (requestSongEffect.optionsController as (s: unknown) => void)(scope);

    expect(scope.effect.noRepeatMinutes).toBe(30);
    expect(scope.effect.artistCooldownMinutes).toBe(0);
    expect(scope.effect.userArtistCooldownMinutes).toBe(0);
    expect(scope.effect.maxTrackLengthSeconds).toBe(0);
  });

  it("renders a Restrictions section bound to each model field", () => {
    const template = requestSongEffect.optionsTemplate;
    expect(template).toContain("Restrictions");
    expect(template).toContain('model="effect.noRepeatMinutes"');
    expect(template).toContain('model="effect.artistCooldownMinutes"');
    expect(template).toContain('model="effect.userArtistCooldownMinutes"');
    expect(template).toContain('model="effect.maxTrackLengthSeconds"');
  });
});

describe("requestSongEffect success", () => {
  it("queues the track and reports no error", async () => {
    const { outputs } = await runEffect({ query: "seven dollars", ...NO_LIMITS });

    expect(queueTrack).toHaveBeenCalledWith(track().uri);
    expect(outputs.success).toBe(true);
    expect(outputs.errorReason).toBe("");
    expect(outputs.errorText).toBe("");
    expect(outputs.errorCooldown).toBe(0);
  });
});

describe("blocklist", () => {
  it("rejects a per-effect blocked term (blocked-term)", async () => {
    // "baskets" is a substring of the track's artist, "Happy Birthday Mr. Baskets".
    const { outputs } = await runEffect({ query: "q", ...NO_LIMITS, blockedTerms: "baskets" });

    expect(outputs.success).toBe(false);
    expect(outputs.errorReason).toBe("blocked-term");
    expect(queueTrack).not.toHaveBeenCalled();
  });

  it("still honors a legacy string[] blocked-terms value", async () => {
    const { outputs } = await runEffect({ query: "q", ...NO_LIMITS, blockedTerms: ["baskets"] });

    expect(outputs.errorReason).toBe("blocked-term");
  });

  it("blocks a globally banned artist by link (blocked-artist), naming the artist", async () => {
    (searchTrack as jest.Mock).mockResolvedValue(track({ artistIds: [BLOCKED_ARTIST_ID] }));
    (getParams as jest.Mock).mockReturnValue({
      spotifyBlockList: `https://open.spotify.com/artist/${BLOCKED_ARTIST_ID}`,
    });

    const { outputs } = await runEffect({ query: "q", ...NO_LIMITS });

    expect(outputs.errorReason).toBe("blocked-artist");
    expect(outputs.errorText).toContain("is a blocked artist");
    expect(outputs.errorText).toContain("Happy Birthday Mr. Baskets");
    expect(queueTrack).not.toHaveBeenCalled();
  });

  it("names the matched artist, not the primary, when a featured artist is blocked", async () => {
    // Primary is someone else; the blocked artist is only a feature. The match
    // is by id, so it still fires — and the message must name the feature.
    (searchTrack as jest.Mock).mockResolvedValue(
      track({
        artist: "Primary Act, Blocked Feature",
        artists: ["Primary Act", "Blocked Feature"],
        artistIds: ["primary-act", BLOCKED_ARTIST_ID],
      })
    );
    (getParams as jest.Mock).mockReturnValue({
      spotifyBlockList: `spotify:artist:${BLOCKED_ARTIST_ID}`,
    });

    const { outputs } = await runEffect({ query: "q", ...NO_LIMITS });

    expect(outputs.errorReason).toBe("blocked-artist");
    expect(outputs.errorText).toBe("Blocked Feature is a blocked artist.");
    expect(outputs.errorText).not.toContain("Primary Act");
  });

  it("blocks a globally banned track by URI (blocked-track)", async () => {
    (searchTrack as jest.Mock).mockResolvedValue(track({ uri: `spotify:track:${BLOCKED_TRACK_ID}` }));
    (getParams as jest.Mock).mockReturnValue({
      spotifyBlockList: `spotify:track:${BLOCKED_TRACK_ID}`,
    });

    const { outputs } = await runEffect({ query: "q", ...NO_LIMITS });

    expect(outputs.errorReason).toBe("blocked-track");
    expect(queueTrack).not.toHaveBeenCalled();
  });

  it("queues when neither the global list nor the per-effect list matches", async () => {
    (getParams as jest.Mock).mockReturnValue({ spotifyBlockList: "someunrelatedword" });

    const { outputs } = await runEffect({ query: "q", ...NO_LIMITS, blockedTerms: "nope" });

    expect(outputs.success).toBe(true);
    expect(queueTrack).toHaveBeenCalled();
  });
});

describe("blocklist options controller", () => {
  const migrate = (effect: Record<string, unknown>): Record<string, unknown> => {
    const scope = { effect };
    (requestSongEffect.optionsController as (s: unknown) => void)(scope);
    return scope.effect;
  };

  it("seeds the default block entries as newline text on a fresh effect", () => {
    expect(migrate({}).blockedTerms).toBe("karaoke\ninstrumental\ninst.");
  });

  it("migrates a legacy string[] to newline text", () => {
    expect(migrate({ blockedTerms: ["karaoke", "metallica"] }).blockedTerms).toBe(
      "karaoke\nmetallica"
    );
  });

  it("leaves an intentionally-emptied field alone", () => {
    expect(migrate({ blockedTerms: "" }).blockedTerms).toBe("");
  });

  it("renders a textarea bound to the model", () => {
    expect(requestSongEffect.optionsTemplate).toContain('ng-model="effect.blockedTerms"');
  });
});

describe("maximum track length", () => {
  it("rejects a track over the limit with too-long", async () => {
    (searchTrack as jest.Mock).mockResolvedValue(track({ durationMs: 600_000 }));

    const { outputs } = await runEffect({
      query: "long one",
      ...NO_LIMITS,
      maxTrackLengthSeconds: 420,
    });

    expect(outputs.success).toBe(false);
    expect(outputs.errorReason).toBe("too-long");
    expect(outputs.errorCooldown).toBe(0);
    expect(queueTrack).not.toHaveBeenCalled();
  });

  it("is disabled at 0", async () => {
    (searchTrack as jest.Mock).mockResolvedValue(track({ durationMs: 36_000_000 }));

    const { outputs } = await runEffect({ query: "very long", ...NO_LIMITS });

    expect(outputs.success).toBe(true);
  });

  // Permanent beats transient: a too-long track will never succeed, so telling the
  // requester to retry later would be false.
  it("outranks a concurrent cooldown", async () => {
    (searchTrack as jest.Mock).mockResolvedValue(track({ durationMs: 600_000 }));
    const effect = {
      query: "long one",
      ...NO_LIMITS,
      maxTrackLengthSeconds: 420,
      noRepeatMinutes: 30,
    };

    // Queue it once so the track cooldown is also live on the second attempt.
    (searchTrack as jest.Mock).mockResolvedValueOnce(track());
    await runEffect({ ...effect, maxTrackLengthSeconds: 0 });

    const { outputs } = await runEffect(effect);
    expect(outputs.errorReason).toBe("too-long");
  });
});

describe("global artist cooldown", () => {
  it("blocks a different requester, and the message does not blame them", async () => {
    const effect = { query: "q", ...NO_LIMITS, artistCooldownMinutes: 60 };

    await runEffect(effect, "alice");

    // A different track, same primary artist, a viewer who requested nothing.
    (searchTrack as jest.Mock).mockResolvedValue(track({ uri: "spotify:track:2" }));
    const { outputs } = await runEffect(effect, "bob");

    expect(outputs.success).toBe(false);
    expect(outputs.errorReason).toBe("artist-recently-played");
    expect(outputs.errorCooldown).toBeGreaterThan(0);
    // The gate protects playlist diversity; it does not accuse Bob of anything.
    expect(outputs.errorText).toContain("Happy Birthday Mr. Baskets was played recently");
    expect(outputs.errorText.toLowerCase()).not.toContain("you");
  });

  it("names the primary artist, not the joined credit list", async () => {
    const collab = track({
      artist: "Happy Birthday Mr. Baskets, Kasane Teto",
      artists: ["Happy Birthday Mr. Baskets", "Kasane Teto"],
      artistIds: ["artist-hbmb", "artist-teto"],
    });
    (searchTrack as jest.Mock).mockResolvedValue(collab);
    const effect = { query: "q", ...NO_LIMITS, artistCooldownMinutes: 60 };

    await runEffect(effect, "alice");
    (searchTrack as jest.Mock).mockResolvedValue({ ...collab, uri: "spotify:track:2" });
    const { outputs } = await runEffect(effect, "bob");

    expect(outputs.errorText).toContain("Happy Birthday Mr. Baskets was played recently");
    expect(outputs.errorText).not.toContain("Kasane Teto");
  });

  // The accepted bypass, pinned so it reads as a decision rather than a defect.
  it("does not gate an artist credited as a feature on another track", async () => {
    const effect = { query: "q", ...NO_LIMITS, artistCooldownMinutes: 60 };

    await runEffect(effect, "alice");

    // Same artist, now credited second. The primary artist is someone else, so
    // the cooldown does not apply. Gating every credited artist would instead
    // lock a collaborator's solo work that nobody requested.
    (searchTrack as jest.Mock).mockResolvedValue(
      track({
        uri: "spotify:track:2",
        artists: ["Other Artist", "Happy Birthday Mr. Baskets"],
        artistIds: ["artist-other", "artist-hbmb"],
      })
    );
    const { outputs } = await runEffect(effect, "alice");

    expect(outputs.success).toBe(true);
  });
});

describe("per-requester artist cooldown", () => {
  it("blocks the same requester and lets a different one through", async () => {
    const effect = { query: "q", ...NO_LIMITS, userArtistCooldownMinutes: 30 };

    await runEffect(effect, "alice");
    (searchTrack as jest.Mock).mockResolvedValue(track({ uri: "spotify:track:2" }));

    const blocked = await runEffect(effect, "alice");
    expect(blocked.outputs.errorReason).toBe("user-artist-recently-played");
    expect(blocked.outputs.errorText).toContain("You've already requested");

    const allowed = await runEffect(effect, "bob");
    expect(allowed.outputs.success).toBe(true);
  });

  it("skips the gate for a blank username, and such requests share no bucket", async () => {
    const effect = { query: "q", ...NO_LIMITS, userArtistCooldownMinutes: 30 };

    // A timer-fired request: no username.
    await runEffect(effect, "");
    (searchTrack as jest.Mock).mockResolvedValue(track({ uri: "spotify:track:2" }));
    const second = await runEffect(effect, "");

    expect(second.outputs.success).toBe(true);
  });
});

describe("cooldown precedence", () => {
  // The executable form of the max-remaining decision. Reporting the most
  // specific reason (recently-played, 5 min) would tell the viewer to retry at a
  // moment the 58-minute artist cooldown still blocks them.
  it("reports the longest-remaining cooldown, not the most specific", async () => {
    const effect = {
      query: "q",
      ...NO_LIMITS,
      noRepeatMinutes: 5,
      artistCooldownMinutes: 58,
      userArtistCooldownMinutes: 22,
    };

    await runEffect(effect, "alice");
    // Same track, same artist, same requester: all three cooldowns are live.
    const { outputs } = await runEffect(effect, "alice");

    expect(outputs.errorReason).toBe("artist-recently-played");
    // 58 minutes, minus the sub-second gap between the two calls.
    expect(outputs.errorCooldown).toBeGreaterThan(57 * 60);
    expect(outputs.errorCooldown).toBeLessThanOrEqual(58 * 60);
    expect(outputs.errorText).toContain("58 minutes");
  });

  it("reports recently-played when it is the only live cooldown", async () => {
    const effect = { query: "q", ...NO_LIMITS, noRepeatMinutes: 30 };

    await runEffect(effect, "alice");
    const { outputs } = await runEffect(effect, "alice");

    expect(outputs.errorReason).toBe("recently-played");
    expect(outputs.errorCooldown).toBeGreaterThan(0);
  });
});

describe("unconditional ledger writes", () => {
  // A lax effect must not punch a hole in a strict effect's diversity window.
  it("records artist keys even when its own artist cooldown is disabled", async () => {
    const lax = { query: "q", ...NO_LIMITS, artistCooldownMinutes: 0 };
    const strict = { query: "q", ...NO_LIMITS, artistCooldownMinutes: 60 };

    await runEffect(lax, "alice");

    (searchTrack as jest.Mock).mockResolvedValue(track({ uri: "spotify:track:2" }));
    const { outputs } = await runEffect(strict, "bob");

    expect(outputs.errorReason).toBe("artist-recently-played");
  });
});

describe("failure outputs", () => {
  it("keeps top-level success true so Firebot retains outputs", async () => {
    (searchTrack as jest.Mock).mockResolvedValue(undefined);

    const result = (await runEffect({ query: "nothing", ...NO_LIMITS })) as unknown as {
      success: boolean;
      outputs: EffectOutputs;
    };

    expect(result.success).toBe(true);
    expect(result.outputs.success).toBe(false);
    expect(result.outputs.errorReason).toBe("not-found");
    expect(result.outputs.errorText).not.toBe("");
  });
});

describe("rejection logging", () => {
  const debugLog = () =>
    (jest.requireMock("../../modules") as { logger: { debug: jest.Mock } }).logger.debug;

  const rejectionLines = () =>
    debugLog()
      .mock.calls.map((c: unknown[]) => String(c[0]))
      .filter((line: string) => line.startsWith("Song request rejected"));

  it("logs a rejection with its reason", async () => {
    (searchTrack as jest.Mock).mockResolvedValue(track({ durationMs: 600_000 }));

    await runEffect({ query: "long one", ...NO_LIMITS, maxTrackLengthSeconds: 420 });

    const lines = rejectionLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[too-long]");
    expect(lines[0]).toContain("Seven Dollars");
  });

  it("includes the retry wait when the rejection is a cooldown", async () => {
    const effect = { query: "q", ...NO_LIMITS, artistCooldownMinutes: 60 };
    await runEffect(effect, "alice");
    (searchTrack as jest.Mock).mockResolvedValue(track({ uri: "spotify:track:2" }));
    await runEffect(effect, "bob");

    const line = rejectionLines().find((l) => l.includes("[artist-recently-played]"));
    expect(line).toBeDefined();
    expect(line).toContain("retryInSeconds");
  });

  it("needs nothing enabled to log a rejection", async () => {
    (searchTrack as jest.Mock).mockResolvedValue(track({ durationMs: 600_000 }));

    await runEffect({ query: "long one", ...NO_LIMITS, maxTrackLengthSeconds: 420 });

    expect(rejectionLines()).toHaveLength(1);
  });
});

describe("num", () => {
  it("accepts a number", () => {
    expect(num(60, 30)).toBe(60);
    expect(num(0, 30)).toBe(0);
  });

  // Firebot's `firebot-input` may hand back a string. Falling back to the default
  // here would silently disable a restriction the streamer had configured.
  it("accepts a numeric string", () => {
    expect(num("60", 30)).toBe(60);
    expect(num("0", 30)).toBe(0);
  });

  it("falls back when the field was never set or is not numeric", () => {
    expect(num(undefined, 30)).toBe(30);
    expect(num("", 30)).toBe(30);
    expect(num("abc", 30)).toBe(30);
    expect(num(NaN, 30)).toBe(30);
  });
});
