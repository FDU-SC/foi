FROM node:24-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

ENV pnpm_config_node_linker=hoisted

ENV pnpm_config_store_dir=/pnpm/store
RUN corepack enable

FROM toolchain AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

RUN test ! -L node_modules/next \
  || { echo "nodeLinker: hoisted 未生效，node_modules 仍为符号链接布局" >&2; exit 1; }

FROM toolchain AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN --mount=type=cache,target=/app/.next/cache \
    pnpm build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ARG FOI_RELEASE_SHA=""
ENV FOI_RELEASE_SHA=$FOI_RELEASE_SHA

LABEL org.opencontainers.image.source="https://github.com/FDU-SC/foi-internal" \
      org.opencontainers.image.revision="$FOI_RELEASE_SHA" \
      org.opencontainers.image.licenses="MIT"

RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin foi

COPY --from=builder --chown=foi:nodejs /app/.next/standalone ./
COPY --from=builder --chown=foi:nodejs /app/.next/static ./.next/static

RUN test "$(stat -c '%U' .next)" = foi \
  || { echo ".next 不属于 foi，运行时写不了增量缓存" >&2; exit 1; }

COPY --from=builder --chown=foi:nodejs /app/public ./public

COPY --from=builder --chown=foi:nodejs /app/drizzle ./drizzle

COPY --from=builder --chown=foi:nodejs /app/scripts/create-account.cjs ./scripts/

COPY --from=builder --chown=foi:nodejs /app/lib/accounts/argon2-options.cjs ./lib/accounts/

USER foi
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
