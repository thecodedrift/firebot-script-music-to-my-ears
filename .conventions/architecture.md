# Architecture: Firebot "Music to My Ears" Custom Script

This document defines the architecture and conventions for this Firebot custom script. It is
derived from a survey of the official Firebot tooling and representative OSS community scripts
(see [References](#references)).

## 1. What this is

Firebot (by Crowbar Tools) is an open-source Twitch streaming bot. A *custom script* extends
Firebot by registering effects, events, replace variables, commands, HTTP routes, and/or full
integrations at runtime. Firebot loads each script as a **single CommonJS `.js` file** that it
`require()`s and whose **default export** is the script object.

This project is music-related (now-playing, song requests, etc.). The reference implementation
for this shape is [Oceanity/firebot-spotify](https://github.com/Oceanity/firebot-spotify); the
canonical tooling base is
[crowbartools/firebot-custom-script-starter](https://github.com/crowbartools/firebot-custom-script-starter).

## 2. Hard constraints (do not violate)

1. **Single-file bundle.** Firebot loads exactly one `.js` file. The build must produce one
   self-contained CommonJS file (no separate `.LICENSE.txt`, no code-splitting).
2. **Default export is the script object.** Bundle with `libraryTarget: "commonjs2"` +
   `libraryExport: "default"`.
3. **Do not mangle the script's public function names.** Terser must keep `run`,
   `getScriptManifest`, `getDefaultParameters` (use `mangle: false`, `keep_fnames: /main/`,
   `extractComments: false`). Keep the exported script object in `src/main.ts`.
4. **Namespace all registered IDs** as `author:name` (e.g. `music-to-my-ears:now-playing`) to
   avoid collisions with built-in or other scripts' effects/events/variables.
5. **Clean up in `stop()`.** Anything registered in `run()` (effects, event sources, variables,
   commands, routes, timers, polling loops) must be unregistered/cancelled in `stop()`.

## 3. The script object

A script is a single object typed `Firebot.CustomScript<Params>`, default-exported from
`src/main.ts`. Source of truth for all types: `@crowbartools/firebot-custom-scripts-types`.

```ts
import { Firebot } from "@crowbartools/firebot-custom-scripts-types";

interface Params {
  // user-configurable parameters, typed
}

const script: Firebot.CustomScript<Params> = {
  getScriptManifest: () => ({
    name: "Music to My Ears",
    description: "...",
    author: "...",
    version: "1.0.0",
    firebotVersion: "5",
    startupOnly: true, // required for scripts that register effects/events/variables/etc.
  }),
  getDefaultParameters: () => ({ /* ParametersConfig<Params> */ }),
  run: (runRequest) => { /* register everything here */ },
  parametersUpdated: (parameters) => { /* react to settings changes */ },
  stop: (uninstalling) => { /* unregister + tear down */ },
};

export default script;
```

### Lifecycle

- `getScriptManifest()` / `getDefaultParameters()` — read by Firebot to render the script UI.
- `run(runRequest)` — **startup scripts** (`startupOnly: true`) run this **once at app boot** and
  when first added; `trigger.type === "startup_script"`. This is where registration happens.
  Non-startup scripts run `run()` per invocation and may return a `ScriptReturnObject` with
  effects to execute.
- `parametersUpdated(parameters)` — called when the user saves new parameter values.
- `stop(uninstalling?)` — called when the script is stopped; `uninstalling` distinguishes a delete
  from a normal stop (tear down persistent things like webhooks when uninstalling).

### `RunRequest<Params>`

```ts
type RunRequest<P> = {
  parameters: P;                  // resolved user values
  modules: ScriptModules;         // the injected Firebot API (see §4)
  firebot: { accounts: { streamer; bot }, settings, version };
  trigger: Trigger;               // what invoked the script
  scriptDataDir: string;          // per-script writable directory
};
```

## 4. `runRequest.modules` (the Firebot API)

Everything is accessed via `runRequest.modules`. Key modules for this project:

| Module | Use |
| --- | --- |
| `logger` | `debug/info/warn/error` — use everywhere instead of `console`. |
| `effectManager` | `registerEffect` / `unregisterEffect`. |
| `eventManager` | `registerEventSource` / `unregisterEventSource` / `triggerEvent`. |
| `replaceVariableManager` | `registerReplaceVariable` / `unregisterReplaceVariable`. |
| `commandManager` | `registerSystemCommand` / `unregisterSystemCommand`. |
| `integrationManager` | `registerIntegration` (OAuth-linkable integrations). |
| `httpServer` | `registerCustomRoute`, `sendToOverlay`, WebSocket listeners. |
| `frontendCommunicator` | backend↔Angular UI IPC (`send`/`on`/`onAsync`). |
| `twitchApi` | Twitch Helix API + `twitchApi.chat`. |
| `utils`, `moment`, `path` | helpers / Node passthroughs. |

Notes: `fs` and `twitchChat` modules are **deprecated** — use Node's built-in `fs` and
`twitchApi.chat`. Some modules (`howler`, `JsonDb`) are typed `unknown`; the type carries an
`[x: string]: unknown` index signature for not-yet-typed modules.

## 5. Project structure

Folder-per-concern, with an `index.ts` aggregator array per folder. The entry point loops the
arrays and registers each item. Adding a feature = add a file + add it to the folder's index array.

```
src/
  main.ts                     # entry: manifest, params, run/stop; default export
  integration.ts              # (if OAuth) Firebot Integration definition + token refresh
  firebot/
    effects/
      index.ts                # export const AllEffects = [ ... ]
      nowPlayingEffect.ts     # one Firebot.EffectType per file
    events/
      index.ts                # the EventSource (id, name, events[])
    variables/
      index.ts                # export const AllVariables = [ ...trackVars, ...playerVars ]
      track/                  # domain subfolders, each with its own index.ts
      player/
    commands/
      index.ts                # export const AllCommands = [ ... ] (if any system commands)
    routes/
      index.ts                # custom HTTP routes (if any)
  services/                   # API client, auth, polling/state — framework-agnostic logic
    api.ts                    # single fetch<T>() helper: base URL + auth header + errors
    auth.ts                   # token acquisition/refresh
    state.ts                  # now-playing poll loop + state diffing -> events
  shared/                     # constants, enums (e.g. OutputDataType)
  modules.ts                  # initModules(runRequest.modules): stash modules as module-scoped
                              # singletons so deep files import logger/managers w/o prop-drilling
  types/                      # local type augmentations (api.ts, *.d.ts)
scripts/copy-build.(js|ts)    # deploy dist/<name>.js into Firebot's active profile scripts dir
webpack.config.(js|ts)
tsconfig.json
jest.config.(js|ts)
.prettierrc
package.json
```

### Registration pattern (in `run()`)

```ts
run: (runRequest) => {
  initModules(runRequest.modules);           // stash singletons
  const { effectManager, replaceVariableManager, eventManager } = runRequest.modules;

  for (const effect of AllEffects) {
    effect.definition.id = `${NAMESPACE}:${effect.definition.id}`;
    effectManager.registerEffect(effect);
  }
  for (const variable of AllVariables) replaceVariableManager.registerReplaceVariable(variable);
  EventSource.id = NAMESPACE;
  eventManager.registerEventSource(EventSource);
  // ... routes, commands, then start polling
};
```

`initModules` (a `src/modules.ts` singleton) avoids prop-drilling `runRequest` into every file:
deep modules `import { logger, effectManager } from "../modules"`.

## 6. Building blocks

### Effects — `Firebot.EffectType<Model>`
`definition` (namespaced `id`, `name`, `description`, `icon`, `categories`, optional `triggers`,
`outputs`) + an AngularJS `optionsTemplate` string (+ optional `optionsController`,
`optionsValidator`) + `onTriggerEvent({ effect, trigger, sendDataToOverlay, abortSignal })`.

> **Return-value gotcha — the top-level `success` gates outputs.** `onTriggerEvent`
> returns `{ success, outputs }`. Firebot's effect-runner
> (`src/backend/common/effect-runner.js`) **only registers `outputs` when the
> top-level `success` is truthy** — on `success: false` it logs the effect as
> failed and discards `outputs` entirely, so every output (including any
> `errorReason`) reaches downstream effects as empty. Therefore the top-level
> `success` means "did the effect *run to completion*?", **not** "did the request
> succeed?". An effect that evaluates a request and reports a failure reason ran
> fine — return top-level `success: true` and encode the real pass/fail in an
> **`outputs.success`** field (what the streamer branches on via
> `$effectOutput[success]`). Only return top-level `success: false` when the effect
> genuinely could not execute and has no outputs worth surfacing.

### Events — `EventSource`
A plain object `{ id, name, events: [{ id, name, description, cached? }, ...] }`. Fire with
`eventManager.triggerEvent(sourceId, eventId, meta)`. For music: `track-changed`,
`playback-state-changed`, `volume-changed`, a periodic `tick` carrying `progressMs`, etc.

### Replace variables — `ReplaceVariable`
`definition` (`handle`, `description`, `usage`, `examples`, `possibleDataOutput`) + an async
`evaluator(trigger, ...args)`. Provide a flexible `$thing[field]` variable (returns the whole
object when no field given), plus granular single-field variables and `raw*` variables exposing
the unmodified API object.

### Commands — `SystemCommand`
Register via `commandManager.registerSystemCommand({ definition, onTriggerEvent })`.

### HTTP routes / overlay — `httpServer`
`registerCustomRoute(prefix, route, method, handler)` →
`http://localhost:7472/integrations/<prefix>/<route>`. Push to the overlay with
`sendToOverlay(eventName, data)`.

## 7. Music-specific patterns

If integrating an OAuth music service (Spotify, etc.):

- **Register a Firebot Integration**, not a bare script, so Firebot manages the OAuth link UI,
  callback (`http://127.0.0.1:7472/api/v1/auth/callback`), and token storage. Configure
  `authProviderDetails` with `autoRefreshToken: true`; take client id/secret as script parameters.
- **API layer:** one `fetch<T>(endpoint, method, options)` helper that injects the base URL +
  `Authorization: Bearer <token>` (token fetched lazily, refreshed on expiry) and throws a typed
  error on non-OK responses.
- **Polling:** a **self-rescheduling async loop with adaptive backoff** (not `setInterval`):
  ~1s while playing, ~5s when idle, ~15s when unlinked or on error. Each poll diffs against the
  last-known state and emits only the granular events that changed; fire a per-tick event with
  `progressMs`. Cancel the loop in `stop()`.
- **Now-playing data** is exposed as replace variables (see §6).

## 8. Tooling & conventions

- **Build:** Webpack 5 + `ts-loader` + `terser-webpack-plugin`. `scriptOutputName` in
  `package.json` drives both the output filename and the copy-build deploy script.
  - `package.json` scripts: `build` (webpack), `build:dev` (`build` + `copy`),
    `copy` (deploy into Firebot's profile scripts dir), `test` (jest).
- **TypeScript:** `module: CommonJS`, `moduleResolution: node`, `target` ES2022 (ES6 acceptable),
  `allowSyntheticDefaultImports`, `experimentalDecorators`, `downlevelIteration`, `strict`,
  `noImplicitAny`, `sourceMap`. `include: ["./src/**/*"]`. Path aliases (`@`, `@utils`, …) optional.
- **Types dependency:** `@crowbartools/firebot-custom-scripts-types` (devDependency) — the source
  of truth for all Firebot types. Keep it reasonably current.
- **Lint/format:** Prettier (2-space, no tabs) + `@typescript-eslint` + `eslint-config-prettier`.
- **Tests:** Jest + `ts-jest`, `*.test.ts` colocated next to source, plus a `mocks/firebot.ts`
  fixture for the modules API.
- **Logging:** always use `runRequest.modules.logger` (never `console`).

## References

- Types package (source of truth): https://github.com/crowbartools/firebot-custom-scripts-types
- Official starter template: https://github.com/crowbartools/firebot-custom-script-starter
- Music reference implementation: https://github.com/Oceanity/firebot-spotify
- Single-effect example: https://github.com/brumoen/firebot-overlayTimer
- Legacy community collection: https://github.com/crowbartools/FirebotScripts
- Firebot repo & docs: https://github.com/crowbartools/Firebot · https://docs.firebot.app/v5/dev/scripts
