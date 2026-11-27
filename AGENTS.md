# AGENTS.md

Guide for AI coding agents (and humans) working on Switcher. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the process and [DESIGN.md](DESIGN.md) before touching the UI.

## What this is

An Electron desktop app (Windows, macOS, Linux) that stores several Claude Code logins and switches between them, shows each account's usage, and can keep a 5-hour session window running on every account. Plain JavaScript (CommonJS), no framework, no bundler, no TypeScript.

## Map

| File | Role |
|---|---|
| `core.js` | All credential, usage and session logic. Pure Node, no Electron imports; this is what the tests cover. |
| `main.js` | Electron main process: login-shell `PATH` fix (macOS/Linux), window, tray, global shortcut, notifications, start at login, the IPC allowlist (`api`), the session-manager and usage-watch timers, auto-update. |
| `preload.js` | Exposes `window.call(fn, arg)` over IPC, and `window.onEvent` for the `changed` and `quick-open` events. |
| `renderer.js` | The UI: renders accounts, polls usage and session status, card menu (rename, pin, colour, reorder), settings. |
| `quick.html`, `quick.js` | The quick switcher window opened by the global shortcut. |
| `tray.html`, `tray.js` | The tray popup (Windows, macOS): each account's session ring and weekly bar; click to switch. Linux keeps a native menu (AppIndicator trays don't report clicks), with usage in its labels. |
| `assets/` | Shipped with the app: tray icons (`trayTemplate*.png` is the macOS menu-bar template image), `icon.png` (Linux window and notification icon), `logo.svg` (sidebar header). |
| `build/` | Installer and app icons: `icon.icns` (macOS), `icon.ico` (Windows), `icons/` (Linux). Not shipped inside the app. |
| `docs/logo/` | Logo masters; see DESIGN.md → Logo. |
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
- **Config** lives in `~/.claude-profiles/.switcher.json`: session manager (`autoStart`, `message`), `settings` (`startAtLogin`, `notify`, `shortcut`, `trayHintShown`), `accounts` (per-name `label`, `color`, `pinned`) and `order`. Labels are display only; the folder name stays the account's identity.
- **Folder accounts** (`projects` in the config: folder → account): VS Code's `claudeCode.claudeProcessWrapper` points at our launcher, which sets `CLAUDE_CONFIG_DIR` to the account's profile for the folder Claude starts in (the deepest match wins; `configDirFor`). On macOS/Linux the launcher is `~/.claude-profiles/claude-launcher.sh`, rewritten by `refreshFolders`; on Windows it's Switcher.exe itself (the branch at the top of `main.js`), since VS Code can't start a script there. `refreshFolders` also links the user's own `~/.claude` setup (the `SHARED` list) into bound profiles; never add account or organisation files to that list.
- **Tray and shortcut**: closing the window hides it to the tray; **Quit** is in the tray menu. The shortcut (an Electron accelerator, empty = off) opens the quick switcher. A single-instance lock brings the window back when the app is launched again.
- **Notifications** (`watchUsage`, every 5 minutes): `usageAlerts` compares the last two usage readings and fires only when a threshold is crossed. `bestAccount` picks the account with the most left (lower of session and weekly headroom).
- **Errors** are typed by name (`Offline`, `Expired`, `Limited`); the name survives IPC and the UI shows **Reconnect** for them.
- **Updates**: electron-updater against GitHub Releases, like other desktop apps: checked at start and every hour, downloaded in the background, then "Restart to update" (also installs on quit). Settings → General shows the version and a Check for updates button. macOS builds aren't Developer-ID signed, so there the button opens the release page.

## Invariants (never break these)

1. **Tokens never leave the machine** except to `api.anthropic.com` and `platform.claude.com`. No logging, printing, telemetry or new endpoints.
2. **Never refresh the active login or a folder account's login.** Only Claude Code may refresh a login it's using; doing it here rotates the refresh token and logs Claude Code out. For the same reason a folder account can never be made the active login, and the active account can't get a folder.
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
- Don't edit `version` in `package.json` or push version commits: release versions come from the `v*` tags, and `release.yml` stamps the version into each build.

## Releasing

Merge to `main` (it's protected: pull requests need the maintainer's approval and green CI). The release workflow tests on all three systems, takes the newest `v*` tag and bumps the patch version, pushes only that new tag (never a commit, so `main` stays protected), builds every installer with that version into a draft, and publishes it only if all builds succeed. For a minor or major bump use **Actions → Release → Run workflow**. Pushes that only change docs (`*.md`, `docs/`, `LICENSE`) don't release.
