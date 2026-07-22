import { errorTextFor, formatCooldown } from "./errorText";
import { ErrorReason } from "../shared/types";

const ALL_REASONS: ErrorReason[] = [
  "not-found",
  "not-playable",
  "blocked-term",
  "blocked-artist",
  "blocked-track",
  "explicit",
  "too-long",
  "recently-played",
  "artist-recently-played",
  "user-artist-recently-played",
  "no-active-device",
  "not-premium",
  "not-linked",
  "unknown",
];

describe("errorTextFor", () => {
  it("returns the empty string on success, mirroring errorReason", () => {
    expect(errorTextFor("")).toBe("");
  });

  it("produces a non-empty message for every reason", () => {
    for (const reason of ALL_REASONS) {
      expect(errorTextFor(reason, { trackName: "Song", artistName: "Artist", cooldown: 60 })).not
        .toBe("");
    }
  });

  it("never leaves an unsubstituted placeholder", () => {
    for (const reason of ALL_REASONS) {
      const text = errorTextFor(reason, { trackName: "Song", artistName: "Artist", cooldown: 60 });
      expect(text).not.toMatch(/[{}]/);
    }
  });

  it("substitutes an artist name containing a dollar sign intact", () => {
    // A$AP Rocky is a real artist. `$` is Firebot's variable sigil, so a
    // `$`-based template would mangle this. Braces do not.
    const text = errorTextFor("artist-recently-played", {
      artistName: "A$AP Rocky",
      cooldown: 120,
    });
    expect(text).toContain("A$AP Rocky");
    expect(text).toBe("A$AP Rocky was played recently. Try again in 2 minutes.");
  });

  it("does not blame the requester for the global artist cooldown", () => {
    const text = errorTextFor("artist-recently-played", { artistName: "ATEEZ", cooldown: 60 });
    expect(text.toLowerCase()).not.toContain("you");
    expect(text).toContain("ATEEZ was played recently");
  });

  it("does address the requester for the per-requester artist cooldown", () => {
    const text = errorTextFor("user-artist-recently-played", { artistName: "ATEEZ", cooldown: 60 });
    expect(text).toContain("You've already requested ATEEZ");
  });

  it("falls back when a name is missing", () => {
    expect(errorTextFor("too-long")).toBe("That track is too long to add to the queue.");
  });

  it("does not leak a literal placeholder when a cooldown is missing", () => {
    expect(errorTextFor("recently-played", { trackName: "Song" })).not.toContain("{cooldown}");
  });
});

describe("formatCooldown", () => {
  it("renders seconds below a minute", () => {
    expect(formatCooldown(45)).toBe("45 seconds");
    expect(formatCooldown(1)).toBe("1 second");
  });

  it("renders whole minutes", () => {
    expect(formatCooldown(120)).toBe("2 minutes");
    expect(formatCooldown(60)).toBe("1 minute");
  });

  it("rounds a partial minute up, so the advice is never early", () => {
    expect(formatCooldown(61)).toBe("2 minutes");
  });
});
