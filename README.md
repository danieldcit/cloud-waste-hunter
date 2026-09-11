# Cloud Waste Hunter

Cloud Waste Hunter is a read-only dashboard that connects to a customer's Azure
tenant via Azure Lighthouse, inventories resources through Azure Resource
Graph, and flags likely waste (orphaned disks, unassociated public IPs, old
snapshots, idle VPN gateways) along with an estimated monthly cost, so
customers can see what to clean up without granting write access to their
subscriptions.

## Prerequisites

- Node.js >= 20 (see `.nvmrc`)
- Docker (for local Postgres)

## Setup

1. Start Postgres:
   ```
   docker compose up -d
   ```
2. Create the test database (the dev database is created automatically by
   the `postgres` image on first start):
   ```
   docker compose exec postgres psql -U cwh -d cloud_waste_hunter -c "CREATE DATABASE cloud_waste_hunter_test;"
   ```
3. Copy `.env.example` to `.env` and `.env.test`, filling in the values for
   each environment (point `.env.test`'s `DATABASE_URL` at the
   `cloud_waste_hunter_test` database created above).
4. Install dependencies and generate the Prisma client (runs automatically
   via `postinstall`):
   ```
   npm install
   ```
5. Apply migrations to the dev database:
   ```
   npx prisma migrate dev
   ```
6. Apply migrations to the test database:
   ```
   npx dotenv -e .env.test -- npx prisma migrate deploy
   ```

## Scripts

- `npm run dev` — start the Next.js dev server
- `npm test` — run the Vitest suite
- `npm run scanner` — run the Azure inventory/waste scan once from the CLI
- `npm run lint` — run ESLint
