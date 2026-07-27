import { clear, count, record, snapshot } from "./debugLog";
import { Params } from "../types/params";

const params = (over: Partial<Params> = {}): Params => ({
  spotifyClientId: "",
  spotifyClientSecret: "",
  spotifyCountryCode: "",
  spotifyBlockList: "",
  ...over,
});

const ctx = (over: Partial<Parameters<typeof snapshot>[0]> = {}) => ({
  scriptVersion: "9.9.9",
  firebotVersion: "5.63.0",
  params: params(),
  ...over,
});

beforeEach(() => {
  clear();
});

describe("record", () => {
  it("captures every level, labeled and timestamped", () => {
    record("debug", "d");
    record("info", "i");
    record("warn", "w");
    record("error", "e");

    const text = snapshot(ctx());
    for (const level of ["debug", "info", "warn", "error"]) {
      expect(text).toMatch(new RegExp(`^\\S+Z \\[${level}\\] `, "m"));
    }
  });

  it("appends metadata arguments to the message", () => {
    record("info", "queued", [{ uri: "spotify:track:abc" }, "extra"]);

    expect(snapshot(ctx())).toContain('queued {"uri":"spotify:track:abc"} extra');
  });

  it("renders an Error as its stack rather than as {}", () => {
    record("error", "failed", [new Error("boom")]);

    expect(snapshot(ctx())).toContain("Error: boom");
  });

  it("survives metadata JSON.stringify cannot handle", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => record("info", "cycle", [circular])).not.toThrow();
    expect(count()).toBe(1);
  });

  it("drops the oldest records past the record cap", () => {
    for (let i = 0; i < 2100; i++) {
      record("debug", `record-${i}`);
    }

    expect(count()).toBe(2000);
    const text = snapshot(ctx());
    expect(text).not.toContain("record-0 ");
    expect(text).toContain("record-2099");
  });

  it("drops the oldest records past the total size cap", () => {
    // 100 × 16 KB is well past the 1 MB budget, so the early ones must go.
    const big = "x".repeat(16_000);
    for (let i = 0; i < 100; i++) {
      record("debug", `${i}:${big}`);
    }

    expect(count()).toBeLessThan(100);
    expect(snapshot(ctx())).toContain("99:");
  });

  it("truncates a single oversized record and says how much it dropped", () => {
    record("debug", "y".repeat(20_000));

    const text = snapshot(ctx());
    expect(text).toContain("[truncated 4000 characters]");
    expect(count()).toBe(1);
  });

  it("clears everything", () => {
    record("info", "gone");
    clear();

    expect(count()).toBe(0);
  });
});

describe("snapshot", () => {
  it("names the script and host versions", () => {
    const text = snapshot(ctx());

    expect(text).toContain("Script version:  9.9.9");
    expect(text).toContain("Firebot version: 5.63.0");
    expect(text).toContain(`Node:            ${process.versions.node}`);
    expect(text).toContain(process.platform);
  });

  it("reports an unknown Firebot version rather than omitting the line", () => {
    expect(snapshot(ctx({ firebotVersion: undefined }))).toContain("Firebot version: unknown");
  });

  it("reports credentials as set without disclosing them", () => {
    const text = snapshot(
      ctx({
        params: params({
          spotifyClientId: "the-client-id",
          spotifyClientSecret: "the-client-secret",
        }),
      })
    );

    expect(text).toContain("Spotify client id:     set");
    expect(text).toContain("Spotify client secret: set");
    expect(text).not.toContain("the-client-id");
    expect(text).not.toContain("the-client-secret");
  });

  it("reports missing credentials as not set", () => {
    const text = snapshot(ctx());

    expect(text).toContain("Spotify client id:     not set");
    expect(text).toContain("Spotify client secret: not set");
  });

  it("counts the blocklist instead of quoting it", () => {
    const text = snapshot(ctx({ params: params({ spotifyBlockList: "nickelback\n\nkaraoke" }) }));

    expect(text).toContain("Global blocklist:      2 entries");
    expect(text).not.toContain("nickelback");
  });

  it("shows the Country of Play verbatim, or marks it unset", () => {
    expect(snapshot(ctx({ params: params({ spotifyCountryCode: "DE" }) }))).toContain(
      "Country of Play:       DE"
    );
    expect(snapshot(ctx())).toContain("Country of Play:       (unset)");
  });

  it("still produces the header when nothing was captured", () => {
    const text = snapshot(ctx());

    expect(text).toContain("Records: 0");
    expect(text).toContain("No records were captured this session.");
  });

  it("survives parameters that were never initialized", () => {
    expect(() => snapshot(ctx({ params: undefined }))).not.toThrow();
  });
});
