import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { ClientToServerMessage, ServerToClientMessage } from "@cs2hud/shared";

const clients = new Set<WebSocket>();

/**
 * Single WS endpoint shared by the admin panel, the HUD, the minimap view,
 * and the veto view. Clients announce their role via an "identify" message;
 * for now every client receives every broadcast (fan-out), since payload
 * volume is low (GSI events + settings pushes).
 */
export function registerWsHub(app: FastifyInstance): void {
  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    clients.add(socket);
    send(socket, { kind: "hello", clientId: randomUUID() });

    socket.on("message", (raw: Buffer) => {
      try {
        const message = JSON.parse(raw.toString()) as ClientToServerMessage;
        handleClientMessage(message);
      } catch {
        // ignore malformed frames
      }
    });

    socket.on("close", () => {
      clients.delete(socket);
    });
  });
}

function handleClientMessage(message: ClientToServerMessage): void {
  // "identify" doesn't need handling yet — every client gets every
  // broadcast regardless of role (see the fan-out note above).
  if (message.kind === "trigger_preview") {
    broadcast({ kind: "preview_triggered", preview: message.preview });
  }
  if (message.kind === "open_hud_overlay") {
    broadcast({ kind: "hud_overlay_requested" });
  }
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
