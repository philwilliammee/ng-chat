# ---- Build stage ----
FROM node:24-alpine AS build

WORKDIR /app

# Install dependencies (layer caching — workspace members must be present for lockfile resolution)
COPY package.json package-lock.json ./
COPY packages/chat-server/package.json ./packages/chat-server/
COPY packages/chat-ui/package.json ./packages/chat-ui/
COPY packages/chat-storage/package.json ./packages/chat-storage/
RUN npm ci

# Copy source and build the Angular client (static assets only)
COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:24-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4315

# The Hono server runs directly from TypeScript via tsx, consuming the
# workspace packages as source. Copy everything needed to run.
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/server ./server
COPY --from=build /app/skills ./skills
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json ./

USER node

EXPOSE 4315

# tsx resolves the @ng-chat/* path aliases from tsconfig.json
CMD ["node", "--import", "tsx", "server/index.ts"]
