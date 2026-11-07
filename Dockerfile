# Self-hosted image for Coolify.
#
# The server and the scheduled scripts share one production node_modules from
# `npm ci --omit=dev`, pinned by the lockfile. Next's standalone output was
# considered and rejected: its traced bundle drops the packages the scripts
# import directly (postgres.js, the Anthropic SDK and its dependencies), and
# copying them back in by hand is exactly the kind of fix that breaks on the
# next upgrade. The image is larger; it is also boring, which is the point.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# `--network=none` is a guard, not an optimisation: the fonts are committed and
# nothing else should be fetched at build time. If a future change does fetch,
# it fails here, in a build anyone can run, rather than on the deploy server.
RUN --network=none npm run build

FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PHOTOS_DIR=/data/photos

RUN addgroup -S wardrobe && adduser -S wardrobe -G wardrobe \
  && mkdir -p /data/photos && chown -R wardrobe:wardrobe /data

COPY --from=prod-deps --chown=wardrobe:wardrobe /app/node_modules ./node_modules
COPY --from=builder --chown=wardrobe:wardrobe /app/.next ./.next
COPY --chown=wardrobe:wardrobe package.json next.config.ts ./
# The app icons. Nothing imports them, only the manifest names them, so a
# missing copy would not fail anything: the app would just install with no icon.
COPY --chown=wardrobe:wardrobe public ./public
# The migration runner and the jobs ship with the image: migrations run on
# boot (see CMD), the rest run as Coolify scheduled tasks inside this image.
COPY --chown=wardrobe:wardrobe db ./db
COPY --chown=wardrobe:wardrobe scripts ./scripts
COPY --chown=wardrobe:wardrobe src ./src
# The retailer list the finder seeds from.
COPY --chown=wardrobe:wardrobe data/retailers.json ./data/retailers.json

# Photos live in R2 (the R2_* settings). PHOTOS_DIR is only where the old
# /data volume is read from by `npm run photos:move`, and where photos would
# go without R2, which /api/health reports as a failure in production.

USER wardrobe
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply pending migrations, bring the shop list up to date (idempotent, and
# it never undoes a switch made on /you/finder), then serve. Coolify provides DATABASE_URL,
# ANTHROPIC_API_KEY, OPENAI_API_KEY, APP_PASSWORD and the four R2_* settings. `&&` means a failed
# migration stops the container from serving at all, which is the honest
# outcome.
CMD ["sh", "-c", "node scripts/migrate.ts && node scripts/seed-retailers.ts && ./node_modules/.bin/next start"]
