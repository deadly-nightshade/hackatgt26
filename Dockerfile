# Node LTS + system ffmpeg (FFMPEG_PATH) for VPS deploys. Vercel doesn't use this.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# ffmpeg-static's download isn't needed here (system ffmpeg is used).
RUN npm ci --ignore-scripts

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    FFMPEG_PATH=/usr/bin/ffmpeg
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Mock-mode canned responses are read from disk at runtime.
COPY --from=build /app/fixtures ./fixtures
RUN mkdir -p data && chown -R node:node data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
