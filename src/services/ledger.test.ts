import {
  artistKey,
  clear,
  record,
  remainingMs,
  requesterOf,
  trackKey,
  userArtistKey,
} from "./ledger";

const URI = "spotify:track:1";
const ARTIST = "artist-1";

describe("ledger keys", () => {
  it("namespaces each keyspace distinctly", () => {
    expect(trackKey(URI)).toBe("track:spotify:track:1");
    expect(artistKey(ARTIST)).toBe("artist:artist-1");
    expect(userArtistKey("Alice", ARTIST)).toBe("user-artist:alice:artist-1");
  });

  it("lowercases the username so display-name casing collapses to one bucket", () => {
    expect(userArtistKey("ALICE", ARTIST)).toBe(userArtistKey("alice", ARTIST));
  });
});

describe("remainingMs", () => {
  beforeEach(() => clear());

  it("reports the remaining window for a recorded key", () => {
    record(URI, "alice", ARTIST, 1000);
    expect(remainingMs(trackKey(URI), 5000, 3000)).toBe(3000);
  });

  it("reports 0 once the window has elapsed", () => {
    record(URI, "alice", ARTIST, 1000);
    expect(remainingMs(trackKey(URI), 1000, 3000)).toBe(0);
  });

  it("reports 0 exactly at the window boundary", () => {
    record(URI, "alice", ARTIST, 1000);
    expect(remainingMs(trackKey(URI), 2000, 3000)).toBe(0);
  });

  it("treats a window of 0 as disabled", () => {
    record(URI, "alice", ARTIST, 1000);
    expect(remainingMs(trackKey(URI), 0, 1000)).toBe(0);
  });

  it("treats a negative window as disabled", () => {
    record(URI, "alice", ARTIST, 1000);
    expect(remainingMs(trackKey(URI), -1, 1000)).toBe(0);
  });

  it("reports 0 for a key that was never recorded", () => {
    expect(remainingMs(trackKey("spotify:track:unknown"), 5000, 1000)).toBe(0);
  });
});

describe("record", () => {
  beforeEach(() => clear());

  it("writes the track, artist, and requester-artist keys together", () => {
    record(URI, "alice", ARTIST, 1000);

    expect(remainingMs(trackKey(URI), 5000, 1000)).toBe(5000);
    expect(remainingMs(artistKey(ARTIST), 5000, 1000)).toBe(5000);
    expect(remainingMs(userArtistKey("alice", ARTIST), 5000, 1000)).toBe(5000);
  });

  it("writes artist keys unconditionally, so a lax effect cannot hole a strict one", () => {
    // The effect that queued this had its artist cooldown disabled; it still
    // records, and an effect reading with a non-zero window observes the entry.
    record(URI, "alice", ARTIST, 1000);
    expect(remainingMs(artistKey(ARTIST), 60_000, 1000)).toBe(60_000);
  });

  it("writes no requester-artist key when the requester is blank", () => {
    record(URI, "", ARTIST, 1000);

    expect(remainingMs(artistKey(ARTIST), 5000, 1000)).toBe(5000);
    expect(remainingMs(userArtistKey("", ARTIST), 5000, 1000)).toBe(0);
  });

  it("writes only the track key when the track has no primary artist", () => {
    record(URI, "alice", undefined, 1000);

    expect(remainingMs(trackKey(URI), 5000, 1000)).toBe(5000);
    expect(remainingMs(artistKey(ARTIST), 5000, 1000)).toBe(0);
  });

  it("keys different requesters of the same artist separately", () => {
    record(URI, "alice", ARTIST, 1000);

    expect(remainingMs(userArtistKey("alice", ARTIST), 5000, 1000)).toBe(5000);
    expect(remainingMs(userArtistKey("bob", ARTIST), 5000, 1000)).toBe(0);
  });
});

describe("requesterOf", () => {
  beforeEach(() => clear());

  it("returns the recorded requester for a track URI", () => {
    record(URI, "alice", ARTIST, 1000);
    expect(requesterOf(URI)).toBe("alice");
  });

  it("returns undefined for an unknown URI", () => {
    expect(requesterOf("spotify:track:unknown")).toBeUndefined();
  });
});

describe("clear", () => {
  it("empties every keyspace", () => {
    record(URI, "alice", ARTIST, 1000);
    clear();

    expect(requesterOf(URI)).toBeUndefined();
    expect(remainingMs(artistKey(ARTIST), 5000, 1000)).toBe(0);
    expect(remainingMs(userArtistKey("alice", ARTIST), 5000, 1000)).toBe(0);
  });
});
