# Stage 1: build the frontend
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# Stage 2: the server, on the image that already carries Chromium
FROM mcr.microsoft.com/playwright:v1.63.0-noble
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 3001
HEALTHCHECK --interval=60s --timeout=10s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
