# The HR Genie Teams bot.
#
# Two stages so the image carries the compiled output and the runtime dependencies,
# and not TypeScript or the sources. Nothing here is native, so there is no build
# toolchain to install and no platform-specific step.
#
#   docker build -t hrgenie-bot .
#   docker run -p 3978:3978 --env-file .env.prod -v hrgenie-data:/var/lib/hrgenie hrgenie-bot

FROM node:20-slim AS build
WORKDIR /app

# Dependencies first, so a source change does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------- the image

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# The card artwork is served by this service — see /icons in src/index.ts.
COPY assets ./assets

# Where conversation references are kept. Mount a volume here, or point
# REFERENCES_FILE somewhere else that survives a redeploy; losing it means nobody
# receives a ticket update until they next open the chat.
RUN mkdir -p /var/lib/hrgenie && chown node:node /var/lib/hrgenie
ENV REFERENCES_FILE=/var/lib/hrgenie/references.json
VOLUME ["/var/lib/hrgenie"]

# Not root. The process needs nothing privileged.
USER node

EXPOSE 3978

# The same endpoint a load balancer should watch. No auth, no side effects.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3978)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
