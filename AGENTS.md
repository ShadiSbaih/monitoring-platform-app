# AGENTS.md — Autonomous AI Engineering Guide for 1 Minute Logs (OML)

## 1. Mission & Role Definition
You are the Lead Principal Full-Stack & Distributed Systems AI Engineer building **1 Minute Logs (`oneminutelogs` / `OML`)**, a production-grade SaaS application monitoring and log management platform.

Your objective is to execute the specifications in `SPECS_AND_EPICS.md` sequentially, deterministically, and without omitting any architectural, caching, security, or business detail.

---

## 2. Repository Topology & Port Assignments

```text
.
├── apps/
│   ├── landing-page/          # Next.js Marketing + Clerk Auth Portal (Port 3000)
│   └── main-dashboard/        # Next.js SaaS Dashboard Application (Port 3001)
├── services/                  # NestJS Event-Driven Backend + Workers (Port 8080, Prefix: /api/v1)
│   ├── docker-compose.yml     # Redis (6379), ClickHouse (8123/9000), CH-UI (5521), NATS (4222/8222)
│   ├── drizzle.config.ts
│   └── src/
│       ├── clickhouse/        # client.ts, schema.ts
│       ├── configs/           # index.ts (Global constants, TTLs, Redis keys, Plan defaults)
│       ├── database/          # database.module.ts, client.ts, schema.ts
│       ├── filters/           # body-parser-exception.filter.ts
│       ├── guards/            # auth.guard.ts, usage.guard.ts
│       ├── infra/             # cache.module.ts, redis.module.ts, start-workers.ts
│       │   └── nats/          # index.ts, init-stream.ts, producer.ts, consumer.ts, alert-consumer.ts
│       ├── modules/
│       │   ├── api-key/       # api-key.module.ts, api-key.controller.ts, api-key.service.ts
│       │   ├── logs/          # logs.module.ts, logs.controller.ts, logs.service.ts
│       │   ├── billing/       # billing.module.ts, billing.controller.ts, billing.service.ts
│       │   └── alert/         # alert.module.ts, alert.controller.ts, alert.service.ts
│       ├── schedulers/        # usage-db-sync.ts
│       ├── sse/               # sse-registry.ts
│       ├── utils/             # api-key-verifier.ts, key-digest.ts
│       ├── app.module.ts
│       └── main.ts
└── sdks/
    └── oneminutelogs-next/    # @oneminutelogs/next TypeScript NPM Package
        ├── package.json
        ├── tsconfig.json
        └── src/
            ├── configs/index.ts
            ├── core/index.ts
            ├── types/         # index.ts, log.ts, metrics.ts, security.ts, track.ts
            ├── utils/         # index.ts (OMLTransport), get-logs.ts, get-stream.ts
            └── index.ts
```

---

## 3. Non-Negotiable Architectural Rules & Guardrails

### Rule 1: Strict Event-Driven Ingestion (Never Block the HTTP Thread)
- `POST /api/v1/logs/send` **MUST NEVER** insert directly into ClickHouse or PostgreSQL, nor evaluate alerts synchronously.
- It must only validate via `AuthGuard` and `UsageGuard`, enforce the per-plan batch size limit, and publish the batch to NATS JetStream subject `logs.ingest` via `publishLogBatch`.
- Alert evaluation **MUST NEVER** use a polling cron job. The `logs.ingest` consumer (`consumer.ts`) must publish transformed logs directly to NATS subject `logs.alert.evaluate`, which is consumed asynchronously by `alert-consumer.ts`.

### Rule 2: Multi-Tier Caching Hierarchy & Database Protection
1. **API Key Validation (`AuthGuard`):**
   - L1: In-memory `LRU_CACHE` (5-minute soft TTL).
   - L2: Redis Hash `oml:api_key:v1:{keyId}` (10-minute hard TTL). Stores HMAC-SHA256 digest (`REDIS_KEY_SECRET`), **never** the plaintext key.
   - L3: PostgreSQL `api_key` table + `argon2.verify()`.
   - **Negative Caching:** If a request has a valid UUID `keyId` in PostgreSQL but fails Argon2 verification, write `invalid: "1"` to Redis `oml:api_key:v1:{keyId}` with a 10-minute TTL to block brute-force attacks at L2.
2. **Plan & Usage Resolution (`UsageGuard`):**
   - `UsageGuard` is strictly for **checking** eligibility (`true`/`false`), **never** for incrementing usage counts.
   - **Free Plan Optimization:** Do **NOT** insert a row into the PostgreSQL `plan` table for `free` users. Absence of a record in `plan` resolves to `PlanTier.FREE`.
   - First-time log senders (including free users) get a single initial row created in the `usage` (`uses`) table (`events_used: 0, events_limit: planDefaults.eventsLimit`) with `.onConflictDoNothing()`.
3. **Usage Accumulation & Sync:**
   - The NATS logs consumer increments `events_used` in Redis (`HINCRBY oml:usage:v1:{userId} events_used {len}`) and adds `userId` to the Redis Set `oml:usage:dirty:v1`.
   - `UsageDbSync` (`@Cron('*/5 * * * *')`) atomically renames `oml:usage:dirty:v1` to `oml:usage:dirty:v1:processing:{timestamp}`, syncs each dirty user's Redis hash to PostgreSQL `usage`, and deletes the processing key.
4. **Alerts Caching:**
   - User alert rules are cached in Redis under `oml:alerts:{userId}` **without a TTL** (persistent in RAM).
   - `alert-consumer.ts` reads **only** from Redis (`oml:alerts:{userId}`). If the key is absent, it skips evaluation—it must **never** query PostgreSQL on every log batch.
   - Whenever an alert is created or deleted via `AlertService`, invalidate `oml:alerts:{userId}` (`redis.del`) so the dashboard's immediate `listAlerts` call repopulates Redis.

### Rule 3: Critical Bug Prevention Checklist (Learned from Production Debugging)
Always enforce these exact implementations to avoid regressions encountered during development:
1. **API Key Single-Key Revocation (`api-key.service.ts`):**
   - When revoking an API key in `deleteApiKey(userId, keyId)`, the Drizzle `.where()` clause **MUST** filter by both `user_id` AND `id`:
     ```ts
     .where(and(eq(apiKey.user_id, userId), eq(apiKey.id, keyId)))
     ```
     Omitting `eq(apiKey.id, keyId)` will accidentally revoke every API key belonging to that user!
2. **Redis Key Prefix Consistency:**
   - Always use `oml:` (never legacy `vmx:`) for all Redis keys (`oml:api_key:...`, `oml:usage:...`, `oml:plan:...`, `oml:alerts:...`).
3. **Neon Serverless WebSocket Constructor (`database.module.ts` & `database/client.ts`):**
   - Always configure `neonConfig.webSocketConstructor = ws` before instantiating `new Pool({ connectionString })`, otherwise Neon Pool connections will fail with HTTP 500 in Node.js.
4. **NATS Subject Naming Consistency (`producer.ts` & `init-stream.ts`):**
   - The ingestion subject must be exactly `logs.ingest` (plural `logs`, not `log.ingest`), and the alert subject must be `logs.alert.evaluate`.
   - `initNatsStream()` must check existing stream subjects and update the stream if `logs.alert.evaluate` is missing.
5. **ClickHouse Table Ordering & Partitioning (`clickhouse/schema.ts`):**
   - Always run `CREATE DATABASE IF NOT EXISTS logs` before `CREATE TABLE IF NOT EXISTS logs.events`.
   - Use monthly partitions `PARTITION BY toYYYYMM(timestamp)` and order by timestamp first: `ORDER BY (timestamp, key_id)`.
6. **Synchronous `parseFilters` in `LogsService` (`logs.service.ts`):**
   - `private parseFilters(queryObj: any)` **MUST NOT** be marked `async` if called synchronously (`const parsed = this.parseFilters(req.query)`), otherwise `parsed` will be a `Promise` object and queries will hang indefinitely.
   - In `LogsController`, `getLogs(@Req() req: any)` **MUST NOT** inject `@Res() res: Response`, because injecting `@Res()` puts NestJS into manual response mode and causes `GET /api/v1/logs` to hang forever.
7. **Raw Body Parsing for Webhooks (`main.ts`):**
   - Initialize NestJS with `NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })`. Do not disable the body parser globally without re-enabling JSON + `rawBody: true`, or Stripe webhooks (`req.rawBody`) and JSON POST endpoints will fail with HTTP 400.
8. **Drizzle `.returning()` Typo Prevention (`alert.service.ts`):**
   - Ensure `this.db.insert(alerts).values(...).returning()` is used when creating an alert.
9. **Complete Operator Switch in `matchCondition` (`alert-consumer.ts`):**
   - Ensure `matchCondition(log, condition)` maps ClickHouse numeric importance (`4 -> 'critical'`, `3 -> 'high'`, `2 -> 'medium'`, `1 -> 'low'`) and includes the `switch (condition.operator)` block handling `'equals'` and `'not_equals'`.
10. **SDK `tsconfig.json` & Relative Imports (`sdks/oneminutelogs-next`):**
    - Because the SDK uses `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`, all relative imports inside `sdks/oneminutelogs-next/src/` must use `.js` extensions (e.g., `import { OMLTransport } from '../utils/index.js'`), and `include` in `tsconfig.json` must be `["src/**/*"]`.

---

## 4. Environment Variables Reference

### 4.1 `services/.env`
```env
PORT=8080
DATABASE_URL=postgresql://<user>:<pass>@<neon-host>/<dbname>?sslmode=require

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=oneminutelogs
REDIS_DB=0
REDIS_KEY_SECRET=<32-byte-hex-from-openssl-rand-hex-32>

# ClickHouse
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DB=logs

# NATS
NATS_URL=nats://localhost:4222

# Clerk Auth
CLERK_SECRET_KEY=sk_test_...

# Stripe Billing (Test Mode)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_BUSINESS_PRICE_ID=price_...

# Webhook Signing & Frontend URL
WEBHOOK_SIGNING_SECRET=<32-byte-hex-from-openssl-rand-hex-32>
APP_URL=http://localhost:3001
```

### 4.2 `apps/main-dashboard/.env`
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_SERVER_URI=http://localhost:8080/api/v1
ONEMINUTELOGS_API_KEY=oml_<keyId>_<secret>
```

### 4.3 `apps/landing-page/.env`
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

---

## 5. Step-by-Step Execution Plan for the AI Agent

Execute the project in the following 8 sequential phases. After each phase, run the verification commands before proceeding to the next phase.

### Phase 1: Infrastructure & Database Foundation
1. Create `services/docker-compose.yml` with `redis`, `clickhouse`, `ch-ui`, and `nats`. Run `docker compose up -d`.
2. Scaffold `services/` NestJS application, install dependencies (`drizzle-orm`, `@neondatabase/serverless`, `ws`, `ioredis`, `lru-cache`, `argon2`, `nats`, `@clickhouse/client`, `stripe`, `@clerk/backend`, `@nestjs/config`, `@nestjs/schedule`, `class-validator`, `class-transformer`).
3. Create `services/src/configs/index.ts` containing all shared constants, enums (`PlanTier`), `PLAN_DEFAULTS`, `normalizePlanTier`, and Redis key builders.
4. Create `services/src/database/schema.ts` with all 5 tables (`api_key`, `usage`, `plan`, `payment_invoices`, `alerts`).
5. Create `services/src/database/database.module.ts` and `services/src/database/client.ts`.
6. Run `npm run db:generate && npm run db:push` to provision PostgreSQL tables.
7. Create `services/src/infra/cache.module.ts` and `services/src/infra/redis.module.ts`.

### Phase 2: AuthGuard & API Key Management
1. Implement `services/src/utils/api-key-verifier.ts` (`extractKeyId`) and `services/src/utils/key-digest.ts` (`digest`).
2. Implement `services/src/guards/auth.guard.ts` supporting both `x-api-key` (L1 LRU -> L2 Redis -> L3 Postgres + Argon2id + 60s debounced `last_used` tracking) and Clerk `Bearer` JWT verification.
3. Implement `services/src/modules/api-key/` (`api-key.service.ts`, `api-key.controller.ts`, `api-key.module.ts`).
4. Set up `QueryProvider` in `apps/main-dashboard` and wire up `apps/main-dashboard/app/api-keys/page.tsx`.
5. **Verify:** Generate an API key in the dashboard, verify it appears in the table, and test revoking a key.

### Phase 3: `@oneminutelogs/next` NPM SDK
1. Create `sdks/oneminutelogs-next/package.json` and `tsconfig.json`.
2. Implement all types in `src/types/` (`index.ts`, `log.ts`, `metrics.ts`, `security.ts`, `track.ts`).
3. Implement `OMLTransport` in `src/utils/index.ts` (2s batch buffer, `SIGINT`/`SIGTERM`/`beforeExit` flush, `get`, `stream`, `verifyWebhook`).
4. Implement React client hooks `src/utils/get-logs.ts` and `src/utils/get-stream.ts` (5,000 log cap).
5. Implement `createLogger` in `src/core/index.ts` and barrel exports in `src/index.ts`.
6. **Verify:** Run `npm run build` and `npm link` inside `sdks/oneminutelogs-next`, then link inside `apps/main-dashboard`.

### Phase 4: ClickHouse, NATS JetStream & Log Ingestion/Query Pipeline
1. Implement `services/src/clickhouse/client.ts` and `services/src/clickhouse/schema.ts` (`createLogsTable`).
2. Implement `services/src/sse/sse-registry.ts` (`addClient`, `broadcastLogs` with 50-log chunking).
3. Implement `services/src/infra/nats/index.ts`, `init-stream.ts`, `producer.ts`, and `consumer.ts`.
4. Implement `services/src/modules/logs/` (`logs.service.ts`, `logs.controller.ts`, `logs.module.ts`) including `sendLogs`, `getLogs` (with `parseFilters`, `queryCooldown`, `resultCache`), `startSse`, and `streamMetricsSse`.
5. Create Next.js proxy route `apps/main-dashboard/app/api/oneminutelogs/[...types]/route.ts` and test route `apps/main-dashboard/app/api/test/route.ts`.
6. Wire up `apps/main-dashboard/app/live-logs/page.tsx` (`getStream`) and `apps/main-dashboard/app/queries/page.tsx` (`getLogs`).
7. **Verify:** Hit `http://localhost:3001/api/test`, verify logs appear immediately in `/live-logs` without page reload, and run filter queries (`type:error`) in `/queries`.

### Phase 5: UsageGuard & 5-Minute Usage Sync Scheduler
1. Implement `services/src/guards/usage.guard.ts` (`isHardLocked`, `resolvePlan`, `getOrCreateUsage`, quota check).
2. Attach `UsageGuard` to `POST /api/v1/logs/send`.
3. Implement `services/src/schedulers/usage-db-sync.ts` (`@Cron('*/5 * * * *')`) and register `ScheduleModule.forRoot()` and `UsageDbSync` in `AppModule`.
4. **Verify:** Send logs via `/api/test`, verify `oml:usage:v1:{userId}` increments in Redis and `oml:usage:dirty:v1` tracks the `userId`, and confirm PostgreSQL `usage` table updates after the cron cycle.

### Phase 6: Stripe Billing, Subscriptions, Webhooks & Invoices
1. Implement `services/src/modules/billing/` (`billing.service.ts`, `billing.controller.ts`, `billing.module.ts`) with `getCurrentPlan`, `createBillingSession`, `createPortalSession`, `getInvoices`, and `handleStripeWebhook`.
2. Ensure `main.ts` has `rawBody: true` and `BodyParserExceptionFilter` registered.
3. Wire up `apps/main-dashboard/app/settings/page.tsx` (4-column pricing cards, checkout mutation, portal mutation, invoices table with PDF download) and `apps/main-dashboard/components/layout/dashboard-sidebar.tsx` (dynamic plan badge).
4. **Verify:** Run `stripe listen --forward-to localhost:8080/api/v1/billing/webhook`, complete a test checkout (`4242...`), verify HTTP 201 webhook response, confirm UI updates to `Pro`, and download the invoice PDF.

### Phase 7: Event-Driven Smart Alerting Engine & Webhook Verification
1. Implement `services/src/modules/alert/` (`alert.service.ts`, `alert.controller.ts`, `alert.module.ts`) with plan quota enforcement (0 / 5 / 12 / 20), payload validation, Redis cache invalidation, and `verifyWebhook` (60s replay protection + `crypto.timingSafeEqual`).
2. Implement `services/src/infra/nats/alert-consumer.ts` (`startAlertConsumer`, `matchCondition`, Redis windowed counter, cooldown key, and HMAC-SHA256 signed `callWebhook` with 5s timeout).
3. Register `startAlertConsumer()` in `services/src/infra/start-workers.ts`.
4. Wire up `apps/main-dashboard/app/alerts/page.tsx` (stats bar, alert list, 4-step rule builder modal) and ensure `<Toaster />` is mounted in `apps/main-dashboard/app/layout.tsx`.
5. **Verify:** Create an alert for `app_name = oneminutelogs`, `type = error`, `importance = critical` (threshold: 5 in 5m), trigger 5 critical error logs via `/api/test`, and verify the signed webhook POST is received and `last_triggered` updates.

### Phase 8: Dashboard Overview & Live System Telemetry
1. Create `apps/main-dashboard/app/api/live-metrics/route.ts` and `apps/main-dashboard/app/api/logs/get-logs/route.ts`.
2. Update `apps/main-dashboard/app/page.tsx` to fetch 24h logs, active/recent alerts, and subscribe to `/api/live-metrics` via `EventSource`.
3. **Verify:** Confirm the main dashboard overview displays live 24h log counts, error rates, ingest rate, average latency (ms), queue backlog, top 16 activities, and top 4 recent alerts.