# Contributing to Switcher

Thanks for helping. Switcher handles people's Claude Code logins, so contributions are welcome but reviewed carefully. Please read this page before opening a pull request.

## How it works

1. **Talk first for anything non-trivial.** Open an issue describing the problem or idea before writing code for a new feature, a behaviour change or anything touching credentials. Small fixes (typos, obvious bugs) can go straight to a pull request.
2. **Fork and branch.** Fork the repo and create a branch from `main` (for example `fix/usage-countdown`).
3. **Make the change.** See [Development](#development) and the [rules](#rules) below.
4. **Open a pull request into `main`.** Fill in the template, including how you tested it and on which systems.
5. **Review.** Every pull request is reviewed by the maintainer, [Harshul1484](https://github.com/Harshul1484), who is requested automatically. Expect questions or change requests; please answer them in the pull request.
6. **Merge.** Only the maintainer merges, and only after approving the review and after CI has passed on Windows, macOS and Linux. Pull requests that don't get approval are closed with an explanation.

> Merging into `main` publishes a release automatically: the version is bumped, installers are built for all three systems, and every installed copy updates itself. That's why nothing is merged without review.

## Development

```sh
npm install
npm start      # run the app
npm test       # core tests: fake home directory and fake network, never your real logins
npm run dist   # build installers for your system into dist/
```

Every push to your branch runs the tests and builds the installers on Windows, macOS and Linux in GitHub Actions. You can download those builds from the run page to try them.

Read [AGENTS.md](AGENTS.md) for a map of the code and the invariants it must keep, and [DESIGN.md](DESIGN.md) before touching the UI.

## Rules

**Credentials and privacy (non-negotiable)**

- Never log, print, display, store elsewhere or commit tokens or credential files. Not in code, tests, screenshots, issues or pull request descriptions.
- Switcher talks only to Anthropic (`api.anthropic.com`, `platform.claude.com`) and to GitHub for updates. No telemetry, analytics or new endpoints.
- Never refresh the login Claude Code is currently using; only Claude Code may do that.
- Back up before modifying credentials, and write credential files atomically (`writeAtomic`).

**Code**

- One change per pull request, small and focused. Unrelated clean-ups go in their own pull request.
- Logic changes in `core.js` come with a test in `core.test.js`, and `npm test` passes.
- No new dependencies without agreeing on it in an issue first.
- Keep it working on Windows, macOS and Linux. Platform-specific code needs a path for each system.
- Don't change `version` in `package.json`; release versions come from tags set by the release workflow.
- Write clear commit messages that say what changed and why.

**UI**

- Use the tokens and components in [DESIGN.md](DESIGN.md). No hard-coded colours, fonts or spacing.
- Check light and dark mode, and include before/after screenshots for visible changes, using example accounts only.

**Conduct**

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report security problems privately as described in [SECURITY.md](SECURITY.md), never in a public issue.

## License

Switcher is [MIT licensed](LICENSE). By contributing, you agree that your contribution is licensed under the same terms.

## Reporting bugs and ideas

Use the issue templates. For bugs, include your Switcher version (bottom of the sidebar), your operating system and the steps to reproduce. Never paste credentials, tokens or the contents of `.credentials.json`.
