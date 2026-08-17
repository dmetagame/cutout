FROM node:22.22.0-bookworm-slim AS production-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/guard/package.json ./packages/guard/package.json
RUN npm ci --omit=dev \
    && rm -rf \
      node_modules/typescript \
      node_modules/@playwright \
      node_modules/playwright \
      node_modules/playwright-core

FROM node:22.22.0-bookworm-slim AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY packages/guard/package.json ./packages/guard/package.json
RUN npm ci
COPY . .
RUN npm run build
RUN npm run web:build

FROM node:22.22.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --chown=node:node --from=build /app/package.json /app/package-lock.json ./
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/src ./src
COPY --chown=node:node --from=build /app/scripts ./scripts
COPY --chown=node:node --from=build /app/fixtures ./fixtures
COPY --chown=node:node --from=build /app/apps/web ./apps/web
COPY --chown=node:node --from=build /app/packages/guard ./packages/guard
RUN mkdir -p /var/lib/cutout && chown node:node /var/lib/cutout
USER node

EXPOSE 3000
CMD ["npm", "run", "web:start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
