# Switcher

Keep several Claude Code accounts on one machine and switch between them with one click. Each account shows its session and weekly usage with reset times, and an optional session manager keeps a 5-hour session window running on every account.

Unofficial. Not affiliated with or endorsed by Anthropic.

## Install

You need the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed (`claude` works in a terminal). Download from [Releases](../../releases):

| System | File | Notes |
|---|---|---|
| **Windows** | `Switcher-Setup-<version>.exe` | Unsigned, so SmartScreen may warn: **More info → Run anyway**. Installs for your user only. |
| **macOS** (Apple Silicon / Intel) | `Switcher-<version>-arm64.dmg` / `Switcher-<version>-x64.dmg` | Not notarized by Apple. After dragging it to Applications, if macOS says it can't be opened: **System Settings → Privacy & Security → Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/Switcher.app`. |
| **Ubuntu, Debian, Kali, Mint, Pop!_OS** | `switcher_<version>_amd64.deb` | `sudo apt install ./switcher_<version>_amd64.deb` |
| **Arch, Manjaro, EndeavourOS** | `switcher-<version>.pacman` | `sudo pacman -U switcher-<version>.pacman` |
| **Fedora, RHEL, openSUSE** | `switcher-<version>.x86_64.rpm` | `sudo dnf install ./switcher-<version>.x86_64.rpm` |
| **Any Linux** | `Switcher-<version>-x86_64.AppImage` | `chmod +x` it and run. On Ubuntu 24.04+, prefer the `.deb` (AppArmor can stop AppImages from starting). |

Switcher updates itself: it checks GitHub Releases at launch and every 4 hours, downloads new versions in the background, and shows an **Update &lt;version&gt;** button (or installs on the next quit). On macOS the button opens the download page instead, because macOS only lets apps signed with an Apple Developer ID update themselves. Version 1.0.0 has no updater, so install a newer version once by hand.

## Use

- **Add Account**: type a name. A terminal opens running `claude auth login` in an isolated profile; sign in there and the account appears in the list. (Linux: if your terminal app isn't one Switcher knows, it shows the command to run yourself.)
- **Use**: makes that account the one Claude Code uses. Then reload VS Code (`Ctrl/Cmd+Shift+P` → **Developer: Reload Window**) so the extension picks it up.
- **Usage**: each account shows *Current session* and *This week* usage and when each resets.
- **Session manager**: when switched on, any account with no running session window gets your starting message through `claude -p` (Haiku, no tools, plugins or MCP servers), which starts its 5-hour window. It checks every 5 minutes while Switcher is open.

## How it works

- Each account lives in `~/.claude-profiles/<name>/` (its own `.credentials.json` and `.claude.json`).
- Switching replaces only the login (`claudeAiOauth` in `~/.claude/.credentials.json`, or on macOS the `Claude Code-credentials` Keychain item) and account info (`oauthAccount` in `~/.claude.json`). MCP logins, settings and project history stay as they are.
- The current credentials are backed up to `~/.claude-profiles/.backups/` before every switch.
- Network access goes only to Anthropic, using each account's own token: `api.anthropic.com` for usage and `platform.claude.com` to refresh an inactive account's expired login. The active account's login is never refreshed by Switcher; Claude Code handles it. No telemetry.

## Caveats

- Built against Claude Code 2.1.332. It relies on Claude Code's file formats and undocumented endpoints, which can change.
- Used day to day on Windows. The macOS (Keychain) and Linux paths are built and tested in CI, but haven't been used day to day.
- Use it with your own accounts and within Anthropic's terms.

## Develop

```sh
npm install
npm start      # run the app
npm test       # core tests (fake home dir, fake network)
npm run dist   # build installers for the system you're on into dist/
```

GitHub Actions does the rest:

- **Branches and pull requests** ([ci.yml](.github/workflows/ci.yml)): tests and builds the installers on Windows, macOS and Linux; download them from the run page (kept 7 days).
- **Releases** ([release.yml](.github/workflows/release.yml)): every push to `main` (except changes to `.md` files only) is tested on all three systems, gets its version bumped (patch: 1.2.3 → 1.2.4) and committed back to `main`, and builds into a release that's published once all three platforms succeed. If anything fails, nothing is published. For a minor or major bump, use **Actions → Release → Run workflow**. Installed copies pick up a new release within 4 hours, or at their next launch.
