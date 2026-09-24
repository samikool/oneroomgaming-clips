import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { MissingAuthHeadersError, parseAuthentikHeaders } from "@/lib/auth";
import {
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "@/lib/realtime/envelope";
import { isAuthorizedEmit } from "./emit-auth";
import { Hub } from "./hub";
import { CHAT_COOLDOWN_MS, ChatLog, REACTION_COOLDOWN_MS } from "./chat-log";
import { RateLimiter } from "./rate-limit";
import { Room } from "./room";

const PORT = Number(process.env.REALTIME_PORT ?? 3001);
const EMIT_SECRET = process.env.EMIT_SECRET;
const MAX_EMIT_BYTES = 64 * 1024;

const hub = new Hub();
const room = new Room();
const chatLog = new ChatLog();
const chatLimiter = new RateLimiter(CHAT_COOLDOWN_MS);
const reactionLimiter = new RateLimiter(REACTION_COOLDOWN_MS);

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
    const parsed: unknown = JSON.parse(await readBody(request));

    // Only `web` can reach this endpoint, but a malformed body should still be
    // a clear 400 rather than an object fanned out to every connected socket.
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as { t?: unknown }).t !== "string"
    ) {
      response.writeHead(400, { connection: "close" }).end();
      return;
    }

    const delivered = hub.publish(parsed as ServerMessage);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ delivered }));
  } catch (error) {
    const status = error instanceof EmitBodyTooLargeError ? 413 : 400;
    response.writeHead(status, { connection: "close" }).end();
  }
}

function publishRoom(): void {
  hub.publish({ t: "room", state: room.state });
}

function publishPresence(): void {
  hub.publish({ t: "presence", online: hub.online, inRoom: room.members });
}

function handleRoomMessage(username: string, message: ClientMessage): void {
  switch (message.t) {
    case "room.join":
      if (room.join(username)) {
        publishRoom();
        publishPresence();
      }

      return;

    case "room.leave":
      if (room.leave(username)) {
        publishRoom();
        publishPresence();
      }

      return;

    case "room.claimHost":
      if (room.claimHost(username)) {
        publishRoom();
      }

      return;

    case "room.giveControl":
      if (room.giveControl(username, message.userId)) {
        publishRoom();
      }

      return;

    case "room.control":
      // An unauthorized command returns false and is dropped in silence. The
      // sender's client already shows disabled controls; a rejection message
      // would only invite the client to become the enforcement point.
      if (room.control(username, message)) {
        publishRoom();
      }

      return;

    case "chat.send": {
      // A refused message is dropped in silence. The sender's composer has
      // already cleared; telling them they typed too fast is noise.
      if (!chatLimiter.take(username)) {
        return;
      }

      hub.publish({ t: "chat", message: chatLog.add(username, message.text) });
      return;
    }

    case "reaction.send":
      if (!reactionLimiter.take(username)) {
        return;
      }

      hub.publish({ t: "reaction", user: username, emoji: message.emoji, at: Date.now() });
      return;

    default:
      return;
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
    publishPresence();

    ws.on("message", (data) => {
      // A malformed frame from one client must never disturb the process or
      // the other sockets, so a parse failure is ignored rather than thrown.
      const message = parseClientMessage(String(data));

      if (message === null) {
        return;
      }

      if (message.t === "sub") {
        hub.subscribe(ws, message.topics);
        // Send presence straight away; otherwise a fresh subscriber sees
        // nobody until the next join or leave.
        ws.send(JSON.stringify({ t: "presence", online: hub.online, inRoom: room.members }));

        if (message.topics.includes("room")) {
          ws.send(JSON.stringify({ t: "room", state: room.state }));
          ws.send(JSON.stringify({ t: "chat.backlog", messages: chatLog.messages }));
        }

        return;
      }

      if (message.t === "time.sync") {
        // t1 is stamped with the server's clock. The browser's Cristian offset
        // is computed from this, so a client-supplied t1 is useless.
        ws.send(JSON.stringify({ t: "time.sync", t0: message.t0, t1: Date.now() }));
        return;
      }

      if (message.t === "room.requestControl") {
        const host = room.requestControl(username);

        if (host !== null) {
          hub.sendTo(host, { t: "room.controlRequested", user: username });
        }

        return;
      }

      handleRoomMessage(username, message);
    });

    const drop = () => {
      hub.remove(ws);

      // Only a person's LAST socket going counts as leaving the room —
      // otherwise closing a second tab drops you out of the theater.
      if (!hub.online.includes(username) && room.leave(username)) {
        publishRoom();
      }

      publishPresence();
    };

    ws.on("close", drop);
    ws.on("error", drop);
  });
});

if (!EMIT_SECRET) {
  console.error("EMIT_SECRET is not set — refusing to start. The web process could not reach /emit.");
  process.exit(1);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`realtime listening on :${PORT}`);
});
