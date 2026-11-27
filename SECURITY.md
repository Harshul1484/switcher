# Security

Switcher reads and writes Claude Code login credentials, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub: on the repository page, go to **Security → Report a vulnerability**. Include what's affected, how to reproduce it, and the version and operating system you saw it on. Never include real tokens or credential files; use made-up values.

You'll get an answer as soon as possible, and credit in the release notes if you'd like it.

## What's in scope

- Credentials leaving the machine, other than to Anthropic as described in the README
- Credentials being exposed to other users or processes on the same machine
- Lost or corrupted logins when switching, refreshing or removing accounts
- The update mechanism installing something that isn't an official release

## Supported versions

Only the latest release gets fixes. Switcher updates itself, so most users are on it within a few hours of a release.
