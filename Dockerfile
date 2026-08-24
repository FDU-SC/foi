# Debian rather than Alpine: @node-rs/argon2 ships prebuilt native bindings and
# glibc avoids the musl variant selection going wrong at runtime.
#
# Pinned by digest, with the tag kept in the reference so it stays readable.
# `node:22-bookworm-slim` is a mutable pointer in somebody else's registry,
# exactly like `actions/checkout@v5` was before it was pinned — and this one
# supplies the interpreter that runs the whole application. The tag moves on
# every Debian security refresh, so this line has to be maintained rather than
# admired: Renovate's `docker:pinDigests` keeps it current, which is the trade
# pinning makes.
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS base
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

# Which commit this image was built from, recorded on every submission it
# judges. The CI already tags the image `sha-<commit>`, but a tag is outside
# the container: without this the process cannot say what it is running, and
# `submissions.release_sha` would have nothing to write. Empty on a local
# `docker build`, which is honest — that image did not come from a commit.
#
# Unlike the build-stage placeholders above, this one is deliberately baked
# into the image metadata: it is not a secret, and `docker inspect` being able
# to answer "what is this" is the point.
ARG FOI_RELEASE_SHA=""
ENV FOI_RELEASE_SHA=$FOI_RELEASE_SHA

RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin foi

# standalone carries its own minimal node_modules; static and public are not
# copied into it automatically.
COPY --from=builder --chown=foi:nodejs /app/.next/standalone ./
COPY --from=builder --chown=foi:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=foi:nodejs /app/public ./public
# Applied on boot by instrumentation.ts.
COPY --from=builder --chown=foi:nodejs /app/drizzle ./drizzle
# Operational entry points. A fresh deployment has no accounts at all and no
# way to make one through the UI that does not require an administrator, so the
# first one is created from inside the container; passwords never ship in an
# image either way.
COPY --from=builder --chown=foi:nodejs /app/scripts/create-account.cjs ./scripts/
COPY --from=builder --chown=foi:nodejs /app/scripts/set-password.cjs ./scripts/

USER foi
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
