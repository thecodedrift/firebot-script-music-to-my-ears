import { getFirebotVersion, initModules, logger } from "./modules";
import { clear, count, snapshot } from "./services/debugLog";
import { Params } from "./types/params";

const params: Params = {
  spotifyClientId: "",
  spotifyClientSecret: "",
  spotifyCountryCode: "",
  spotifyBlockList: "",
};

const ctx = {
  scriptVersion: "9.9.9",
  firebotVersion: undefined,
  params,
};

beforeEach(() => {
  clear();
});

describe("logger proxy", () => {
  it("records into the debug log and forwards to Firebot", () => {
    const firebotLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initModules({ logger: firebotLogger } as any, params, "5.63.0");

    logger.warn("careful", { detail: 1 });

    expect(firebotLogger.warn).toHaveBeenCalledWith("careful", { detail: 1 });
    expect(snapshot(ctx)).toContain('[warn] careful {"detail":1}');
    expect(getFirebotVersion()).toBe("5.63.0");
  });

  it("keeps the record when forwarding to Firebot throws", () => {
    const boom = () => {
      throw new Error("firebot logger exploded");
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initModules({ logger: { debug: boom, info: boom, warn: boom, error: boom } } as any, params);

    expect(() => logger.error("the thing that broke")).toThrow();
    expect(count()).toBe(1);
    expect(snapshot(ctx)).toContain("the thing that broke");
  });
});
