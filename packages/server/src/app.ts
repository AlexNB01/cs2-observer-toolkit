import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { env } from "./config/env.js";
import { migrate } from "./db/schema.js";
import { registerWsHub } from "./ws/hub.js";
import { registerGsiListener } from "./gsi/listener.js";
import { registerApiRoutes } from "./api/index.js";
import { reconnectObsFromSavedConfig } from "./obs/client.js";

// Re-exported so in-process consumers (the Electron desktop app) can push
// messages — e.g. global-hotkey-triggered visibility toggles — without a
// WS round-trip back into their own server.
export { broadcast } from "./ws/hub.js";
export { buildLhmApp } from "./lhm/app.js";

export async function buildApp() {
  migrate();
  reconnectObsFromSavedConfig();

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: env.webOrigin });
  await app.register(websocket);

  registerWsHub(app);
  registerGsiListener(app);
  registerApiRoutes(app);

  app.get("/health", async () => ({ ok: true }));

  // Serves the built admin/HUD/minimap/veto SPA when present (the Electron
  // desktop app and any other single-port deployment) — absent in the
  // plain `npm run dev` flow, which uses the Vite dev server instead.
  if (fs.existsSync(env.webDistDir)) {
    await app.register(fastifyStatic, { root: env.webDistDir });
    app.setNotFoundHandler((request, reply) => {
      const isApiRoute = request.url.startsWith("/api") || request.url.startsWith(env.gsiListenPath) || request.url.startsWith("/ws");
      if (request.method !== "GET" || isApiRoute) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
