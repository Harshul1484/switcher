# AGENTS.md

Guide for AI coding agents (and humans) working on Switcher. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the process and [DESIGN.md](DESIGN.md) before touching the UI.

## What this is

An Electron desktop app (Windows, macOS, Linux) that stores several Claude Code logins and switches between them, shows each account's usage, and can keep a 5-hour session window running on every account. Plain JavaScript (CommonJS), no framework, no bundler, no TypeScript.

## Map

| File | Role |
|---|---|
| `core.js` | All credential, usage and session logic. Pure Node, no Electron imports; this is what the tests cover. |
| `main.js` | Electron main process: login-shell `PATH` fix (macOS/Linux), window, the IPC allowlist (`api`), the session-manager timer, auto-update. |
| `preload.js` | Exposes one function, `window.call(fn, arg)`, over IPC. |
| `renderer.js` | The UI: renders accounts, polls usage and session status, handles buttons. |
| `index.html`, `styles.css` | Markup and the design tokens and components (see DESIGN.md). |
| `core.test.js` | `node:test` suite with a fake home directory, fake `fetch` and fake `child_process.spawn`. |
| `.github/workflows/ci.yml` | Branches and pull requests: test and package on all three systems. |
| `.github/workflows/release.yml` | Pushes to `main`: test, bump the version, build, publish. |

## Commands

```sh
npm install
npm start      # run the app
npm test       # node --test; must pass before any commit
npm run dist   # installers for the current OS into dist/
```

## How it works

- **Profiles**: `~/.claude-profiles/<name>/` is a `CLAUDE_CONFIG_DIR` holding that account's `.credentials.json` and `.claude.json`. Adding an account runs `claude auth login` with that directory.
- **Active login**: `~/.claude/.credentials.json` (`claudeAiOauth`) and `~/.claude.json` (`oauthAccount`). On macOS the credentials are the Keychain item `Claude Code-credentials` (account `claude-code-user`, falling back to `$USER`). A profile's own Keychain item is `Claude Code-credentials-<first 8 hex of sha256(dir)>`.
- **Switching** (`use`): back up, save the outgoing account's rotated tokens to its profile, then replace only `claudeAiOauth` and `oauthAccount`, keeping every other key (MCP logins, settings, projects).
- **Usage** (`usage`): `GET api.anthropic.com/api/oauth/usage`, at most every 10 minutes per account. Answers are cached in `~/.claude-profiles/.usage-cache.json` (numbers only); after a 429 it waits for `Retry-After`. The active account reuses Claude Code's own `cachedUsageUtilization` when fresh.
- **Session manager** (`keepSessions`): every 5 minutes, accounts with no running window and weekly limit left get the starting message via `claude -p --model haiku --tools ""`. The active account runs from the default location; others from their profile directory.
- **Errors** are typed by name (`Offline`, `Expired`, `Limited`); the name survives IPC and the UI shows **Reconnect** for them.
- **Updates**: electron-updater against GitHub Releases. macOS builds aren't Developer-ID signed, so there the button opens the release page.

## Invariants (never break these)

1. **Tokens never leave the machine** except to `api.anthropic.com` and `platform.claude.com`. No logging, printing, telemetry or new endpoints.
2. **Never refresh the active login.** Only Claude Code may refresh the login it's using; doing it here rotates the refresh token and logs Claude Code out.
3. **Back up before changing credentials**, and write credential files with `writeAtomic` (temporary file, then rename).
4. **Swap only `claudeAiOauth` and `oauthAccount`.** Every other key in those files belongs to Claude Code.
5. **Token-touching operations go through `serial()`**, so a refresh never races a switch.
6. **Refuse unknown formats.** If credentials aren't plain JSON (for example a macOS Keychain format Switcher doesn't know), throw and change nothing.
7. **Profile names are folder names**: validated by `checkName` (no separators, no leading or trailing dot, no Windows reserved names).
8. **IPC is an allowlist**: renderer calls only reach functions listed in `api` in `main.js`.

## Conventions

- Smallest change that solves the problem; no new dependencies without discussion.
- New logic in `core.js` gets a test in `core.test.js`. Tests never touch the real home directory or network: set `HOME`/`USERPROFILE` to a temp dir and replace `global.fetch` / `require('child_process').spawn`.
- Platform code branches on `process.platform` and must handle `win32`, `darwin` and `linux`.
- UI uses the tokens in `styles.css`; check light and dark mode.
- Comments explain *why*, in one line.
- Don't edit `version` in `package.json`; `release.yml` bumps it on every push to `main`.

## Releasing

Push or merge to `main`. The release workflow tests on all three systems, bumps the patch version (commit `vX.Y.Z [skip ci]` plus a tag), builds every installer into a draft, and publishes it only if all builds succeed. For a minor or major bump use **Actions → Release → Run workflow**. Pushes that only change docs (`*.md`, `docs/`) don't release.
