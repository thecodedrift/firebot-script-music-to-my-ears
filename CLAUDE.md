# firebot-music-to-my-ears

A custom script for [Firebot](https://github.com/crowbartools/Firebot), the open-source Twitch
streaming bot. This script adds music-related functionality (now-playing, song requests, etc.).

## Architecture & conventions

**Read [.conventions/architecture.md](.conventions/architecture.md) before writing or changing
code.** It defines the project structure, the Firebot script/module API, the registration
patterns, the music/OAuth/polling patterns, and the build tooling — all derived from the official
Firebot tooling and representative OSS scripts.

Non-negotiable constraints (full detail in the architecture doc):

- Build produces a **single self-contained CommonJS `.js` file**; Firebot loads exactly one file.
- The script object is the **default export** of `src/main.ts`
  (`libraryTarget: "commonjs2"`, `libraryExport: "default"`).
- Terser must **not mangle** `run` / `getScriptManifest` / `getDefaultParameters`.
- **Namespace all registered IDs** as `music-to-my-ears:<name>`.
- Everything registered in `run()` must be **torn down in `stop()`**.
- Use `runRequest.modules.logger` for logging, never `console`.

## Git commits

- **ALWAYS** run `git commit` with the `-S` flag to ensure commits are GPG-signed. If signing
  fails (e.g. gpg can't open `/dev/tty` to prompt for the passphrase), ask the user to run
  `echo "test" | gpg --sign > /dev/null` to load their GPG signing key, then retry the commit.

## Releases & versioning

Versioning and releases are **fully automated** by the Release GitHub Action
(`.github/workflows/release.yml`, using `changesets/action`). The flow is:

1. Land your change **with a changeset** (`.changeset/*.md`) and push to `main`.
2. The action opens/updates a **"Version Packages" PR** that bumps the version and
   writes `CHANGELOG.md`.
3. **Merging that PR** runs `pnpm release` — it builds the bundle, tags `v<version>`,
   and creates the GitHub Release with the built `.js` attached.

**Never run `pnpm changeset version` (or `changeset:version` / `npx changeset
version`) yourself.** That command consumes the changeset and hand-produces the
version bump the bot is supposed to make, short-circuiting the Version PR. Your job
ends at *committing the changeset and pushing* — the automation does the rest. (This
is also enforced by a `deny` rule in `.claude/settings.json`.)

## OpenSpec

This project uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for spec-driven development.

Always run it through the package script so the pinned local version is used:

```
pnpm openspec <command>
```

Examples: `pnpm openspec init`, `pnpm openspec list`, `pnpm openspec validate`.

Do not call a globally-installed `openspec` directly — use `pnpm openspec` so everyone runs the same version (`@fission-ai/openspec`, pinned in devDependencies).
