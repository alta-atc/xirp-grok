# xirp-grok

Adds xAI's **Grok Build** CLI (`grok`) as a coding agent inside Spotify's **Xirp** desktop app.

Xirp is closed source and auto-updates, so this is a small patch tool: `xirp-grok apply` injects a
self-contained Grok harness into Xirp's bundled `@chirp/squab` package (outside the integrity-checked
`app.asar`), and `xirp-grok apply --if-needed` re-applies it after each Xirp update.

Status: work in progress. Not affiliated with Spotify or xAI.

## Install

```sh
npx github:alta-atc/xirp-grok status
```

or clone it and link a local checkout:

```sh
git clone https://github.com/alta-atc/xirp-grok.git
cd xirp-grok
npm install
npm link
xirp-grok status
```

Requires Node >= 20 and macOS (Xirp.app is a macOS-only Electron app). By default the tool operates
on `/Applications/Xirp.app`; override with `--app <path>` or the `XIRP_APP` environment variable.

## Usage

```sh
xirp-grok status              # is the harness applied? which Xirp version?
xirp-grok apply               # patch Xirp.app to add the grok harness
xirp-grok apply --if-needed   # apply only if not already applied/up to date (used by the watcher)
xirp-grok remove              # undo the patch, restoring Xirp exactly as it was
xirp-grok doctor              # detailed diagnostics: app, chunk, grok binary, state, watcher
xirp-grok install-watcher     # install a LaunchAgent that re-applies the patch after Xirp updates
xirp-grok uninstall-watcher   # remove that LaunchAgent
```

Exit codes: `0` success/no-op, `1` error, `2` unsupported Xirp version (the patcher couldn't find its
injection point — likely a newer/older Xirp release than this tool has been tested against).

## What it touches

`xirp-grok apply` never modifies `app.asar` (which is integrity-checked). It only touches files inside
`Xirp.app/Contents/Resources/app.asar.unpacked/node_modules/@chirp/squab/dist/`:

- `chunks/<registry-chunk>.js` — the squab CLI chunk that registers coding-agent harnesses (found by a
  content signature, since its filename hash changes every Xirp release). A one-line import is appended
  to it: `import { registerGrok } from "./grok-harness.js"; registerGrok(rt, ot);`
- `chunks/<registry-chunk>.js.orig` — a byte-for-byte backup of that chunk, made once, before the first
  edit.
- `chunks/grok-harness.js` — the built Grok harness module.

It also writes a small state marker to `~/.xirp-grok/state.json` (hashes and versions, so future runs
can detect Xirp updates and re-apply automatically), and, if you run `install-watcher`, a LaunchAgent at
`~/Library/LaunchAgents/com.alta-atc.xirp-grok.plist` that watches Xirp's `Info.plist` and runs
`apply --if-needed` whenever it changes.

## Removing it

```sh
xirp-grok remove
```

This restores the registry chunk from its `.orig` backup, deletes `grok-harness.js` and the backup, and
clears the state marker. Run `xirp-grok uninstall-watcher` first if you installed the watcher.
