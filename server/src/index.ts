import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import config from "./config/config.json" with { type: "json" };
import { PeerConnectionManager, type SignalMessage } from "./webrtc/PeerConnectionManager.js";

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

const wss = new WebSocketServer({ server, path: "/ws" });

// MVP scope (specs/projeto.md §4.5): a single active streaming session at a time.
let activeSession: PeerConnectionManager | null = null;

wss.on("connection", (ws) => {
  if (activeSession) {
    ws.send(JSON.stringify({ type: "error", message: "session_busy" }));
    ws.close();
    return;
  }

  const manager = new PeerConnectionManager({
    monitorIndex: config.capture.monitorIndex,
    fps: config.capture.fps,
    send: (message) => ws.send(JSON.stringify(message)),
  });
  activeSession = manager;

  ws.on("message", async (raw) => {
    const message = JSON.parse(raw.toString()) as SignalMessage;
    if (message.type === "answer") {
      await manager.handleAnswer(message.sdp);
    } else if (message.type === "ice-candidate") {
      await manager.handleRemoteIceCandidate(message.candidate);
    }
  });

  ws.on("close", () => {
    manager.close();
    if (activeSession === manager) activeSession = null;
  });

  manager.start().catch((err) => {
    console.error("[webrtc] failed to start session", err);
    ws.close();
  });
});

server.listen(config.server.port, () => {
  console.log(`[chimera] Host server listening on http://localhost:${config.server.port}`);
});
