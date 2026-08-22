# Debian rather than Alpine: @node-rs/argon2 ships prebuilt native bindings and
# glibc avoids the musl variant selection going wrong at runtime.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Standalone tracing resolves real paths, and pnpm's symlinked layout makes it
# miss transitive dependencies (@swc/helpers among them), which then blows up
# at container start. A flat install keeps the traced output complete.
#
# pnpm 11 reads only auth/registry settings from .npmrc; everything else has to
# go in pnpm-workspace.yaml, hence the append rather than an .npmrc line.
RUN printf '\nnodeLinker: hoisted\n' >> pnpm-workspace.yaml \
  && pnpm install --frozen-lockfile

# hoisted keeps a .pnpm directory around, so the real signal is whether the
# top-level packages are symlinks. If they are, tracing will silently drop
# transitive deps and the image only fails at container start.
RUN test ! -L node_modules/next \
  || { echo "nodeLinker: hoisted 未生效，node_modules 仍为符号链接布局" >&2; exit 1; }

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `COPY . .` restores the repo's own pnpm-workspace.yaml, and `pnpm run`
# re-links node_modules whenever it finds the on-disk layout inconsistent with
# the configured linker. Without repeating the setting here, the flat layout
# from the deps stage is silently rebuilt as symlinks and tracing breaks again.
RUN printf '\nnodeLinker: hoisted\n' >> pnpm-workspace.yaml
# Next.js loads every route module while collecting page data, which pulls in
# the database client and the auth config. Both only read these at request
# time and pg connects lazily, so placeholders are enough — nothing is
# contacted during the build.
#
# Passed inline rather than via ENV so they stay out of the image metadata.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    AUTH_SECRET=placeholder-only-for-build \
    pnpm build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin foi

# standalone carries its own minimal node_modules; static and public are not
# copied into it automatically.
COPY --from=builder --chown=foi:nodejs /app/.next/standalone ./
COPY --from=builder --chown=foi:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=foi:nodejs /app/public ./public
# Applied on boot by instrumentation.ts.
COPY --from=builder --chown=foi:nodejs /app/drizzle ./drizzle

USER foi
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
