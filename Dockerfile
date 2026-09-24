FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build
RUN bun build src/realtime/index.ts --target=bun --outfile=realtime.js

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=bun:bun /app/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/.next/static ./.next/static
COPY --from=builder --chown=bun:bun /app/public ./public
COPY --from=builder --chown=bun:bun /app/realtime.js ./realtime.js
COPY --from=builder --chown=bun:bun /app/drizzle ./drizzle
COPY --from=builder --chown=bun:bun /app/content ./content

RUN mkdir -p /data /media && chown bun:bun /data /media
ENV MEDIA_ROOT=/media
USER bun

EXPOSE 3000 3001
CMD ["bun", "server.js"]
