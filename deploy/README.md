# Deploying with nginx

```bash
docker compose up -d --build      # http://localhost:8080 (BIM_PORT=80 docker compose up -d to change the port)
deploy/smoke-test.sh              # optional: build, start and check the whole stack, then remove it
```

On first start, open the site and create the administrator account.

## What runs

| Container | Image | What it does |
| --- | --- | --- |
| `web` | `nginx:1.29-alpine` + the built app | Serves the app from disk and proxies `/api/` to `api`. The only published port. |
| `api` | `node:22-alpine` + one bundled file | The API server with its SQLite database on the `bim-data` volume. |

### Why it's fast and light
- **Node never serves files.**
  - nginx sends the app, the JS/CSS and the web-ifc WASM straight from disk (`sendfile`, cached file handles).
  - The API container is started with `STATIC_DIR` empty, so it only answers `/api/`.
- **Everything is compressed once, at build time.**
  - The build writes `.gz` copies of JS, CSS, HTML, SVG and the 1.3 MB WASM, and nginx serves them with `gzip_static`, spending no CPU per request.
  - Only API JSON is compressed on the fly.
- **Long-lived caching of hashed assets.**
  - `/assets/*` carry a content hash and are sent with `Cache-Control: immutable` for a year, so returning users download nothing.
  - `index.html` is always revalidated, so a new deploy is picked up at once.
- **A tiny API image.**
  - `npm run build:server` bundles the server and all its dependencies into one ~2 MB file (`dist-server/index.mjs`, built with esbuild).
  - The image adds only `better-sqlite3`, using its prebuilt musl binary with no compiler. There is no `tsx`, TypeScript or dev dependency at runtime.
  - It runs as the unprivileged `node` user.
- **Streaming, not buffering.**
  - Uploads (`.frag`, `.bcfzip`, up to 500 MB) and model downloads pass through nginx without being spooled to disk.
  - nginx keeps connections to the API open (`keepalive`).
- **Health checks.** `web` waits for `api` to be healthy before it starts.

Measured through nginx (gzip), opening the viewer downloads about 0.9 MB. The IFC converter adds
1.1 MB the first time an `.ifc` file is opened; `.frag` files and library models don't need it.

| File | Raw | Transferred | When |
| --- | --- | --- | --- |
| App JS (React, three.js, fragments and app chunks) | 2.7 MB | 0.63 MB | Always |
| Fragments worker (minified) | 1.4 MB | 0.28 MB | Always |
| IFC worker | 4.5 MB | 0.63 MB | First `.ifc` opened |
| web-ifc WASM | 1.3 MB | 0.47 MB | First `.ifc` opened |

Before these optimisations, the same first visit downloaded 2.8 MB, 1.6 MB of it before anything was opened.

Later visits download only `index.html`. After an app update, only the app chunk changes: the React, three.js and fragments chunks stay cached. The WASM is re-checked once a day.

nginx listens on IPv4 only, which is what Docker's default bridge network uses. If your host has IPv6, add `listen [::]:80;` to `deploy/nginx.conf`.

## HTTPS

Put TLS in front of the `web` container, for example with a load balancer, Caddy or Traefik, or another nginx holding your certificate.

- **Forward the scheme:** make sure that proxy sends `X-Forwarded-Proto: https`. nginx passes it on, and the API then marks the session cookie `Secure`.
- **Or terminate TLS here:** to do it in this nginx, add a `listen 443 ssl` server block with your certificate to `deploy/nginx.conf`, and publish port 443.

## Settings

Set these under `api.environment` in `compose.yaml`.

| Variable | Default | |
| --- | --- | --- |
| `MAX_UPLOAD_MB` | `500` | Largest upload. Keep `client_max_body_size` in `deploy/nginx.conf` in step. |
| `TRUST_PROXY` | `true` | The API sits behind nginx, so client IPs come from `X-Forwarded-For` (used for login throttling). |
| `DATA_DIR` | `/data` | Database and model files: the `bim-data` volume. |

## Backups

All state lives in the `bim-data` volume: `bim.sqlite`, plus the `.frag` files under `models/`.

```bash
docker compose exec api node -e "require('better-sqlite3')('/data/bim.sqlite').backup('/data/backup.sqlite').then(()=>console.log('ok'))"
docker compose cp api:/data ./bim-backup
```

## Updating

```bash
git pull && docker compose up -d --build
```

Database migrations run automatically when the API starts.
