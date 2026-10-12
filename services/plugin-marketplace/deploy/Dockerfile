FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
COPY packages/writing-plugin-contracts packages/writing-plugin-contracts
COPY packages/writing-plugin-package packages/writing-plugin-package
COPY services/plugin-marketplace services/plugin-marketplace
RUN cd packages/writing-plugin-contracts && npm ci && npm run build && npm prune --omit=dev
RUN cd packages/writing-plugin-package && npm ci && npm run build && npm prune --omit=dev
RUN cd services/plugin-marketplace && npm ci && npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ENV NODE_ENV=production MARKET_HOST=0.0.0.0 MARKET_PORT=43120 MARKET_DATA_DIR=/data
WORKDIR /app/services/plugin-marketplace
COPY --from=build --chown=node:node /app/packages /app/packages
COPY --from=build --chown=node:node /app/services/plugin-marketplace/dist ./dist
COPY --from=build --chown=node:node /app/services/plugin-marketplace/node_modules ./node_modules
COPY --from=build --chown=node:node /app/services/plugin-marketplace/package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 43120
CMD ["node", "dist/server.js"]
