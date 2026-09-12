# xirp-grok

Adds xAI's **Grok Build** CLI (`grok`) as a coding agent inside Spotify's **Xirp** desktop app.

Xirp is closed source and auto-updates, so this is a small patch tool: `xirp-grok apply` injects a
self-contained Grok harness into Xirp's bundled `@chirp/squab` package (outside the integrity-checked
`app.asar`), and `xirp-grok apply --if-needed` re-applies it after each Xirp update.

Status: work in progress. Not affiliated with Spotify or xAI.
