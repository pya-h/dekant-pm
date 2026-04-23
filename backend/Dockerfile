FROM node:20-slim AS builder

ENV NODE_ENV=development
WORKDIR /app
COPY package.json package-lock.json* yarn.lock* ./
RUN if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    else npm install; fi

COPY . .
RUN npm run build

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/idl ./idl

ENV NODE_ENV=production
EXPOSE 4000

CMD ["sh", "-c", "node -e \"require('./dist/data-source').default.initialize().then(ds => ds.runMigrations().then(() => ds.destroy()))\" && node dist/main"]
