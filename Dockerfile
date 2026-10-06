# ── Étape 1 : compilation du front (Vite) et du serveur (esbuild) ──
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# ── Étape 2 : image d'exécution légère ──
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js
# Render fournit la variable PORT (10000 par défaut) ; le serveur l'utilise.
EXPOSE 10000
CMD ["node", "server.js"]
