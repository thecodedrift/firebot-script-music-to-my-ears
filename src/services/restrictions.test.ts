import { clear, record } from "./ledger";
import { cooldownSeconds, resolveCooldown } from "./restrictions";
import { Track } from "../shared/types";

const track = (over: Partial<Track> = {}): Track => ({
  uri: "spotify:track:1",
  name: "Song",
  artist: "ATEEZ",
  artists: ["ATEEZ"],
  artistIds: ["artist-ateez"],
  explicit: false,
  durationMs: 235_000,
  ...over,
});

const OFF = { noRepeatMinutes: 0, artistCooldownMinutes: 0, userArtistCooldownMinutes: 0 };

describe("resolveCooldown", () => {
  beforeEach(() => clear());

  it("returns undefined when every window is disabled", () => {
    record("spotify:track:1", "alice", "artist-ateez", 0);
    expect(resolveCooldown(track(), "alice", OFF, 1000)).toBeUndefined();
  });

  it("returns undefined when nothing has been queued", () => {
    expect(
      resolveCooldown(track(), "alice", { ...OFF, noRepeatMinutes: 30 }, 1000)
    ).toBeUndefined();
  });

  it("reports recently-played for the same track", () => {
    record("spotify:track:1", "alice", "artist-ateez", 0);
    const hit = resolveCooldown(track(), "alice", { ...OFF, noRepeatMinutes: 5 }, 0);
    expect(hit).toEqual({ reason: "recently-played", remainingMs: 5 * 60_000 });
  });

  it("reports artist-recently-played for a different track by the same primary artist", () => {
    record("spotify:track:1", "alice", "artist-ateez", 0);
    const other = track({ uri: "spotify:track:2" });
    const hit = resolveCooldown(other, "bob", { ...OFF, artistCooldownMinutes: 60 }, 0);
    expect(hit).toEqual({ reason: "artist-recently-played", remainingMs: 60 * 60_000 });
  });

  it("blocks the same requester but not a different one, per-requester", () => {
    record("spotify:track:1", "alice", "artist-ateez", 0);
    const other = track({ uri: "spotify:track:2" });
    const windows = { ...OFF, userArtistCooldownMinutes: 30 };

    expect(resolveCooldown(other, "alice", windows, 0)).toEqual({
      reason: "user-artist-recently-played",
      remainingMs: 30 * 60_000,
    });
    expect(resolveCooldown(other, "bob", windows, 0)).toBeUndefined();
  });

  it("matches the requester case-insensitively", () => {
    record("spotify:track:1", "Alice", "artist-ateez", 0);
    const other = track({ uri: "spotify:track:2" });
    expect(resolveCooldown(other, "ALICE", { ...OFF, userArtistCooldownMinutes: 30 }, 0)).toEqual({
      reason: "user-artist-recently-played",
      remainingMs: 30 * 60_000,
    });
  });

  it("skips the per-requester gate for a blank username", () => {
    record("spotify:track:1", "", "artist-ateez", 0);
    const other = track({ uri: "spotify:track:2" });
    expect(
      resolveCooldown(other, "", { ...OFF, userArtistCooldownMinutes: 30 }, 0)
    ).toBeUndefined();
  });

  it("does not gate a featured (non-primary) artist — the accepted bypass", () => {
    record("spotify:track:1", "alice", "artist-ateez", 0);
    // ATEEZ is credited second here, so the primary artist is someone else and
    // ATEEZ's own cooldown does not apply. Deliberate: gating every credited
    // artist would lock a collaborator's solo work that nobody requested.
    const collab = track({
      uri: "spotify:track:2",
      artists: ["Other Artist", "ATEEZ"],
      artistIds: ["artist-other", "artist-ateez"],
    });
    expect(resolveCooldown(collab, "alice", { ...OFF, artistCooldownMinutes: 60 }, 0)).toBeUndefined();
  });

  it("ignores a track with no artist ids", () => {
    record("spotify:track:1", "alice", "artist-ateez", 0);
    const anon = track({ uri: "spotify:track:2", artists: [], artistIds: [] });
    expect(resolveCooldown(anon, "alice", { ...OFF, artistCooldownMinutes: 60 }, 0)).toBeUndefined();
  });

  // The executable form of the max-remaining decision. If a future refactor
  // reverts to first-match-wins or specificity ordering, this fails.
  it("reports the LONGEST remaining cooldown, not the most specific one", () => {
    record("spotify:track:1", "alice", "artist-ateez", 0);

    // Windows chosen so all three are live at t=0 with distinct remainders:
    //   track       5 min  (most specific — must NOT win)
    //   per-user   22 min
    //   artist     58 min  (longest — must win)
    const hit = resolveCooldown(
      track(),
      "alice",
      { noRepeatMinutes: 5, artistCooldownMinutes: 58, userArtistCooldownMinutes: 22 },
      0
    );

    expect(hit).toEqual({ reason: "artist-recently-played", remainingMs: 58 * 60_000 });
    expect(cooldownSeconds(hit!.remainingMs)).toBe(58 * 60);
  });

  it("still reports the longest when the specific track cooldown has elapsed", () => {
    record("spotify:track:1", "alice", "artist-ateez", 0);
    const now = 10 * 60_000; // 10 minutes later: track window (5m) is spent.
    const hit = resolveCooldown(
      track(),
      "alice",
      { noRepeatMinutes: 5, artistCooldownMinutes: 58, userArtistCooldownMinutes: 22 },
      now
    );
    expect(hit).toEqual({ reason: "artist-recently-played", remainingMs: 48 * 60_000 });
  });
});

describe("cooldownSeconds", () => {
  it("rounds up, so a nearly-expired cooldown never reports 0", () => {
    expect(cooldownSeconds(400)).toBe(1);
    expect(cooldownSeconds(1)).toBe(1);
  });

  it("rounds up a partial second", () => {
    expect(cooldownSeconds(1400)).toBe(2);
  });

  it("reports 0 for no remaining wait", () => {
    expect(cooldownSeconds(0)).toBe(0);
  });
});
