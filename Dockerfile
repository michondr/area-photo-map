# syntax=docker/dockerfile:1

# prod node_modules (server runtime deps; web deps are build-time only)
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --omit=dev

# build both workspaces
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY web/package.json ./web/
COPY web/tsconfig.json ./web/
COPY web/vite.config.ts ./web/
COPY web/index.html ./web/
COPY web/src ./web/src
RUN npm ci && npm run build -w web && npm run build -w server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=deps /repo/node_modules ./node_modules
COPY server/package.json ./
COPY server/migrations ./migrations
COPY --from=build /repo/server/dist ./dist
COPY --from=build /repo/web/dist ./public
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]