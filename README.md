<div align="center">

# Switcher

**One click between Claude Code accounts.**<br>
See every account's session and weekly usage, and keep a 5-hour window running on all of them.

[![Latest release](https://img.shields.io/github/v/release/Harshul1484/switcher?style=flat-square&color=cc785c&labelColor=181715&label=release)](https://github.com/Harshul1484/switcher/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/Harshul1484/switcher/release.yml?style=flat-square&labelColor=181715&label=build)](https://github.com/Harshul1484/switcher/actions/workflows/release.yml)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-cc785c?style=flat-square&labelColor=181715)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-cc785c?style=flat-square&labelColor=181715)](LICENSE)

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/switcher-dark.png">
  <img alt="Switcher with three accounts, each showing current-session and weekly usage" src="docs/screenshots/switcher-light.png" width="880">
</picture>

<br><br>

### Download

[![Windows](https://img.shields.io/badge/Windows-.exe-cc785c?style=for-the-badge&labelColor=181715&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEgMWgxMC41djEwLjVIMXpNMTIuNSAxSDIzdjEwLjVIMTIuNXpNMSAxMi41aDEwLjVWMjNIMXpNMTIuNSAxMi41SDIzVjIzSDEyLjV6Ii8%2BPC9zdmc%2B)](https://github.com/Harshul1484/switcher/releases/latest/download/Switcher-Setup.exe)
[![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon-cc785c?style=for-the-badge&labelColor=181715&logo=apple&logoColor=white)](https://github.com/Harshul1484/switcher/releases/latest/download/Switcher-arm64.dmg)
[![macOS Intel](https://img.shields.io/badge/macOS-Intel-cc785c?style=for-the-badge&labelColor=181715&logo=apple&logoColor=white)](https://github.com/Harshul1484/switcher/releases/latest/download/Switcher-x64.dmg)

[![Ubuntu, Debian, Kali](https://img.shields.io/badge/Ubuntu%20%C2%B7%20Debian%20%C2%B7%20Kali-.deb-cc785c?style=for-the-badge&labelColor=181715&logo=debian&logoColor=white)](https://github.com/Harshul1484/switcher/releases/latest/download/switcher_amd64.deb)
[![Arch](https://img.shields.io/badge/Arch-.pacman-cc785c?style=for-the-badge&labelColor=181715&logo=archlinux&logoColor=white)](https://github.com/Harshul1484/switcher/releases/latest/download/switcher.pacman)
[![Fedora](https://img.shields.io/badge/Fedora-.rpm-cc785c?style=for-the-badge&labelColor=181715&logo=fedora&logoColor=white)](https://github.com/Harshul1484/switcher/releases/latest/download/switcher.x86_64.rpm)
[![AppImage](https://img.shields.io/badge/Any%20Linux-AppImage-cc785c?style=for-the-badge&labelColor=181715&logo=linux&logoColor=white)](https://github.com/Harshul1484/switcher/releases/latest/download/Switcher-x86_64.AppImage)

<sub>Unofficial. Not affiliated with or endorsed by Anthropic. Requires the <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a> CLI.</sub>

</div>

<br>

## Features

- **One-click switching.** Save each account once; **Use** makes it the one Claude Code runs as. Only the login changes; your settings, MCP servers and project history stay put.
- **Usage at a glance.** Every account shows its current-session and weekly usage, with live reset countdowns.
- **Session manager.** Optionally keeps a 5-hour session window running on every account that still has weekly limit left, so the clock is already ticking when you need it.
- **Safe by design.** Credentials are backed up before every switch, never leave your machine except to Anthropic, and are never logged.
- **Updates itself.** New versions download in the background; one click installs them.

## Install

<details>
<summary><b>Windows</b></summary>

Run `Switcher-Setup.exe`. It installs for your user only, no admin rights needed. The installer isn't code-signed, so SmartScreen may warn: choose **More info → Run anyway**.
</details>

<details>
<summary><b>macOS</b></summary>

Open the `.dmg` for your Mac (**Apple Silicon** for M-series chips, **Intel** otherwise) and drag Switcher to Applications. The app isn't notarized by Apple, so the first launch needs one approval: **System Settings → Privacy & Security → Open Anyway**, or run

```sh
xattr -dr com.apple.quarantine /Applications/Switcher.app
```

On macOS, the **Update** button opens the download page, because macOS only lets apps signed with an Apple Developer ID update themselves.
</details>

<details>
<summary><b>Linux</b></summary>

| Distribution | Install |
|---|---|
| Ubuntu, Debian, Kali, Mint, Pop!_OS | `sudo apt install ./switcher_amd64.deb` |
| Arch, Manjaro, EndeavourOS | `sudo pacman -U switcher.pacman` |
| Fedora, RHEL, openSUSE | `sudo dnf install ./switcher.x86_64.rpm` |
| Anything else | `chmod +x Switcher-x86_64.AppImage && ./Switcher-x86_64.AppImage` |

On Ubuntu 24.04 and later, prefer the `.deb`: AppArmor can stop AppImages from starting. If your terminal app isn't one Switcher knows, **Add Account** shows the sign-in command to run yourself.
</details>

You also need the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI: `claude` should work in a terminal.

## Using it

1. **Add Account**: type a name (an email works). A terminal opens running `claude auth login` in an isolated profile; sign in there.
2. **Use**: makes that account the one Claude Code runs as. In VS Code, run **Developer: Reload Window** so the extension picks it up.
3. **Session manager**: tick *Keep a 5-hour session running*, and choose the starting message it sends (with Haiku, no tools) to accounts that have no window running.

If a card can't load usage, **Reconnect** retries, or reopens sign-in when the login has expired.

## How it works

- Each account lives in `~/.claude-profiles/<name>/`, with its own `.credentials.json` and `.claude.json`.
- Switching replaces only the login (`claudeAiOauth` in `~/.claude/.credentials.json`, or the `Claude Code-credentials` Keychain item on macOS) and the account info (`oauthAccount` in `~/.claude.json`).
- Credentials are backed up to `~/.claude-profiles/.backups/` before every switch.
- Usage comes from Anthropic, using each account's own token, at most every 10 minutes per account. Switcher remembers the last answer, and backs off when Anthropic asks it to.

## Privacy

Switcher talks only to Anthropic (`api.anthropic.com` for usage, `platform.claude.com` to refresh an inactive account's login) and to GitHub for updates. No telemetry, no analytics, no third parties. It never refreshes the login Claude Code is currently using.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: every pull request is reviewed by the maintainer before it's merged, and merging into `main` ships a release. Please also follow the [Code of Conduct](CODE_OF_CONDUCT.md).

| | |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute, and the rules for pull requests |
| [DESIGN.md](DESIGN.md) | The design system: colours, type, components |
| [AGENTS.md](AGENTS.md) | Guide for AI coding agents working on this repo |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability privately |

## Development

```sh
npm install
npm start      # run the app
npm test       # core tests (fake home dir, fake network)
npm run dist   # build installers for your system into dist/
```

Pushes to any branch build and test on Windows, macOS and Linux ([ci.yml](.github/workflows/ci.yml)). Every push to `main` is tested, tagged with the next version, and released for all three systems once every build succeeds ([release.yml](.github/workflows/release.yml)).

## Caveats

- Built against Claude Code 2.1.332. It relies on Claude Code's file formats and undocumented endpoints, which can change.
- Used day to day on Windows. Linux passes the full test suite in CI; the macOS Keychain switching isn't covered by automated tests yet.
- Use it with your own accounts and within Anthropic's terms.

## License

[MIT](LICENSE)
