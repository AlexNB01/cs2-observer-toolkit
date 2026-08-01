import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { env } from "../config/env.js";
import { registerLhmRestRoutes } from "./rest.js";
import { registerLhmSocket } from "./socket.js";

/**
 * Standalone server for the vendored lexogrine/cs2-react-hud (MIT) — see
 * rest.ts's doc comment for why this can't share the main app's port/prefix.
 * Absent (buildLhmApp resolves to null) until `npm run build` is run in
 * /lhm-hud, same as the main SPA's webDistDir gate in app.ts.
 */
export async function buildLhmApp() {
  if (!fs.existsSync(env.lhmHudDistDir)) return null;

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: "*" });

  registerLhmRestRoutes(app);
  registerLhmSocket(app.server);

  await app.register(fastifyStatic, { root: env.lhmHudDistDir });

  return app;
}
