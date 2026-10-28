# PhuongDong POS — API + admin + POS in one image, Postgres via DATABASE_URL (see docker-compose.yml).
FROM node:24-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.34.9
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# The Prisma client is generated per provider: switch the schema copy to Postgres and generate from it.
RUN node scripts/prisma-provider.mjs \
 && cd apps/api && npx prisma generate --schema prisma/pg/schema.prisma
RUN pnpm build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Create/upgrade tables, seed demo data on an empty database, then serve API + web apps on :3000.
CMD ["sh", "-c", "cd apps/api && npx prisma db push --schema prisma/pg/schema.prisma && npx tsx prisma/seed.ts && npx tsx src/server.ts"]
