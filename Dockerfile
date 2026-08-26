# Debian rather than Alpine: @node-rs/argon2 ships prebuilt native bindings and
# glibc avoids the musl variant selection going wrong at runtime.
#
# Pinned by digest, with the tag kept in the reference so it stays readable.
# `node:24-bookworm-slim` is a mutable pointer in somebody else's registry,
# exactly like `actions/checkout@v5` was before it was pinned — and this one
# supplies the interpreter that runs the whole application. The tag moves on
# every Debian security refresh, so this line has to be maintained rather than
# admired: Renovate's `docker:pinDigests` keeps it current, which is the trade
# pinning makes. Written as a literal reference rather than through an ARG for
# the same reason: that is the form Renovate rewrites.
FROM node:24-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Everything pnpm needs, split out of `base` so that `runner` can inherit the
# bare interpreter. The runtime calls `node server.js` and never a package
# manager, and one stage between them is cheaper than repeating the digest
# above on a second FROM line — two copies of a pinned digest are two things
# that have to be bumped together.
FROM base AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Standalone tracing resolves real paths, and pnpm's symlinked layout makes it
# miss transitive dependencies (@swc/helpers among them), which then blows up
# at container start. A flat install keeps the traced output complete.
#
# Set as an environment variable rather than written into pnpm-workspace.yaml,
# because the builder's `COPY . .` restores the repo's own copy of that file and
# `pnpm run` re-links node_modules whenever the on-disk layout disagrees with the
# configured linker — an appended line has to be re-appended after the copy, a
# variable does not. pnpm 11 reads `pnpm_config_*`, not the npm-era prefix.
ENV pnpm_config_node_linker=hoisted
# PNPM_HOME moves the store off pnpm's default location, so name it rather than
# infer it: the cache mount in the deps stage has to target the same directory.
ENV pnpm_config_store_dir=/pnpm/store
RUN corepack enable

FROM toolchain AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The store is a cache mount, so it outlives the build without entering a layer.
# The CI builder is a persistent one (`keep-state: true` in build.yml), which is
# what makes that worth anything. Locked because the self-hosted runner runs
# several jobs against one daemon.
RUN --mount=type=cache,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

# hoisted keeps a .pnpm directory around, so the real signal is whether the
# top-level packages are symlinks. If they are, tracing will silently drop
# transitive deps and the image only fails at container start.
RUN test ! -L node_modules/next \
  || { echo "nodeLinker: hoisted 未生效，node_modules 仍为符号链接布局" >&2; exit 1; }

FROM toolchain AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The database client is created on first use rather than at import, so
# collecting page data — which loads every route module, and those pull in
# `lib/db` through the auth graph — does not need a connection string. Auth.js
# similarly reads AUTH_SECRET when it signs, not when the module is evaluated.
# Neither belongs in this stage: they are runtime, and `instrumentation.ts`
# refuses a boot that lacks them.
#
# `.next/cache` is a cache mount for the same reason the pnpm store is, with one
# consequence worth naming: being a mount, it is not part of the build output
# either, so a fetch cache warmed during the build would not reach the image.
# Nothing here fetches at build time, so that costs nothing.
RUN --mount=type=cache,target=/app/.next/cache \
    pnpm build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Which commit this image was built from, recorded on every submission it
# judges. The CI already tags the image `sha-<commit>`, but a tag is outside
# the container: without this the process cannot say what it is running, and
# `submissions.release_sha` would have nothing to write. Empty on a local
# `docker build`, which is honest — that image did not come from a commit.
#
# Deliberately baked into the image metadata: it is not a secret, and
# `docker inspect` being able to answer "what is this" is the point.
ARG FOI_RELEASE_SHA=""
ENV FOI_RELEASE_SHA=$FOI_RELEASE_SHA

# `source` is what makes GHCR attach the package to this repository instead of
# leaving it unattributed, and `revision` puts the commit where tooling looks
# for it rather than only in an application-specific variable. A fork pushing
# to its own namespace wants to change the URL; leaving it points the fork's
# package at the upstream repo, which is wrong but harmless.
LABEL org.opencontainers.image.source="https://github.com/FDU-SC/foi-internal" \
      org.opencontainers.image.revision="$FOI_RELEASE_SHA" \
      org.opencontainers.image.licenses="MIT"

RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin foi

# standalone carries its own minimal node_modules; static and public are not
# copied into it automatically.
COPY --from=builder --chown=foi:nodejs /app/.next/standalone ./
COPY --from=builder --chown=foi:nodejs /app/.next/static ./.next/static

# The incremental cache is written under `.next` at runtime — every
# `revalidatePath` in the admin and submission actions goes through it — so the
# directory has to belong to the user the server runs as. It does today, but not
# because anything here says so: a directory BuildKit creates implicitly as a
# COPY parent is root-owned whatever --chown says, and `.next` escapes that only
# because the standalone output carries its own `.next` and is therefore an
# explicit entry in the copy above. That is a property of Next's output layout,
# so assert it rather than trust it — and rather than `chown -R`, which would
# rewrite the whole tree into a second copy of it. Getting this wrong surfaces
# at the first revalidation, not at boot.
RUN test "$(stat -c '%U' .next)" = foi \
  || { echo ".next 不属于 foi，运行时写不了增量缓存" >&2; exit 1; }

COPY --from=builder --chown=foi:nodejs /app/public ./public
# Applied on boot by instrumentation.ts.
COPY --from=builder --chown=foi:nodejs /app/drizzle ./drizzle
# Operational entry point. A fresh deployment has no accounts at all and no
# way to make one through the UI that does not require an administrator, so the
# first one is created from inside the container; passwords never ship in an
# image either way.
COPY --from=builder --chown=foi:nodejs /app/scripts/create-account.cjs ./scripts/
# The account tool hashes with the same parameters `verifyPassword` expects.
# The application imports this file too, but as part of a bundled chunk rather
# than as a traced file on disk, so the tool needs its own copy.
COPY --from=builder --chown=foi:nodejs /app/lib/auth/argon2-options.cjs ./lib/auth/

USER foi
EXPOSE 3000

# Reads PORT out of the process environment rather than repeating 3000, so that
# overriding the port cannot leave the health check probing the old one — and it
# reads it the same way the server does, rather than through a shell expansion.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
