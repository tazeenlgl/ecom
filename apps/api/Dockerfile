# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w @ecom/api
COPY apps/api apps/api
RUN npm run build -w @ecom/api && npm prune --omit=dev -w @ecom/api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
USER node
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/server.js"]
