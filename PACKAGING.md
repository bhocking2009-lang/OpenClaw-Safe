# OpenClaw-Safe — Packaging Guide

## Overview

OpenClaw-Safe is distributed for Windows as a self-contained installer
(`OpenClaw-Safe-Setup.exe`) built with NSIS. The installer bundles:

- The compiled TypeScript application (`dist/`)
- Production `node_modules/`
- A portable Node.js 20 LTS runtime (`node/`)
- A Windows batch launcher (`launcher.bat`)

End users do **not** need Node.js installed.

## Why this approach

`better-sqlite3` is a native Node.js addon (`.node` binary). It must be
compiled for the exact Node.js version and platform used at runtime. Bundling
the portable Node.js binary that matches the `better-sqlite3` build ensures
the native module loads correctly on any Windows 10/11 machine, without
requiring Visual C++ redistributables or a Node.js system install.

Electron was explicitly ruled out to keep the package footprint small and the
existing test/build pipeline unchanged.

## User data location

Runtime data is **never** written inside `Program Files`. It lives in the
user's roaming profile:

```
%APPDATA%\OpenClaw-Safe\
  data\         — SQLite database (gateway.db)
  logs\         — startup.log and other log files
  artifacts\    — content-addressed artifact blobs
  replay\       — exported replay packs
  plugins\      — installed plugin packages
```

This is managed by `src/core/paths.ts` (`getAppPaths()` / `ensureAppPaths()`).
On Unix/macOS (developer mode) the base directory is `~/.openclaw/`.

## Building the installer

### Requirements

| Tool | Notes |
|------|-------|
| Windows 10 / 11 | Build must run on Windows for NSIS |
| Node.js 20 LTS | `node` and `npm` in PATH |
| NSIS 3.x | [nsis.sourceforge.io](https://nsis.sourceforge.io/) — `makensis` in PATH |
| 7-Zip (optional) | Fallback to PowerShell `Compress-Archive` if absent |

### Steps

```powershell
# From the repository root:
pwsh packaging\windows\build.ps1
```

The script:
1. `npm run build` — compiles TypeScript to `dist/`
2. `npm ci --omit=dev` — installs production-only dependencies
3. Assembles `dist-pkg/` with `dist/`, `node_modules/`, `launcher.bat`
4. Creates `OpenClaw-Safe-win32.zip` (full zip of `dist-pkg/`)
5. If `makensis` is available, builds `OpenClaw-Safe-Setup.exe`

> **Note:** The portable Node.js runtime (`dist-pkg\node\`) is not downloaded
> by `build.ps1`. Download a portable Node 20 LTS win-x64 zip from
> [nodejs.org](https://nodejs.org/dist/) and extract it to `dist-pkg\node\`
> before running `makensis`. In the GitHub Actions workflow this is done
> automatically.

## GitHub Actions release

The workflow `.github/workflows/release-windows.yml` triggers automatically on:
- A tag push matching `v*` (e.g. `v1.0.1`)
- Manual `workflow_dispatch`

It downloads a portable Node 20.11.1 win-x64 runtime, assembles the bundle,
installs NSIS via Chocolatey, builds `OpenClaw-Safe-Setup.exe`, and:
- Uploads the installer as a workflow artifact (30-day retention).
- Attaches it to the GitHub Release when triggered by a version tag.

## Versioning

The installer version is currently hardcoded in `packaging/windows/installer.nsi`
as `PRODUCT_VERSION "1.0.0"`. When cutting a release:

1. Update `"version"` in `package.json`.
2. Update `!define PRODUCT_VERSION` in `installer.nsi`.
3. Commit, then push a tag: `git tag v1.x.x && git push origin v1.x.x`.

The GitHub Actions workflow picks up the tag and publishes a release
automatically.

## Limitations / known issues

- **Windows-only installer** — Linux and macOS users should use developer
  mode (`npx openclaw start`). Native Linux/macOS packaging (.deb, .pkg, .AppImage)
  is not implemented yet.
- **No auto-updater** — users must download and run a new installer to update.
- **`better-sqlite3` must be built for the bundled Node version** — the
  GitHub Actions workflow uses `npm ci` on the same Node version that is
  bundled, so the pre-built binary matches. If you change the bundled Node
  version, update both the `setup-node` step and the `$nodeVersion` variable
  in `release-windows.yml`.
- **Requires admin for install** — NSIS installs to `Program Files (x86)\`,
  which requires administrator privileges. This is standard for Windows installers.
