import { Track } from "../shared/types";
import {
  findBlock,
  isExplicitBlocked,
  isTooLong,
  parseBlockEntry,
  parseBlockList,
} from "./moderation";

// A real 22-char base62 track id (Stray Kids / Young Miko — "Come Play"), plus a
// stand-in artist id, so the id-shaped tests exercise the real matcher.
const TRACK_ID = "37ozVDmL5b6NNVWFYgAlkz";
const ARTIST_ID = "2SI7Y8t34pQv0KOfj0lAd5";

const track = (over: Partial<Track> = {}): Track => ({
  uri: `spotify:track:${TRACK_ID}`,
  name: "Song",
  artist: "Artist",
  artists: ["Artist"],
  artistIds: [ARTIST_ID],
  explicit: false,
  durationMs: 1000,
  ...over,
});

describe("parseBlockEntry", () => {
  it("drops a blank or whitespace-only line", () => {
    expect(parseBlockEntry("")).toBeUndefined();
    expect(parseBlockEntry("   ")).toBeUndefined();
  });

  it("classifies plain text as a lowercased term", () => {
    expect(parseBlockEntry("  Karaoke ")).toEqual({
      kind: "term",
      value: "karaoke",
      raw: "Karaoke",
    });
  });

  it("classifies a track URI", () => {
    expect(parseBlockEntry(`spotify:track:${TRACK_ID}`)).toMatchObject({
      kind: "track",
      value: TRACK_ID,
    });
  });

  it("classifies an artist URI", () => {
    expect(parseBlockEntry(`spotify:artist:${ARTIST_ID}`)).toMatchObject({
      kind: "artist",
      value: ARTIST_ID,
    });
  });

  it("classifies a track link, ignoring the query string", () => {
    expect(parseBlockEntry(`https://open.spotify.com/track/${TRACK_ID}?si=abc123`)).toMatchObject({
      kind: "track",
      value: TRACK_ID,
    });
  });

  it("classifies an artist link", () => {
    expect(parseBlockEntry(`https://open.spotify.com/artist/${ARTIST_ID}`)).toMatchObject({
      kind: "artist",
      value: ARTIST_ID,
    });
  });

  it("tolerates the localized-client intl prefix in a link", () => {
    expect(parseBlockEntry(`https://open.spotify.com/intl-de/track/${TRACK_ID}`)).toMatchObject({
      kind: "track",
      value: TRACK_ID,
    });
  });

  it("classifies a bare 22-char id as untyped", () => {
    expect(parseBlockEntry(TRACK_ID)).toMatchObject({ kind: "id", value: TRACK_ID });
  });
});

describe("parseBlockList", () => {
  it("splits a newline string, dropping blank lines", () => {
    expect(parseBlockList("karaoke\n\n  \ninstrumental")).toEqual([
      { kind: "term", value: "karaoke", raw: "karaoke" },
      { kind: "term", value: "instrumental", raw: "instrumental" },
    ]);
  });

  it("accepts a legacy string[] (an effect saved before the textarea)", () => {
    expect(parseBlockList(["karaoke", "inst."])).toEqual([
      { kind: "term", value: "karaoke", raw: "karaoke" },
      { kind: "term", value: "inst.", raw: "inst." },
    ]);
  });

  it("returns nothing for undefined or an empty string", () => {
    expect(parseBlockList(undefined)).toEqual([]);
    expect(parseBlockList("")).toEqual([]);
  });
});

describe("findBlock", () => {
  it("matches a term case-insensitively in the track name", () => {
    const hit = findBlock(track({ name: "Song (Karaoke Version)" }), parseBlockList("karaoke"));
    expect(hit).toEqual({ kind: "term", raw: "karaoke" });
  });

  it("matches a term in the artist name", () => {
    const hit = findBlock(track({ artist: "Karaoke Kings" }), parseBlockList("KARAOKE"));
    expect(hit?.kind).toBe("term");
  });

  it("returns the first matching entry, in order", () => {
    const hit = findBlock(track({ name: "Live Instrumental" }), parseBlockList("nope\ninstrumental"));
    expect(hit?.raw).toBe("instrumental");
  });

  it("blocks a track by its id via a link", () => {
    const hit = findBlock(track(), parseBlockList(`https://open.spotify.com/track/${TRACK_ID}`));
    expect(hit?.kind).toBe("track");
  });

  it("blocks a track by any credited artist id", () => {
    const collab = track({ artistIds: ["someone-else", ARTIST_ID] });
    const hit = findBlock(collab, parseBlockList(`spotify:artist:${ARTIST_ID}`));
    expect(hit?.kind).toBe("artist");
  });

  it("does not block a different track whose name merely resembles the query", () => {
    const other = track({ uri: "spotify:track:0000000000000000000000", artistIds: ["other"] });
    expect(findBlock(other, parseBlockList(`spotify:track:${TRACK_ID}`))).toBeUndefined();
  });

  it("resolves a bare id to a track block when it names the track", () => {
    expect(findBlock(track(), parseBlockList(TRACK_ID))?.kind).toBe("track");
  });

  it("resolves a bare id to an artist block when it names an artist", () => {
    expect(findBlock(track(), parseBlockList(ARTIST_ID))?.kind).toBe("artist");
  });

  it("returns undefined when nothing matches", () => {
    expect(findBlock(track(), parseBlockList("nope"))).toBeUndefined();
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
