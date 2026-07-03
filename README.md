# FWW Ops — Desktop

A thin Electron desktop shell around **https://ops.fuzzyreporting.com/** — the
unified Fuzzywumpets order-management + employee-comms app. Built to mirror
`fww-b2b-admin-desktop` / `fww-shipping-desktop`.

## What it does

- Opens FWW Ops in its own window with a green **Ops** app icon (desktop +
  Start-menu shortcut, system-tray icon).
- **Authentication:** the window uses a persistent session partition
  (`persist:fwwops`), so the Cloudflare Access / **Sign in with Google** flow runs
  once and the session survives restarts. OAuth popups open in-app; all other
  links open in your default browser. Auth-gated PDFs (labels / packing slips)
  open in their own in-app window (they share the session).
- **Auto-update on open:** on every launch it checks GitHub Releases, downloads
  any new version in the background, and offers to restart (and installs on quit
  regardless). Powered by `electron-updater`.

## Develop

```bash
npm install
npm start          # runs the app pointed at the live ops app (dev: no auto-update)
```

## Icons

The icon is generated, not hand-drawn:

```bash
npm run icons      # regenerates assets/icon*.png + assets/icon.ico (green "Ops" square)
```

## Release (triggers auto-update for everyone)

CI builds the Windows NSIS installer and publishes a GitHub Release whenever a
`v*` tag is pushed — **build via CI, not locally** (electron-builder's winCodeSign
extraction needs symlink-create privilege that this Windows box lacks):

```bash
# bump "version" in package.json first, then:
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions (`.github/workflows/build.yml`) builds on `windows-latest` and
attaches `*.exe` + `latest.yml` to the release. Installed apps pick the update up
on their next launch.

## Install

**Recommended — one line, zero friction.** Open PowerShell (no admin needed) and run:

```powershell
irm https://raw.githubusercontent.com/fuzzyalex84/fww-ops-desktop/master/install.ps1 | iex
```

This downloads the latest release and installs it silently, per-user. It skips ALL
the double-click friction — no browser Captcha, no SmartScreen "unknown publisher",
no "mark as safe" — because a programmatic download isn't tagged with Mark-of-the-Web
and a silent install never shows the SmartScreen dialog. Run it once per PC; the app
auto-updates from then on. Then sign in with your `@fuzzywumpets.com` Google account.

**Manual (has the SmartScreen prompt).** Download `FWW-Ops-Setup-x.y.z.exe` from the
[Releases page](https://github.com/fuzzyalex84/fww-ops-desktop/releases) and run it.
Because it's unsigned, Windows SmartScreen shows an "unknown publisher" warning —
click **More info → Run anyway**. (The one-liner above avoids this entirely; the only
way to remove it for browser downloads is code-signing the installer.)
