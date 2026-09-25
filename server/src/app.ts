import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { HttpError, requireUser, SESSION_COOKIE, userForToken } from "./auth.ts";
import { openDatabase } from "./db.ts";
import { authRoutes } from "./routes/auth.ts";
import type { RouteContext } from "./routes/context.ts";
import { issueRoutes } from "./routes/issues.ts";
import { modelRoutes } from "./routes/models.ts";
import { projectRoutes } from "./routes/projects.ts";
import { viewRoutes } from "./routes/views.ts";

export { toCsv } from "./csv.ts";

export interface AppOptions {
  /** SQLite file path, or ":memory:". */
  dbFile: string;
  /** Directory holding uploaded .frag files. */
  dataDir: string;
  /** Built web app to serve (production). Omit to serve the API only. */
  staticDir?: string;
  maxUploadMb?: number;
  logger?: boolean;
  /** Trust X-Forwarded-* headers (set when running behind a reverse proxy). */
  trustProxy?: boolean;
}

/** API routes reachable without signing in. */
const PUBLIC_ROUTES = new Set(["/api/health", "/api/auth/status", "/api/auth/setup", "/api/auth/login", "/api/auth/logout"]);

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  mkdirSync(join(options.dataDir, "models"), { recursive: true });
  const db = openDatabase(options.dbFile);
  const bodyLimit = (options.maxUploadMb ?? 500) * 1024 * 1024;
  const ctx: RouteContext = { db, dataDir: options.dataDir, bodyLimit };

  const app = Fastify({ logger: options.logger ?? false, trustProxy: options.trustProxy ?? false });
  app.addHook("onClose", async () => db.close());
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit }, (_req, body, done) => done(null, body));
  await app.register(fastifyCookie);

  // Resolve the signed-in user from the session cookie, and require one for everything but PUBLIC_ROUTES.
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req) => {
    req.user = userForToken(db, req.cookies[SESSION_COOKIE]);
  });
  app.addHook("preHandler", async (req) => {
    const path = req.url.split("?")[0];
    if (path.startsWith("/api/") && !PUBLIC_ROUTES.has(path)) requireUser(req);
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: (error as Error).message });
    req.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/api/health", async () => ({ ok: true }));
  await app.register(authRoutes(ctx));
  await app.register(projectRoutes(ctx));
  await app.register(modelRoutes(ctx));
  await app.register(viewRoutes(ctx));
  await app.register(issueRoutes(ctx));

  // ---- Web app (production) ------------------------------------------------
  if (options.staticDir && existsSync(options.staticDir)) {
    await app.register(fastifyStatic, { root: options.staticDir });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split("?")[0];
      // Client-side routes get the app; missing API routes and files (e.g. /assets/x.js) get a real 404.
      if (req.method !== "GET" || path.startsWith("/api/") || /\.[a-z0-9]+$/i.test(path)) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
