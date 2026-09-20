# Web Profile

### Desktop launcher for local frontend projects — scan, start, and manage dev servers from one workspace

[![Version](https://img.shields.io/github/v/release/Kevin031/web-profile?color=blue&label=version)](https://github.com/Kevin031/web-profile/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey.svg)](https://github.com/Kevin031/web-profile/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](package.json)

English | [中文](README_ZH.md)

## Why Web Profile?

If you keep many frontend repos under one folder, you already know the routine: open a terminal, `cd` into the project, run `pnpm dev` or `npm run dev`, hunt for the Local URL in logs, and repeat for every app. **Web Profile** is a Tauri desktop app that scans your project root, shows Git status, starts dev servers, surfaces URLs from logs, and lets you stop or restart everything from a single UI.

- **One workspace for all projects** — Table or grid view, search, favorites, and filters (running / dirty / hidden)
- **Real process management** — Start default commands or `package.json` scripts in parallel; stop individual services or all projects
- **Git at a glance** — Branch, working tree state, pull, and checkout from the detail panel
- **Open anywhere** — File Explorer, VS Code, Cursor, or terminal; preference is saved globally
- **Bilingual UI** — English and Chinese; switch in **Settings → Language** (default: English)
- **Cross-platform desktop** — Windows installer and portable builds; macOS app packaging supported in release workflow

The web preview (`npm run web`) uses the same React UI with mock data for frontend development only — it cannot start local processes or run Git operations.

## Features

### Project workspace

- Scan direct child folders under a configurable root; only directories with `package.json` are listed
- Search by name, path, branch, scripts, and status
- Favorite, hide, and restore projects without touching files on disk
- Remember table vs grid layout and default open tool

### Dev server control

- Default start command per project (usually `npm run dev`); override and save in the detail panel
- Run scripts from `package.json` with the detected package manager (`pnpm`, `yarn`, `bun`, or `npm`)
- Parse multiple local URLs from stdout (e.g. frontend + API ports) and open each in the browser
- Per-service log tabs, stop one run or all runs for a project; global **Stop all**

### Git integration

- Refresh status (branch, clean/dirty, ahead/behind)
- Checkout local branches and `pull --ff-only`
- Filter projects with uncommitted changes

### Updates

- Check GitHub Release `latest.json` on startup; install signed updates from the toolbar when you choose

## Quick Start

1. Install or run the portable build (see [Installation](#installation)).
2. On first launch, pick your **project root** if the default `D:/Projects` is missing.
3. Click **Refresh** to scan projects.
4. Select a project → verify the **Start** command → click **Start** in the list.
5. When status is **Running**, open URLs from the table or the **Visit** section in the detail panel.

**Language:** click the **Settings** (gear) icon → **Language** → **English** or **中文**. The choice is saved in app config.

## Installation

### Requirements (end users)

- Windows 10/11 x64 (primary target) or macOS for packaged `.app` builds
- Microsoft Edge WebView2 Runtime (installer can bootstrap WebView2 on Windows; portable builds need WebView2 preinstalled)
- Git, Node.js, and the package managers your projects use (`npm`, `pnpm`, `yarn`, or `bun`)
- Optional: VS Code or Cursor CLI for “open project” actions

### Windows — installer

Build or download the NSIS installer:

```text
src-tauri/target/release/bundle/nsis/Web Profile_<version>_x64-setup.exe
```

### Windows — portable

```text
release/Web Profile-portable-x64/Web Profile.exe
```

Portable mode does not require installation; config and cache still live under the current user profile.

### Project root layout

```text
D:/Projects/
├── project-a/
│   └── package.json
├── project-b/
│   └── package.json
└── documents/          # ignored (no package.json)
```

Only **immediate** subfolders of the root are scanned (not recursive). Change the root via **Settings → Change project root** or the sidebar **Change root** button.

## Daily usage

### Find and filter

- Search box (also `Ctrl/Cmd+K` or `/` when focus is not in an input)
- Filters: All, Favorites, Running, Dirty, Hidden
- Arrow keys to move selection; `Enter` to start or stop the selected project

### Start projects

1. Select a project and check the start command (default `npm run dev`).
2. Save if needed (`pnpm dev`, `npm run serve`, etc.).
3. Click **Start**. When logs show a Local URL, links appear in the URL column and **Visit** panel.

Script buttons use `pnpm <script>`, `yarn <script>`, or `npm run <script>` based on lockfiles. Multiple scripts can run in parallel; badges may show `Running ×2` when several services are live.

### Stop and restart

- Row **Stop** ends all services for that project (full process tree).
- **Restart** in the more-actions menu uses the saved default start command.
- Log tab header can stop a single service.
- Toolbar **Stop all** stops every Web Profile–managed process.
- Closing the app while projects are running prompts to stop all and exit.

### Open project folder

Use the open button dropdown to set the default tool: File Explorer, VS Code, Cursor, or Terminal (Windows Terminal / iTerm on macOS).

### Git

- **Refresh Git** in the row more menu
- Branch selector and **Pull** in the detail panel
- **Dirty** filter for projects with uncommitted changes

### Logs

Each run gets a tab titled by command; up to 500 lines per service in memory. History may not survive an app restart.

## Development

Install dependencies:

```powershell
npm install
```

Desktop dev (Tauri + Vite on `http://127.0.0.1:1420`):

```powershell
npm run dev
```

UI-only preview with mock data:

```powershell
npm run web
```

Checks:

```powershell
npm run typecheck
npm test
npm run lint
```

Rust (from `src-tauri`):

```powershell
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Additional requirements for building on Windows: Rust stable MSVC, Visual Studio 2022 Build Tools with **Desktop development with C++**. Project scripts try to load Rustup from `%USERPROFILE%/.cargo/bin` when `PATH` is not updated yet.

## Build & release

### Publish the landing page and Windows download through Omni Link

The release uses two fixed Omni Link entries: one keeps the Windows ZIP as a download, while the other extracts the landing-page ZIP as a static site. The first run uses company SSO and stores both release IDs and share URLs in the ignored `release.local.json`; later runs update those entries in place so their URLs remain stable.

```powershell
# Build dist/web-profile-windows-x64.zip without uploading
npm run package:release

# Validate, package, and update both Omni Link entries
npm run release:omni

# Prompt for a version, build installer + portable app, then publish
npm run publish:omni
```

The download ZIP contains the standard installer and portable build. The landing-page package is `dist/web-profile-site.zip`; packaging replaces its download button URL with the separate Omni Link download entry. The command prints both share URLs when it finishes.

`publish:omni` shows the current version and requires an explicit `x.y.z` version. It permits republishing the same version but rejects downgrades, synchronizes npm/Tauri/Cargo/landing versions, runs tests, type checking, and ESLint, builds both Windows packages, then updates the two Omni Link entries. It bypasses the automatic patch bump in `prebuild`.

> `build`, `build:portable`, and `build:portable:desktop` bump the patch version in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` before building. Do not use them for side-effect-free verification.

| Command | Output |
| --- | --- |
| `npm run build` | NSIS installer under `src-tauri/target/release/bundle/nsis/` |
| `npm run build:portable` | `release/Web Profile-portable-x64/Web Profile.exe` |
| `npm run build:portable:desktop` | Portable build + versioned shortcut (Windows) or `/Applications/Web Profile.app` (macOS) |

GitHub Releases publish signed Windows/macOS update artifacts and `latest.json`. Set `TAURI_SIGNING_PRIVATE_KEY` in Actions secrets; keep the private key backed up outside the repo.

## Configuration & data

| Data | Path | Notes |
| --- | --- | --- |
| App config | `%APPDATA%/com.webprofile.app/web-profile.config.json` | Root, favorites, hidden paths, commands, open tool, view mode, **language** |
| Scan cache | `%LOCALAPPDATA%/com.webprofile.app/web-profile.projects.cache.json` | Safe to delete to force a rescan |
| Legacy Electron config | `%APPDATA%/web-profile/web-profile.config.json` | Imported once if the new config file does not exist |

Quit Web Profile before hand-editing config files.

## FAQ

**Project missing from the list?** Confirm it is a direct child of the root with a valid `package.json`, click **Refresh**, and check the **Hidden** filter.

**Start failed?** Run the same command in a terminal, ensure dependencies are installed, and read the first error line in **Logs**.

**No URL after start?** The app parses lines like `Local: http://localhost:5173/` from logs; open the port manually if your dev server does not print a full URL.

**VS Code / Cursor won’t open?** Install the editor and enable its shell command; or switch the default open tool to Explorer or Terminal.

**Git errors?** Run `git status`, `git remote -v`, and `git branch -vv` in the project directory.

**App won’t start?** Repair WebView2, free port `1420` for dev mode, or delete only the scan cache (not config) after backing up.

## Security

The renderer has no broad shell or filesystem access. Start commands run only for registered project directories; Git, process control, and open-url actions go through controlled Tauri commands on the backend.
