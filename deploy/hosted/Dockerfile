FROM registry-1.docker.io/library/node:24-bookworm-slim AS build
WORKDIR /build
COPY packages/hosted-contracts/package*.json packages/hosted-contracts/
RUN cd packages/hosted-contracts && npm ci --legacy-peer-deps --no-audit --no-fund
COPY packages/hosted-contracts/src packages/hosted-contracts/src
COPY packages/hosted-contracts/tsconfig.json packages/hosted-contracts/
RUN cd packages/hosted-contracts && npm run build
COPY services/hosted-app/package*.json services/hosted-app/
RUN cd services/hosted-app && npm ci --legacy-peer-deps --no-audit --no-fund
COPY services/hosted-app/src services/hosted-app/src
COPY services/hosted-app/scripts/build.mjs services/hosted-app/scripts/build.mjs
COPY desktop/src desktop/src
COPY packages/writing-plugin-contracts/src packages/writing-plugin-contracts/src
RUN cd services/hosted-app && node scripts/build.mjs && npm prune --legacy-peer-deps --omit=dev --no-audit --no-fund

FROM registry-1.docker.io/library/node:24-bookworm-slim
ENV NODE_ENV=production LANJIAN_HOST=0.0.0.0 LANJIAN_PORT=43130 LANJIAN_DATA_DIR=/data LANJIAN_WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /build/services/hosted-app/node_modules services/hosted-app/node_modules
COPY --from=build /build/services/hosted-app/dist/server.js services/hosted-app/dist/server.js
COPY --from=build /build/services/hosted-app/dist/operator-model.js services/hosted-app/dist/operator-model.js
COPY --from=build /build/services/hosted-app/package.json services/hosted-app/package.json
COPY --from=build /build/packages/hosted-contracts/dist packages/hosted-contracts/dist
COPY --from=build /build/packages/hosted-contracts/package.json packages/hosted-contracts/package.json
COPY web/dist web
USER 10001:10001
EXPOSE 43130
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:43130/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "services/hosted-app/dist/server.js"]
