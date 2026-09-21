import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { MissingAuthHeadersError, parseAuthentikHeaders } from "@/lib/auth";
import { isAuthorizedEmit } from "./emit-auth";
import { Hub } from "./hub";

const PORT = Number(process.env.REALTIME_PORT ?? 3001);
const EMIT_SECRET = process.env.EMIT_SECRET;
const MAX_EMIT_BYTES = 64 * 1024;

const hub = new Hub();

class EmitBodyTooLargeError extends Error {
  constructor() {
    super("emit body too large");
    this.name = "EmitBodyTooLargeError";
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let aborted = false;
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      if (aborted) {
        return;
      }

      size += chunk.length;

      if (size > MAX_EMIT_BYTES) {
        aborted = true;
        chunks.length = 0;
        request.resume();
        reject(new EmitBodyTooLargeError());
        return;
      }

      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!aborted) {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    request.on("error", reject);
  });
}

async function handleEmit(request: IncomingMessage, response: ServerResponse) {
  if (!isAuthorizedEmit(request.headers["x-emit-secret"], EMIT_SECRET)) {
    response.writeHead(403).end();
    return;
  }

  try {
    const delivered = hub.broadcast(JSON.parse(await readBody(request)));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ delivered }));
  } catch (error) {
    const status = error instanceof EmitBodyTooLargeError ? 413 : 400;
    response.writeHead(status, { connection: "close" }).end();
  }
}

export const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", sockets: hub.size }));
    return;
  }

  if (request.method === "POST" && request.url === "/emit") {
    void handleEmit(request, response);
    return;
  }

  response.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  let username: string;

  try {
    username = parseAuthentikHeaders(request.headers).username;
  } catch (error) {
    const status = error instanceof MissingAuthHeadersError
      ? "401 Unauthorized"
      : "500 Internal Server Error";
    socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    hub.add(ws, username);
    ws.send(JSON.stringify({ t: "hello", username, serverTime: Date.now() }));
    ws.on("close", () => hub.remove(ws));
    ws.on("error", () => hub.remove(ws));
  });
});

if (!EMIT_SECRET) {
  console.error("EMIT_SECRET is not set — refusing to start. The web process could not reach /emit.");
  process.exit(1);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`realtime listening on :${PORT}`);
});
