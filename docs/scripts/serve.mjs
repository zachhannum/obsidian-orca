// Serves the built site for the browser suite. It stays in the foreground
// for as long as the suite runs, which is what Playwright's webServer waits on.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.argv[2] ?? 4329);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

createServer(async (request, response) => {
  const asked = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const file = path.join(dist, asked.endsWith("/") ? `${asked}index.html` : asked);
  const found = file.startsWith(dist) && (await stat(file).then((entry) => entry.isFile(), () => false));
  if (!found) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
}).listen(port);
