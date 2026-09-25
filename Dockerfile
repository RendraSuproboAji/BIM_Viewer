# syntax=docker/dockerfile:1
# Production images (see deploy/README.md):
#   web  nginx serving the built app (precompressed) and proxying /api to the API
#   api  the Node API as one bundled file plus its only native dependency

# ---- build: web app + server bundle --------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN node scripts/copy-wasm.mjs \
 && npx tsc -b && npx vite build \
 && npm run build:server \
 # Precompress text and WASM once, so nginx serves .gz files with gzip_static (no CPU per request).
 && find dist -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.wasm' \) \
      -size +1k -exec gzip -9 -k -n {} +

# ---- api dependencies: only better-sqlite3 (prebuilt for musl), everything else is bundled -------
FROM node:22-alpine AS api-deps
WORKDIR /deps
COPY package-lock.json /tmp/
RUN version=$(node -p "require('/tmp/package-lock.json').packages['node_modules/better-sqlite3'].version") \
 && echo '{"private":true}' > package.json \
 && npm install --omit=dev --ignore-scripts --no-audit --no-fund --no-package-lock "better-sqlite3@${version}" \
 # Keep only this platform's prebuilt binary.
 && find node_modules/better-sqlite3/prebuilds -type f ! -name "linuxmusl-$(node -p 'process.arch').node" -delete \
 && rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src node_modules/node-addon-api

# ---- api ------------------------------------------------------------------------------
FROM node:22-alpine AS api
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATA_DIR=/data \
    STATIC_DIR= \
    TRUST_PROXY=true
WORKDIR /app
COPY --from=api-deps /deps/node_modules ./node_modules
COPY --from=build /src/dist-server/index.mjs ./dist-server/index.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist-server/index.mjs"]

# ---- web (default target) ---------------------------------------------------------------
FROM nginx:1.29-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
