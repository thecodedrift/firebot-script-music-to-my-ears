import { Track } from "../shared/types";
import { findBlockedTerm, isExplicitBlocked, isTooLong } from "./moderation";

const track = (over: Partial<Track> = {}): Track => ({
  uri: "spotify:track:1",
  name: "Song",
  artist: "Artist",
  artists: ["Artist"],
  artistIds: ["artist-1"],
  explicit: false,
  durationMs: 1000,
  ...over,
});

describe("findBlockedTerm", () => {
  it("matches a term case-insensitively in the track name", () => {
    expect(findBlockedTerm(track({ name: "Song (Karaoke Version)" }), ["karaoke"])).toBe("karaoke");
  });

  it("matches a term in the artist name", () => {
    expect(findBlockedTerm(track({ artist: "Karaoke Kings" }), ["KARAOKE"])).toBe("karaoke");
  });

  it("returns the first matching term", () => {
    expect(findBlockedTerm(track({ name: "Live Instrumental" }), ["nope", "instrumental"])).toBe(
      "instrumental"
    );
  });

  it("ignores blank/whitespace terms", () => {
    expect(findBlockedTerm(track(), ["", "   "])).toBeUndefined();
  });

  it("returns undefined when nothing matches", () => {
    expect(findBlockedTerm(track(), ["nope"])).toBeUndefined();
  });
});

describe("isExplicitBlocked", () => {
  it("blocks an explicit track when explicit is not allowed", () => {
    expect(isExplicitBlocked(track({ explicit: true }), false)).toBe(true);
  });

  it("allows an explicit track when explicit is allowed", () => {
    expect(isExplicitBlocked(track({ explicit: true }), true)).toBe(false);
  });

  it("never blocks a clean track", () => {
    expect(isExplicitBlocked(track({ explicit: false }), false)).toBe(false);
  });
});

describe("isTooLong", () => {
  it("rejects a track longer than the maximum", () => {
    expect(isTooLong(track({ durationMs: 600_000 }), 420)).toBe(true);
  });

  it("accepts a track just under the maximum", () => {
    expect(isTooLong(track({ durationMs: 419_000 }), 420)).toBe(false);
  });

  it("accepts a track exactly at the maximum", () => {
    expect(isTooLong(track({ durationMs: 420_000 }), 420)).toBe(false);
  });

  it("treats a maximum of 0 as disabled", () => {
    expect(isTooLong(track({ durationMs: 36_000_000 }), 0)).toBe(false);
  });
});
