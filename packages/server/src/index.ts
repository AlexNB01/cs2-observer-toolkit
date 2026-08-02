import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = await buildApp();

try {
  await app.listen({ port: env.httpPort, host: "0.0.0.0" });
  app.log.info(`GSI listener:  http://localhost:${env.httpPort}${env.gsiListenPath}`);
  app.log.info(`WebSocket hub: ws://localhost:${env.httpPort}/ws`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
