# Bleach Fight relay server
# Build context: the `server/` directory (it is a standalone npm package).
#   docker build -t bleach-fight-server ./server
#   docker run -e PORT=8787 -p 8787:8787 bleach-fight-server

# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies first so edits to the source do not bust the layer cache.
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json index.ts ./
RUN npm run build

# ---------- runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# Only the production dependency (`ws`) is needed to run the compiled output.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

USER node
EXPOSE 8787

# `$$` escapes the variable so it is expanded by the shell at runtime, not at build time.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:$${PORT:-8787}/health" >/dev/null || exit 1

CMD ["node", "dist/index.js"]
