import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(__dirname, "src/main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: path.join(__dirname, "dist/main.js"),
  // electron is provided by the Electron runtime, never bundled. Everything
  // else (fastify, ws, obs-websocket-js, ...) is pure JS and gets inlined,
  // so the packaged app ships one self-contained file with no node_modules.
  external: ["electron"],
  banner: {
    // Some bundled CJS deps call require() for things esbuild can't
    // statically resolve into this ESM output — this restores a working
    // require() in that scope.
    js: "import { createRequire as __cs2hudCreateRequire } from 'node:module'; const require = __cs2hudCreateRequire(import.meta.url);",
  },
  sourcemap: true,
  logLevel: "info",
});

// Separate entry point: a sandboxed BrowserWindow's preload script runs in
// its own isolated context and, unlike main.ts, Electron always loads it
// as CommonJS regardless of the app's own "type": "module" — hence its own
// build step with format: "cjs" rather than folding it into main.ts's ESM
// bundle.
await build({
  entryPoints: [path.join(__dirname, "src/preload.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: path.join(__dirname, "dist/preload.js"),
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});
