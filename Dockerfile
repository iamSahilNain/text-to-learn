FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build-base
RUN npm install --global npm@11.6.2

FROM build-base AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json client/.npmrc ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM build-base AS server-dependencies
WORKDIR /app/server
COPY server/package.json server/package-lock.json server/.npmrc ./
RUN npm ci --omit=dev

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app/server
COPY --chown=node:node server/ ./
COPY --from=server-dependencies --chown=node:node /app/server/node_modules ./node_modules
COPY --from=client-build --chown=node:node /app/client/dist /app/client/dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3001') + '/healthz', {signal: AbortSignal.timeout(4000)}).then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server.js"]
