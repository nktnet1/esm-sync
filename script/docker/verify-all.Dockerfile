ARG NODE_MAJOR=24
FROM node:${NODE_MAJOR}-bookworm
ARG PNPM_VERSION=12.15.0
WORKDIR /work
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global --ignore-scripts --no-audit --no-fund "pnpm@${PNPM_VERSION}" \
    && pnpm install --no-frozen-lockfile --ignore-scripts
COPY . .
RUN git init --quiet && git config core.autocrlf false
ENV CI=true
CMD ["node", "script/src/esm/verify-all.ts", "--worker", "--reports", "/reports"]
