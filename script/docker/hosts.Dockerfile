FROM node:24.21.0-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 libnss3 libxss1 libxtst6 libasound2 libx11-xcb1 \
    libdrm2 libgbm1 libxshmfence1 xvfb xauth dbus-x11 fonts-liberation g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# Runtime downloads have their own cached layer. Reproduction sources and
# get-port are small, licensed fixtures committed to this repository.
COPY script/src/esm/host-runtimes.ts script/src/esm/host-runtimes.ts
COPY script/src/esm/package.json script/src/esm/package.json
RUN node script/src/esm/host-runtimes.ts

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global --ignore-scripts --no-audit --no-fund pnpm@12.15.0 \
    && pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN node script/src/esm/build-host-addons.ts
# The existing build prepares Acorn source here. Keep it between source edits
# without shipping downloaded vendor inputs or host caches in the build context.
RUN --mount=type=cache,target=/work/src/vendor,sharing=locked \
    node script/src/esm/cli.ts build --prod

ENV NODE_ENV=production ESM_ENV=production
CMD ["node", "script/src/esm/verify-hosts-container.ts"]
