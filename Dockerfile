FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src

RUN mkdir -p storage/sites storage/ssl storage/backups storage/db-imports

ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "server.js"]
