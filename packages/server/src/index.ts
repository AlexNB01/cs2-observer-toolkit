import { buildApp, buildLhmApp } from "./app.js";
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

const lhmApp = await buildLhmApp();
if (lhmApp) {
  try {
    await lhmApp.listen({ port: env.lhmHudPort, host: "0.0.0.0" });
    lhmApp.log.info(`LHM HUD: http://localhost:${env.lhmHudPort}/`);
  } catch (err) {
    lhmApp.log.error(err);
  }
}
