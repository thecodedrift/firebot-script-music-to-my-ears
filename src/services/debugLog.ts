import { Params } from "../types/params";
import { parseBlockList } from "./moderation";

/**
 * The script's own log of the running Firebot session.
 *
 * Firebot's log file only shows `debug` records when the streamer has raised the
 * global log level, which they almost never have by the time a bug is worth
 * reporting. This buffer is the answer: every record the script emits, at every
 * level, is kept here regardless of what Firebot does with it, and the streamer
 * copies the lot from the script configuration page.
 *
 * Capture happens in the `logger` proxy in `modules.ts`, so no call site can opt
 * out of it or forget to opt in.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Three caps, because no one of them bounds this on its own: a single search
 * diagnostic carries a raw Spotify response and runs to tens of kilobytes, so a
 * record count does not bound memory, and a byte budget alone would let one
 * enormous record evict the entire session. Sized above normal use — a ten-hour
 * session at a request every two minutes is a few thousand records — so these
 * exist to stop a pathological session from growing without bound, and to keep
 * the copied result something a human can paste somewhere.
 */
const MAX_ENTRIES = 2000;
const MAX_TOTAL_CHARS = 1_000_000;
const MAX_ENTRY_CHARS = 16_000;

interface Entry {
  at: string;
  level: LogLevel;
  text: string;
}

let entries: Entry[] = [];
let totalChars = 0;

/** Renders one metadata argument, tolerating values `JSON.stringify` refuses. */
function renderMeta(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular, or a BigInt: never let a log line throw.
    return String(value);
  }
}

function evict(): void {
  while (entries.length > MAX_ENTRIES || totalChars > MAX_TOTAL_CHARS) {
    const dropped = entries.shift();
    if (!dropped) {
      // Defensive: totalChars can only be positive while entries is non-empty.
      totalChars = 0;
      return;
    }
    totalChars -= dropped.text.length;
  }
}

/**
 * Adds one record. Called for every level, including levels Firebot is
 * currently hiding — that is the entire point of this buffer.
 */
export function record(level: LogLevel, message: unknown, meta: unknown[] = []): void {
  const parts = [renderMeta(message), ...meta.map(renderMeta)];
  let text = parts.join(" ");

  if (text.length > MAX_ENTRY_CHARS) {
    const dropped = text.length - MAX_ENTRY_CHARS;
    text = `${text.slice(0, MAX_ENTRY_CHARS)}… [truncated ${dropped} characters]`;
  }

  entries.push({ at: new Date().toISOString(), level, text });
  totalChars += text.length;
  evict();
}

/** How many records are currently retained. */
export function count(): number {
  return entries.length;
}

/** Drops everything. Called from `stop()`, per the teardown requirement. */
export function clear(): void {
  entries = [];
  totalChars = 0;
}

/** What the snapshot header reports about the session it was taken from. */
export interface SnapshotContext {
  scriptVersion: string;
  firebotVersion: string | undefined;
  params: Params | undefined;
}

/** `set` / `not set` — never the value itself. See the header requirement. */
function presence(value: string | undefined): string {
  return value ? "set" : "not set";
}

/**
 * The header describes the state the log is being copied *from*, so it is built
 * at copy time rather than accumulated with the records.
 *
 * It summarizes the configuration instead of dumping it: the client id and
 * secret are reported as set/not-set, and the blocklist as a count. The streamer
 * is about to paste this into a public issue.
 */
function header(ctx: SnapshotContext): string[] {
  const { params } = ctx;
  const country = params?.spotifyCountryCode?.trim();
  return [
    "Music to My Ears — debug log",
    "============================",
    `Script version:  ${ctx.scriptVersion}`,
    `Firebot version: ${ctx.firebotVersion ?? "unknown"}`,
    `Platform:        ${process.platform} ${process.arch}`,
    `Node:            ${process.versions?.node ?? "unknown"}`,
    "",
    "Configuration:",
    `  Spotify client id:     ${presence(params?.spotifyClientId)}`,
    `  Spotify client secret: ${presence(params?.spotifyClientSecret)}`,
    `  Country of Play:       ${country ? country : "(unset)"}`,
    `  Global blocklist:      ${parseBlockList(params?.spotifyBlockList).length} entries`,
    "",
    `Records: ${entries.length}`,
    "----------------------------",
  ];
}

/** The header plus every retained record — the text the copy button copies. */
export function snapshot(ctx: SnapshotContext): string {
  const lines = header(ctx);
  if (entries.length === 0) {
    lines.push("No records were captured this session.");
  } else {
    for (const entry of entries) {
      lines.push(`${entry.at} [${entry.level}] ${entry.text}`);
    }
  }
  return lines.join("\n");
}
