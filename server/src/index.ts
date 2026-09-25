import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = resolve(process.env.DATA_DIR ?? join(root, "server", "data"));

const app = await buildApp({
  dataDir,
  dbFile: join(dataDir, "bim.sqlite"),
  // Serves the built web app too when `npm run build` has been run.
  staticDir: join(root, "dist"),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 500),
  logger: true,
  trustProxy: process.env.TRUST_PROXY === "true",
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
await app.listen({ port, host });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}
