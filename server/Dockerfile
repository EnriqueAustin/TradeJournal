# --- Trade Journal API (Node + Express + better-sqlite3) ---
FROM node:22-bookworm-slim

# Build toolchain so better-sqlite3 can compile from source if no prebuilt
# binary matches the container's arch (removed afterwards to keep the image small).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching. Native modules build here for
# linux — never copy host node_modules (see .dockerignore).
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# SQLite db + screenshots live here; mount a volume to persist across restarts.
RUN mkdir -p /app/data
ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/index.js"]
