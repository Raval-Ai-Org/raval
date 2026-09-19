FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Railway automatically passes UI Variables as matching ARGs during build time
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# Shared AI/image cache across instances (src/server/cache/store.ts). Empty =
# in-process LRU only. docker-compose.yml points it at the redis service.
ENV REDIS_URL=

# Chromium for AI Visibility's rendering fallback (src/server/geo/render.server.ts).
# Pages are rendered only when their server HTML is an empty client-side app
# shell, and every request the browser makes is fulfilled through Mellox's
# SSRF-guarded fetcher. Enable with FEATURE_FLAG_GEO_RENDERING_ENABLED=true.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
ENV GEO_RENDER_EXECUTABLE=/usr/bin/chromium

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const port = process.env.PORT; if (!port) process.exit(1); fetch('http://127.0.0.1:' + port + '/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "server.js"]