# Switcher

Keep several Claude Code accounts on one machine and switch between them with one click. Each account shows its session and weekly usage with reset times, and an optional session manager keeps a 5-hour session window running on every account.

Unofficial. Not affiliated with or endorsed by Anthropic.

## Install (Windows)

1. Download `Switcher-Setup-<version>.exe` from [Releases](../../releases).
2. Run it. The installer is unsigned, so Windows SmartScreen may warn: choose **More info → Run anyway**. It installs for your user only; no admin rights needed.
3. You need the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed, with `claude` on your PATH.

## Use

- **Add Account**: type a name. A terminal opens running `claude auth login` in an isolated profile; sign in there and the account appears in the list.
- **Use**: makes that account the one Claude Code uses. Then reload VS Code (`Ctrl/Cmd+Shift+P` → **Developer: Reload Window**) so the extension picks it up.
- **Usage**: each account shows *Current session* and *This week* usage and when each resets.
- **Session manager**: when switched on, any account with no running session window gets your starting message through `claude -p` (Haiku, no tools, plugins or MCP servers), which starts its 5-hour window. It checks every 5 minutes while Switcher is open.

## How it works

- Each account lives in `~/.claude-profiles/<name>/` (its own `.credentials.json` and `.claude.json`).
- Switching replaces only the login (`claudeAiOauth` in `~/.claude/.credentials.json`) and account info (`oauthAccount` in `~/.claude.json`). MCP logins, settings and project history stay as they are.
- The current credentials are backed up to `~/.claude-profiles/.backups/` before every switch.
- Network access goes only to Anthropic, using each account's own token: `api.anthropic.com` for usage and `platform.claude.com` to refresh an inactive account's expired login. The active account's login is never refreshed by Switcher; Claude Code handles it. No telemetry.

## Caveats

- Built against Claude Code 2.1.332. It relies on Claude Code's file formats and undocumented endpoints, which can change.
- Tested on Windows. The macOS (Keychain) and Linux code paths are untested, and only a Windows installer is published.
- Use it with your own accounts and within Anthropic's terms.

## Develop

```sh
npm install
npm start      # run the app
npm test       # core tests (fake home dir, fake network)
npm run dist   # build the Windows installer into dist/
```
