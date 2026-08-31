FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# --- deps: install dependencies (hoisted for standalone tracing) ---
FROM base AS deps
RUN corepack enable
ENV pnpm_config_node_linker=hoisted
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- builder: compile the Next.js app ---
FROM base AS builder
RUN corepack enable
ENV pnpm_config_node_linker=hoisted
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG FOI_RELEASE_SHA=""
ENV FOI_RELEASE_SHA=$FOI_RELEASE_SHA

RUN --mount=type=cache,target=/app/.next/cache \
    pnpm build

# --- runner: minimal production image ---
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ARG FOI_RELEASE_SHA=""
ENV FOI_RELEASE_SHA=$FOI_RELEASE_SHA

# 平台代码的规范位置。下游部署换掉的是 content/，源仍然是这里。
LABEL org.opencontainers.image.source="https://github.com/FDU-SC/foi" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.revision="$FOI_RELEASE_SHA"

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs foi

COPY --from=builder --chown=foi:nodejs /app/.next/standalone ./
COPY --from=builder --chown=foi:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=foi:nodejs /app/public ./public
COPY --from=builder --chown=foi:nodejs /app/drizzle ./drizzle
# A deployment's own migrations, if it wrote any. The bracket glob matches
# nothing when drizzle.local/ is absent; package.json rides along only so the
# COPY still has a source and does not fail on an empty match.
COPY --from=builder --chown=foi:nodejs /app/package.json /app/drizzle.loca[l] ./drizzle.local/
COPY --from=builder --chown=foi:nodejs /app/scripts ./scripts
COPY --from=builder --chown=foi:nodejs /app/lib/accounts/argon2-options.cjs ./lib/accounts/

USER foi
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
