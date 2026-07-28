import script from "./main";
import { clear as clearDebugLog, count, record } from "./services/debugLog";

type FrontendHandler = () => Promise<void>;

function makeHarness() {
  const registered = new Map<string, unknown>();
  const handlers = new Map<string, { id: string; handler: FrontendHandler }>();
  const offCalls: Array<{ event: string; id: string }> = [];
  const sent: Array<{ event: string; data: unknown }> = [];
  const modules = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    effectManager: {
      registerEffect: (effect: { definition: { id: string } }) =>
        registered.set(effect.definition.id, effect),
      unregisterEffect: (id: string) => registered.delete(id),
    },
    integrationManager: {
      registerIntegration() {},
      getIntegrationById: () => ({}),
      saveIntegrationAuth() {},
    },
    frontendCommunicator: {
      onAsync: (event: string, handler: FrontendHandler) => {
        const id = `handler-id-for-${event}`;
        handlers.set(event, { id, handler });
        return id;
      },
      // Firebot's `off(eventName, id)` removes ONE handler, identified by the id
      // `onAsync` returned — so this mock unregisters only on an id match. A
      // caller that forgets the id, or passes the wrong one, leaves the handler
      // registered and fails the teardown test rather than passing silently.
      off: (event: string, id: string) => {
        offCalls.push({ event, id });
        if (handlers.get(event)?.id === id) {
          handlers.delete(event);
        }
      },
      send: (event: string, data: unknown) => sent.push({ event, data }),
    },
  };
  return { registered, handlers, offCalls, sent, modules };
}

const runRequest = (modules: unknown) => ({
  parameters: {
    spotifyClientId: "",
    spotifyClientSecret: "",
    spotifyCountryCode: "",
    spotifyBlockList: "",
  },
  modules,
  trigger: { type: "startup_script", metadata: {} },
  firebot: { version: "5.63.0" },
  scriptDataDir: "",
});

beforeEach(() => {
  clearDebugLog();
});

describe("script lifecycle", () => {
  it("exposes the expected configuration parameters", () => {
    const params = script.getDefaultParameters();
    // The no-repeat window used to live here. It moved to each Request Song
    // effect so it takes effect without a Firebot restart.
    expect(Object.keys(params).sort()).toEqual([
      "copyDebugLog",
      "spotifyBlockList",
      "spotifyClientId",
      "spotifyClientSecret",
      "spotifyCountryCode",
    ]);
  });

  it("renders the debug log button last, with the script version", () => {
    const params = script.getDefaultParameters();
    const keys = Object.keys(params);

    expect(keys[keys.length - 1]).toBe("copyDebugLog");
    const button = params.copyDebugLog as { type: string; title: string; backendEventName: string };
    expect(button.type).toBe("button");
    expect(button.title).toMatch(/v\d+\.\d+\.\d+/);
    expect(button.backendEventName).toBe("music-to-my-ears:copy-debug-log");
  });

  it("registers five namespaced effects in run() and tears them all down in stop()", () => {
    const { registered, modules } = makeHarness();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    script.run(runRequest(modules) as any);
    expect(registered.size).toBe(5);
    for (const id of registered.keys()) {
      expect(id.startsWith("music-to-my-ears:")).toBe(true);
    }

    script.stop?.();
    expect(registered.size).toBe(0);
  });

  it("registers the copy-debug-log handler in run() and removes it in stop()", () => {
    const { handlers, offCalls, modules } = makeHarness();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    script.run(runRequest(modules) as any);
    const registration = handlers.get("music-to-my-ears:copy-debug-log");
    expect(registration).toBeDefined();

    script.stop?.();

    expect(handlers.has("music-to-my-ears:copy-debug-log")).toBe(false);
    // `off` takes the id `onAsync` returned, not just the event name — assert
    // the id actually makes the round trip rather than trusting the call count.
    expect(offCalls).toEqual([
      { event: "music-to-my-ears:copy-debug-log", id: registration!.id },
    ]);
  });

  it("clears the debug log in stop()", () => {
    const { modules } = makeHarness();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    script.run(runRequest(modules) as any);
    expect(count()).toBeGreaterThan(0);

    script.stop?.();
    expect(count()).toBe(0);
  });

  it("hands the snapshot to Firebot's clipboard when the button is clicked", async () => {
    const { handlers, sent, modules } = makeHarness();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    script.run(runRequest(modules) as any);
    record("warn", "something went sideways");
    await handlers.get("music-to-my-ears:copy-debug-log")?.handler();

    expect(sent).toHaveLength(1);
    expect(sent[0].event).toBe("copy-to-clipboard");
    const { text, toastMessage } = sent[0].data as { text: string; toastMessage: string };
    expect(text).toContain("something went sideways");
    expect(text).toContain("Firebot version: 5.63.0");
    expect(toastMessage).toMatch(/copied/i);

    script.stop?.();
  });
});
