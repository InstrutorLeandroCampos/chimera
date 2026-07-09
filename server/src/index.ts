import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import config from "./config/config.json" with { type: "json" };

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const clientDir = join(__dirname, config.server.clientStaticDir);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  try {
    const url = req.url === "/" ? "/index.html" : req.url ?? "/index.html";
    const safePath = normalize(url).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(clientDir, safePath);

    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(config.server.port, () => {
  console.log(`[chimera] Host server listening on http://localhost:${config.server.port}`);
});
