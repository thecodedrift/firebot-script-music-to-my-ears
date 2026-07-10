import { ErrorReason } from "../shared/types";

/**
 * Values a message may interpolate. All optional: a template only names what its
 * own reason can supply.
 */
export interface ErrorTextContext {
  trackName?: string;
  artistName?: string;
  /** Remaining cooldown, already rounded up to whole seconds. */
  cooldown?: number;
}

/**
 * Templates use `{brace}` placeholders, never `$name`.
 *
 * Artist names legitimately contain `$` — A$AP Rocky, Ke$ha — and `$` is
 * Firebot's replacement-variable sigil. A `$`-based template would collide with
 * ordinary catalog data, no adversary required. Braces sidestep the question of
 * whether Firebot expands variables inside substituted output values.
 */
const TEMPLATES: Record<ErrorReason, string> = {
  "not-found": "I couldn't find that song on Spotify.",
  "not-playable": "{trackName} isn't playable on this account.",
  "blocked-term": "{trackName} is on the blocked list.",
  explicit: "{trackName} is marked explicit, and explicit tracks are off.",
  "too-long": "{trackName} is too long to add to the queue.",
  "recently-played": "{trackName} was played recently. Try again in {cooldown}.",
  // Never blames the requester: this cooldown is global, so the person reading
  // this message may have requested nothing at all. It protects playlist
  // diversity, it does not police anyone.
  "artist-recently-played": "{artistName} was played recently. Try again in {cooldown}.",
  "user-artist-recently-played":
    "You've already requested {artistName} recently. Try again in {cooldown}.",
  "no-active-device": "Spotify isn't playing on any device right now.",
  "not-premium": "This needs a Spotify Premium account.",
  "not-linked": "Spotify isn't linked yet.",
  unknown: "Something went wrong talking to Spotify.",
};

/**
 * Renders `{name}` placeholders. A placeholder with no matching value is left in
 * the output verbatim, rather than blanked: `errorTextFor` supplies every
 * placeholder the templates use, so an unsubstituted `{foo}` reaching a viewer
 * means a template named something nobody passes. Better that it be visible.
 */
function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** Formats a whole-second cooldown as a human phrase, e.g. "2 minutes", "45 seconds". */
export function formatCooldown(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * The friendly form of an `errorReason`, ready to send to chat unmodified.
 * Returns "" for success, mirroring `errorReason`.
 *
 * Exhaustive over `ErrorReason` by construction: `TEMPLATES` is a total Record,
 * so adding a reason without a message is a type error.
 */
export function errorTextFor(reason: ErrorReason | "", context: ErrorTextContext = {}): string {
  if (!reason) {
    return "";
  }
  return interpolate(TEMPLATES[reason], {
    trackName: context.trackName || "That track",
    artistName: context.artistName || "That artist",
    cooldown: context.cooldown === undefined ? "a moment" : formatCooldown(context.cooldown),
  });
}
