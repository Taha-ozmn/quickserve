# ⚡ QuickServe

> A zero-dependency static file server with live reload — in one Node.js file.

Need to preview a website *right now*? QuickServe serves any folder over HTTP with pretty request logs, automatic directory listings, correct MIME types, byte-range support (video seeking), and **live reload** — save a file and your browser refreshes itself. No `npm install`, no config.

```
  QuickServe · static dev server
  ┌────────────────────────────────────────
  │ serving  ./public
  │ local    http://localhost:3000
  │ reload   on
  └────────────────────────────────────────
  Press Ctrl+C to stop

  14:22:01  200  GET  /            3ms
  14:22:01  200  GET  /styles.css  1ms
  14:22:05  404  GET  /missing.js  0ms
```

## ✨ Features

- **Live reload** — edits to HTML/CSS/JS trigger an automatic browser refresh (via Server-Sent Events; no extra libraries)
- **Directory listings** — clean, dark-themed index pages when there's no `index.html`
- **Correct MIME types** — 30+ extensions mapped out of the box
- **Byte-range support** — proper video/audio seeking (`206 Partial Content`)
- **Auto port-increment** — if the port is busy, it tries the next one
- **Path-traversal safe** — requests can't escape the served directory
- **Opens your browser** automatically (disable with `--no-open`)
- **Zero dependencies** — only Node.js built-ins

## 🚀 Usage

```bash
# Serve the current folder on http://localhost:3000
node quickserve.js

# Serve ./public on port 8080
node quickserve.js ./public 8080

# Disable live reload / auto-open
node quickserve.js --no-reload --no-open
```

Make it a global command (optional):

```bash
chmod +x quickserve.js
ln -s "$(pwd)/quickserve.js" /usr/local/bin/quickserve
quickserve ./dist
```

### Options

| Flag | Description |
|------|-------------|
| `[folder]` | Folder to serve (default `.`) |
| `[port]` or `-p, --port <n>` | Port (default 3000, auto-increments if busy) |
| `--no-reload` | Disable live reload |
| `--no-open` | Don't open the browser automatically |
| `-h`, `--help` | Show help |

> **Note:** Live reload relies on recursive file watching. On systems with a low open-file limit it degrades gracefully — the server keeps running, just without auto-refresh.

## License

[MIT](./LICENSE)
