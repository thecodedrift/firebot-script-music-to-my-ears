import script from "./main";

function makeHarness() {
  const registered = new Map<string, unknown>();
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
  };
  return { registered, modules };
}

const runRequest = (modules: unknown) => ({
  parameters: { spotifyClientId: "", spotifyClientSecret: "", spotifyCountryCode: "" },
  modules,
  trigger: { type: "startup_script", metadata: {} },
  firebot: {},
  scriptDataDir: "",
});

describe("script lifecycle", () => {
  it("exposes the expected configuration parameters", () => {
    const params = script.getDefaultParameters();
    // The no-repeat window used to live here. It moved to each Request Song
    // effect so it takes effect without a Firebot restart.
    expect(Object.keys(params).sort()).toEqual([
      "spotifyClientId",
      "spotifyClientSecret",
      "spotifyCountryCode",
    ]);
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
});
