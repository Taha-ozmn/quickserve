#!/usr/bin/env node
"use strict";

/**
 * QuickServe — a zero-dependency static file server with live reload.
 *
 * Serve the current directory (or any folder) over HTTP with pretty request
 * logs, automatic directory listings, correct MIME types, byte-range support
 * and live reload: edit an .html/.css/.js file and the browser refreshes
 * itself. No npm install, no config — just Node.js.
 *
 * Usage:
 *   node quickserve.js                 # serve ./ on http://localhost:3000
 *   node quickserve.js ./public 8080   # serve ./public on port 8080
 *   node quickserve.js --no-reload     # disable live reload
 *
 * Flags:
 *   -p, --port <n>      Port (default 3000, auto-increments if busy)
 *   --no-reload         Disable the live-reload websocket-less injector
 *   --no-open           Don't try to open the browser
 *   -h, --help          Show help
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// --------------------------------------------------------------------------
// Arg parsing
// --------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opts = { root: ".", port: 3000, reload: true, open: true };

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") {
    console.log(helpText());
    process.exit(0);
  } else if (a === "-p" || a === "--port") {
    opts.port = parseInt(argv[++i], 10);
  } else if (a === "--no-reload") {
    opts.reload = false;
  } else if (a === "--no-open") {
    opts.open = false;
  } else if (/^\d+$/.test(a)) {
    opts.port = parseInt(a, 10);
  } else if (!a.startsWith("-")) {
    opts.root = a;
  }
}

const ROOT = path.resolve(opts.root);
if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(color("31", `Error: '${ROOT}' is not a directory.`));
  process.exit(1);
}

// --------------------------------------------------------------------------
// MIME types
// --------------------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg",
  ".wasm": "application/wasm", ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml", ".csv": "text/csv",
};
const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || "application/octet-stream";

// --------------------------------------------------------------------------
// Live reload: track connected SSE clients, watch the tree, ping on change.
// --------------------------------------------------------------------------
const clients = new Set();
const RELOAD_SNIPPET = `
<script>
(function(){
  var es = new EventSource("/__quickserve_reload");
  es.onmessage = function(){ location.reload(); };
  es.onerror = function(){ /* server restarting; browser will retry */ };
})();
</script>`;

if (opts.reload) {
  try {
    const watcher = fs.watch(ROOT, { recursive: true }, debounce(() => {
      for (const res of clients) res.write("data: reload\n\n");
    }, 120));
    // A failed watch must never crash the server — just disable live reload.
    watcher.on("error", () => {
      opts.reload = false;
      console.log(color("33", "  (live reload disabled — file watching unavailable)"));
    });
  } catch {
    opts.reload = false;
    console.log(color("33", "  (live reload unavailable on this platform)"));
  }
}

// --------------------------------------------------------------------------
// Request handler
// --------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const start = Date.now();
  const urlPath = decodeURIComponent(req.url.split("?")[0]);

  // Live-reload event stream
  if (urlPath === "/__quickserve_reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  // Resolve & guard against path traversal.
  let filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    return send(res, 403, "Forbidden", req, start);
  }

  fs.stat(filePath, (err, stat) => {
    if (err) return notFound(res, req, start, urlPath);

    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      if (fs.existsSync(indexPath)) {
        return serveFile(indexPath, req, res, start);
      }
      return listing(filePath, urlPath, res, req, start);
    }
    serveFile(filePath, req, res, start);
  });
});

function serveFile(filePath, req, res, start) {
  const mime = mimeFor(filePath);
  const stat = fs.statSync(filePath);

  // Inject live-reload snippet into HTML responses.
  if (mime.startsWith("text/html") && opts.reload) {
    let html = fs.readFileSync(filePath, "utf8");
    html = html.includes("</body>")
      ? html.replace("</body>", RELOAD_SNIPPET + "</body>")
      : html + RELOAD_SNIPPET;
    const buf = Buffer.from(html);
    res.writeHead(200, { "Content-Type": mime, "Content-Length": buf.length });
    res.end(buf);
    return log(req, 200, start);
  }

  // Byte-range support (video/audio seeking).
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace("bytes=", "").split("-");
    const startByte = parseInt(s, 10) || 0;
    const endByte = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, {
      "Content-Type": mime,
      "Content-Range": `bytes ${startByte}-${endByte}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": endByte - startByte + 1,
    });
    fs.createReadStream(filePath, { start: startByte, end: endByte }).pipe(res);
    return log(req, 206, start);
  }

  res.writeHead(200, { "Content-Type": mime, "Content-Length": stat.size });
  fs.createReadStream(filePath).pipe(res);
  log(req, 200, start);
}

function listing(dir, urlPath, res, req, start) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  const rows = entries.map((e) => {
    const name = e.name + (e.isDirectory() ? "/" : "");
    const href = path.posix.join(urlPath, encodeURIComponent(e.name)) + (e.isDirectory() ? "/" : "");
    const icon = e.isDirectory() ? "📁" : "📄";
    return `<li><a href="${href}">${icon} ${name}</a></li>`;
  }).join("\n");
  const up = urlPath !== "/" ? `<li><a href="${path.posix.dirname(urlPath)}">↩ ..</a></li>` : "";
  const html = `<!doctype html><meta charset="utf-8"><title>Index of ${urlPath}</title>
<style>body{font:15px/1.7 -apple-system,system-ui,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;color:#e6edf3;background:#0d1117}
h1{font-size:18px;color:#58a6ff}ul{list-style:none;padding:0}li{padding:2px 0}
a{color:#e6edf3;text-decoration:none}a:hover{color:#58a6ff}footer{margin-top:30px;color:#8b949e;font-size:12px}</style>
<h1>Index of ${urlPath}</h1><ul>${up}${rows}</ul><footer>QuickServe</footer>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
  log(req, 200, start);
}

function notFound(res, req, start, urlPath) {
  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>404</title>
<body style="font:16px system-ui;background:#0d1117;color:#e6edf3;text-align:center;padding:80px">
<h1 style="font-size:64px;margin:0;color:#ff7b72">404</h1>
<p style="color:#8b949e">Not found: <code>${urlPath}</code></p></body>`);
  log(req, 404, start);
}

function send(res, code, msg, req, start) {
  res.writeHead(code, { "Content-Type": "text/plain" });
  res.end(msg);
  log(req, code, start);
}

// --------------------------------------------------------------------------
// Logging
// --------------------------------------------------------------------------
function log(req, status, start) {
  const ms = Date.now() - start;
  const codeColor = status < 300 ? "32" : status < 400 ? "36" : status < 500 ? "33" : "31";
  const time = new Date().toLocaleTimeString();
  console.log(
    `${color("2", time)}  ${color(codeColor, status)}  ${req.method.padEnd(4)} ` +
    `${req.url}  ${color("2", ms + "ms")}`
  );
}

// --------------------------------------------------------------------------
// Boot with port auto-increment
// --------------------------------------------------------------------------
function listen(port, attemptsLeft = 10) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log(color("33", `  Port ${port} busy, trying ${port + 1}…`));
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error(color("31", `  Failed to start: ${err.message}`));
      process.exit(1);
    }
  });
  server.listen(port, () => banner(port));
}

function banner(port) {
  const url = `http://localhost:${port}`;
  console.log();
  console.log(color("36", color("1", "  QuickServe")) + color("2", " · static dev server"));
  console.log(color("2", "  ┌" + "─".repeat(40)));
  console.log(color("2", "  │ ") + "serving  " + color("1", path.relative(process.cwd(), ROOT) || "."));
  console.log(color("2", "  │ ") + "local    " + color("32", url));
  console.log(color("2", "  │ ") + "reload   " + (opts.reload ? color("32", "on") : color("2", "off")));
  console.log(color("2", "  └" + "─".repeat(40)));
  console.log(color("2", "  Press Ctrl+C to stop\n"));
  if (opts.open) openBrowser(url);
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start \"\"" : "xdg-open";
  try { execSync(`${cmd} ${url}`, { stdio: "ignore" }); } catch { /* ignore */ }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function color(code, text) {
  return process.stdout.isTTY && !process.env.NO_COLOR
    ? `\x1b[${code}m${text}\x1b[0m`
    : String(text);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function helpText() {
  return `QuickServe — zero-dependency static dev server with live reload

Usage:
  node quickserve.js [folder] [port] [flags]

Examples:
  node quickserve.js                 serve ./ on http://localhost:3000
  node quickserve.js ./public 8080   serve ./public on port 8080
  node quickserve.js --no-reload     disable live reload

Flags:
  -p, --port <n>   Port (default 3000, auto-increments if busy)
  --no-reload      Disable live reload
  --no-open        Don't open the browser automatically
  -h, --help       Show this help`;
}

process.on("SIGINT", () => {
  console.log(color("2", "\n  Bye 👋\n"));
  process.exit(0);
});

listen(opts.port);
