FROM node:24-slim AS build

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run prisma:generate && npm run build

FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_URL=file:/app/data/dev.db
ENV UPLOAD_DIR=/app/uploads

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

RUN mkdir -p /app/data /app/uploads

EXPOSE 4000

CMD ["sh", "-c", "npm run db:init && npm start"]
