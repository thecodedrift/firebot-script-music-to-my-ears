import { ScriptModules } from "@crowbartools/firebot-custom-scripts-types";
import { Logger } from "@crowbartools/firebot-custom-scripts-types/types/modules/logger";
import { LogLevel, record as recordDebugLog } from "./services/debugLog";
import { Params } from "./types/params";

/**
 * Module-scoped singletons so deep files can reach Firebot modules and the
 * current parameters without prop-drilling `runRequest` everywhere.
 *
 * `initModules` must be called first thing in `run()`.
 */
let modules: ScriptModules | undefined;
let params: Params | undefined;
let firebotVersion: string | undefined;

export function initModules(
  scriptModules: ScriptModules,
  scriptParams: Params,
  hostVersion?: string
): void {
  modules = scriptModules;
  params = scriptParams;
  firebotVersion = hostVersion;
}

export function getModules(): ScriptModules {
  if (!modules) {
    throw new Error("Script modules accessed before initModules() was called");
  }
  return modules;
}

export function getParams(): Params {
  if (!params) {
    throw new Error("Script parameters accessed before initModules() was called");
  }
  return params;
}

/** Replace the cached parameters (called from `parametersUpdated`). */
export function setParams(scriptParams: Params): void {
  params = scriptParams;
}

/**
 * The Firebot version this script is running under, for the debug log header.
 * `undefined` until `initModules` runs, and on any host that omits it.
 */
export function getFirebotVersion(): string | undefined {
  return firebotVersion;
}

/**
 * Thin proxy so callers can `import { logger }` and log at any time.
 *
 * Every call is also captured in the script's own session debug log. Recording
 * happens BEFORE forwarding on purpose: this proxy throws when it is called
 * before `initModules`, and a record that never reached Firebot is exactly the
 * kind we most want to have kept.
 */
function proxy(level: LogLevel): Logger[LogLevel] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (msg: string, ...meta: any[]) => {
    recordDebugLog(level, msg, meta);
    getModules().logger[level](msg, ...meta);
  };
}

export const logger: Logger = {
  debug: proxy("debug"),
  info: proxy("info"),
  warn: proxy("warn"),
  error: proxy("error"),
};
