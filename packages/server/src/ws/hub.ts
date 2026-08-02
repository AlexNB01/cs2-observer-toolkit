import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { ClientToServerMessage, ServerToClientMessage } from "@cs2hud/shared";

const clients = new Set<WebSocket>();

/**
 * Single WS endpoint used by the admin panel to receive GSI events,
 * settings pushes, observer queue updates, and cinematic cues.
 */
export function registerWsHub(app: FastifyInstance): void {
  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    clients.add(socket);
    send(socket, { kind: "hello", clientId: randomUUID() });

    socket.on("message", (raw: Buffer) => {
      try {
        JSON.parse(raw.toString()) as ClientToServerMessage;
        // "identify" doesn't need handling — every client gets every
        // broadcast (fan-out), since payload volume is low.
      } catch {
        // ignore malformed frames
      }
    });

    socket.on("close", () => {
      clients.delete(socket);
    });
  });
}

function send(socket: WebSocket, message: ServerToClientMessage): void {
  socket.send(JSON.stringify(message));
}

export function broadcast(message: ServerToClientMessage): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}
