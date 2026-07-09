import { requestSongEffect } from "./requestSongEffect";
import { queueTrack, searchTrack } from "../../services/api";

jest.mock("../../modules", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  getModules: jest.fn(),
  getParams: jest.fn(() => ({ noRepeatMinutes: 30 })),
}));

jest.mock("../../services/api", () => ({
  ...jest.requireActual("../../services/api"),
  searchTrack: jest.fn(),
  queueTrack: jest.fn(),
}));

const track = {
  uri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa",
  name: "Seven Dollars",
  artist: "Happy Birthday Mr. Baskets",
  artists: ["Happy Birthday Mr. Baskets"],
  explicit: false,
  durationMs: 235000,
};

const trigger = { metadata: { username: "someviewer" } };

function runEffect(effect: Record<string, unknown>) {
  const onTriggerEvent = requestSongEffect.onTriggerEvent as (arg: unknown) => Promise<unknown>;
  return onTriggerEvent({ effect, trigger });
}

describe("requestSongEffect logging option", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (searchTrack as jest.Mock).mockResolvedValue(track);
    (queueTrack as jest.Mock).mockResolvedValue(undefined);
  });

  it("defaults the checkbox to off in the options controller", () => {
    const scope = { effect: {} as Record<string, unknown> };
    const controller = requestSongEffect.optionsController as (s: unknown) => void;
    controller(scope);

    expect(scope.effect.enableLogging).toBe(false);
  });

  it("renders the Enable logging checkbox bound to the model", () => {
    expect(requestSongEffect.optionsTemplate).toContain('ng-model="effect.enableLogging"');
    expect(requestSongEffect.optionsTemplate).toContain("Enable logging");
  });

  it("passes log: false to searchTrack when the box is unchecked", async () => {
    await runEffect({ query: "seven dollars", blockedTerms: [] });

    expect(searchTrack).toHaveBeenCalledWith("seven dollars", { log: false });
  });

  it("passes log: true to searchTrack when the box is checked", async () => {
    await runEffect({ query: "seven dollars", blockedTerms: [], enableLogging: true });

    expect(searchTrack).toHaveBeenCalledWith("seven dollars", { log: true });
  });
});
