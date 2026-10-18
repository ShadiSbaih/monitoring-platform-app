# 1 Minute Logs (OML) — Full-Stack Monitoring SaaS Specifications, Epics & Tickets

## 1. Executive Summary & Business Model

### 1.1 Product Vision
**1 Minute Logs (`oneminutelogs` / `OML`)** is a real-time, high-throughput application monitoring, log management, and smart alerting SaaS platform engineered specifically for early-stage startups, indie hackers, and small engineering teams. Unlike enterprise-heavy observability platforms (e.g., Datadog, New Relic, Sentry, or self-hosted ELK stacks) that require complex schema configurations, cluster tuning, and steep monthly bills, **1 Minute Logs** guarantees a **sub-60-second setup** via a lightweight drop-in SDK.

### 1.2 Core Business Value Proposition
1. **Under 1-Minute Integration:** Install `@oneminutelogs/next`, initialize with an API key, and stream structured logs, metrics, audit trails, and security events immediately.
2. **High-Throughput Event-Driven Architecture:** Capable of ingesting **2,000,000+ logs per minute** using client-side batching, multi-tier authentication caching (0–1ms validation latency), **NATS JetStream** durable work queues, and **ClickHouse** `MergeTree` bulk columnar storage.
3. **Sub-15ms Instant Search & Zero-Latency Live Tail:** Direct worker-to-SSE (Server-Sent Events) broadcasting bypasses database polling for live tails, while ClickHouse `LowCardinality` indexing powers instant historical queries.
4. **Cost-Controlled Multi-Tier SaaS Economics:**
   - Free users do not consume row space in the `plan` PostgreSQL table (implicit Free tier resolution).
   - Redis RAM usage is strictly bounded via LRU policies (`allkeys-lru`), debounced writes, and tiered alert quotas.
   - ClickHouse storage costs are automatically capped via a native `30 DAY DELETE` table-level TTL and monthly disk partitioning (`toYYYYMM`).

### 1.3 Subscription Tiers & Quota Matrix

| Tier (`PlanTier`) | Monthly Price | Monthly Event Quota (`events_limit`) | Max Batch Size / Request | Log Retention | Max Active Alerts | Webhooks & Email Support | Stripe Billing Portal |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Free** (`free`) | $0.00 | 10,000 events | 100 logs | 7 Days | 0 (Disabled) | Excluded | Disabled |
| **Starter** (`starter`)* | $9.99 / mo | 100,000 events | Paid Batch Limit | 30 Days | 5 Alerts | Included | Enabled |
| **Pro** (`pro`) | $24.99 / mo | 500,000 events | Paid Batch Limit | 60 Days | 12 Alerts | Included | Enabled |
| **Business** (`business`) | $49.99 / mo | 1,000,000 events | Paid Batch Limit | 90 Days | 20 Alerts | Included | Enabled |

*\*Note: Starter displays the "POPULAR" badge in the UI only when the user's current plan is `free`.*

---

## 2. System Architecture & Data Flow

```
[Client App / Next.js Backend]
       │
       ▼ (1. @oneminutelogs/next SDK buffers & flushes batch every 2000ms or on SIGINT/SIGTERM/beforeExit)
[POST /api/v1/logs/send]
       │
       ├─► [AuthGuard] ──► L1 Local LRU Cache (5m TTL) ──► L2 Redis Hash (10m TTL) ──► L3 Postgres (Neon) + Argon2id
       │     └─► Debounced (60s NX lock) API Key `last_used_at` tracking in Redis Hash
       │
       ├─► [UsageGuard] ─► Checks Hard Lock (`oml:user:{id}:locked`)
       │     └─► Resolves Plan & Usage via L1 LRU (5m) ──► L2 Redis (6m) ──► L3 Postgres (`plan` & `usage` tables)
       │     └─► Rejects if `events_used >= effectiveUsageLimit` (Read-only check; creates initial `usage` row for 1st-time user)
       │
       ▼ (2. Producer publishes batch with `server_received_at` timestamp)
[NATS JetStream: Stream `OML_LOGS` | Subject `logs.ingest`]
       │
       ▼ (3. Durable Push Consumer `oml_logs_consumer` -> Deliver Subject `oml.logs.worker`)
[Logs Consumer Worker]
       ├─► Calculates Ingest Latency (`now - server_received_at`) ──► Redis List `ingest:latency` (LTRIM 0..59)
       ├─► Transforms payload (maps importance strings to Int32 1..4, stringifies JSON fields, normalizes timestamps)
       ├─► Bulk Inserts into ClickHouse (`logs.events` table, format `JSONEachRow`)
       ├─► Accumulates Usage:
       │     ├─► `HINCRBY oml:usage:v1:{userId} events_used {batchLength}`
       │     ├─► `SADD oml:usage:dirty:v1 {userId}` (Marks user dirty for Cron sync)
       │     └─► Updates in-memory `usageCache` LRU
       ├─► Broadcasts directly to connected SSE clients (`broadcastLogs` in `sse-registry.ts`, chunked by 50)
       ├─► Publishes transformed logs to NATS subject `logs.alert.evaluate`
       ├─► Acknowledges NATS message (`msg.ack()`)
       └─► Updates `ingest:backlog` in Redis (throttled once per 1000ms via JetStream Consumer Info)
             │
             ├──► [Cron Scheduler: `UsageDbSync` (Every 5 Minutes `*/5 * * * *`)]
             │      └─► Atomically renames `oml:usage:dirty:v1` -> `...:processing:{timestamp}`
             │      └─► Reads `SMEMBERS`, fetches Redis `HGETALL oml:usage:v1:{userId}`, updates Postgres `usage` table, deletes processing key.
             │
             └──► [NATS JetStream: Subject `logs.alert.evaluate` -> Consumer `oml_alert_consumer`]
                    └─► Groups logs by `user_id`
                    └─► Fetches persistent alert rules from Redis (`oml:alerts:{userId}`)
                    └─► Evaluates `app_name` and all `conditions` (`equals` / `not_equals`)
                    └─► Increments windowed counter `oml:alert:count:{ruleId}:{bucket}` (TTL = window * 60s)
                    └─► Checks threshold count & cooldown lock `oml:alert:cooldown:{ruleId}`
                    └─► Fires HMAC-SHA256 signed POST webhook (5s AbortController timeout), sets cooldown key, updates Redis & Postgres `last_triggered`.
```

---

## 3. Complete Database & Storage Specifications

### 3.1 PostgreSQL Schema (`services/src/database/schema.ts` — Drizzle ORM)

1. **`api_key` Table:**
   - `id`: `uuid('id').primaryKey()` — Stores the 32-character UUID generated during key creation.
   - `user_id`: `text('user_id').notNull()` — Clerk User ID.
   - `prefix`: `text('prefix').notNull()` — First 18 characters of plaintext key (`oml_...`).
   - `value`: `text('value').notNull()` — Argon2id hash of the full plaintext key.
   - `created_at`: `timestamp('created_at').defaultNow().notNull()`
   - `last_used_at`: `timestamp('last_used_at')`
   - `revoked_at`: `timestamp('revoked_at')` — Soft-delete timestamp (`NULL` = active).

2. **`usage` (`uses`) Table:**
   - `id`: `uuid('id').defaultRandom().primaryKey()`
   - `user_id`: `text('user_id').notNull().unique()`
   - `events_used`: `bigint('events_used', { mode: 'number' }).default(0).notNull()`
   - `events_limit`: `bigint('events_limit', { mode: 'number' }).notNull()`
   - `created_at`: `timestamp('created_at').defaultNow().notNull()`
   - `updated_at`: `timestamp('updated_at').defaultNow().notNull()`

3. **`plan` Table:** *(Free users have NO record in this table)*
   - `id`: `uuid('id').defaultRandom().primaryKey()`
   - `user_id`: `text('user_id').notNull().unique()`
   - `name`: `text('name').notNull()` — Normalized `PlanTier` (`starter`, `pro`, `business`).
   - `stripe_customer_id`: `text('stripe_customer_id')`
   - `stripe_subscription_id`: `text('stripe_subscription_id')`
   - `stripe_price_id`: `text('stripe_price_id')`
   - `created_at`: `timestamp('created_at').defaultNow().notNull()`
   - `updated_at`: `timestamp('updated_at').defaultNow().notNull()`

4. **`payment_invoices` Table:**
   - `id`: `uuid('id').defaultRandom().primaryKey()`
   - `user_id`: `text('user_id').notNull()`
   - `stripe_customer_id`: `text('stripe_customer_id')`
   - `stripe_subscription_id`: `text('stripe_subscription_id')`
   - `stripe_invoice_id`: `text('stripe_invoice_id').notNull().unique()`
   - `status`: `text('status').notNull()`
   - `currency`: `text('currency').notNull()`
   - `amount_due`: `bigint('amount_due', { mode: 'number' }).notNull()`
   - `amount_paid`: `bigint('amount_paid', { mode: 'number' }).notNull()`
   - `hosted_invoice_url`: `text('hosted_invoice_url')`
   - `invoice_pdf`: `text('invoice_pdf')`
   - `period_start`: `timestamp('period_start')`
   - `period_end`: `timestamp('period_end')`
   - `created_at`: `timestamp('created_at').defaultNow().notNull()`
   - `updated_at`: `timestamp('updated_at').defaultNow().notNull()`

5. **`alerts` Table:**
   - `id`: `uuid('id').defaultRandom().primaryKey()`
   - `user_id`: `text('user_id').notNull()`
   - `name`: `text('name').notNull()`
   - `app_name`: `text('app_name').notNull()`
   - `conditions`: `jsonb('conditions').$type<Array<{ field: string; operator: string; value: string }>>().notNull()`
   - `threshold_count`: `integer('threshold_count').notNull()`
   - `threshold_window_minutes`: `integer('threshold_window_minutes').notNull()`
   - `webhook_url`: `text('webhook_url').notNull()`
   - `cooldown_period`: `text('cooldown_period').notNull()`
   - `summary`: `text('summary').notNull()`
   - `status`: `text('status').default('active').notNull()`
   - `last_triggered`: `timestamp('last_triggered')`
   - `created_at`: `timestamp('created_at').defaultNow().notNull()`
   - `updated_at`: `timestamp('updated_at').defaultNow().notNull()`

### 3.2 ClickHouse Schema (`services/src/clickhouse/schema.ts`)

```sql
CREATE DATABASE IF NOT EXISTS logs;

CREATE TABLE IF NOT EXISTS logs.events (
  key_id String,
  user_id String,
  type LowCardinality(String),
  message String,
  app_name LowCardinality(String),
  environment LowCardinality(String),
  importance Nullable(Int32),
  subsystem Nullable(String),
  service Nullable(String),
  operation Nullable(String),
  track Nullable(String),
  security Nullable(String),
  metrics Nullable(String),
  timestamp DateTime DEFAULT now(),
  ingested_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, key_id)
TTL timestamp + INTERVAL 30 DAY DELETE
SETTINGS index_granularity = 8192;
```

---

## 4. Epics & Detailed Engineering Tickets

---

### EPIC 1: Monorepo Foundation, Authentication (Clerk) & Local Infrastructure
**Goal:** Establish the workspace structure (`apps/landing-page`, `apps/main-dashboard`, `services`, `sdks/oneminutelogs-next`), configure Clerk authentication across the frontend apps, and spin up Docker containers for Redis, ClickHouse, ClickHouse UI, and NATS JetStream.

#### Ticket 1.1: Landing Page Clerk Authentication & User Header Integration
- **Component:** `apps/landing-page`
- **Description:** Replace the pre-launch waitlist flow with live Clerk Authentication (`/sign-in` and `/sign-up`) and update the navigation header to reflect authenticated state.
- **Implementation Details:**
  - Install `@clerk/nextjs` and `@clerk/ui`.
  - Configure `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `apps/landing-page/.env`.
  - Wrap root layout in `<ClerkProvider>`.
  - Create `apps/landing-page/app/sign-in/[[...sign-in]]/page.tsx` rendering `<SignIn signUpUrl="/sign-up" />`.
  - Create `apps/landing-page/app/sign-up/[[...sign-up]]/page.tsx` rendering `<SignUp signInUrl="/sign-in" />`.
  - Enable Email + Google OAuth and Clerk Organizations in the Clerk Dashboard.
  - In the Header component (`use client`):
    - Use `useUser()` (`{ user, isLoaded, isSignedIn }`) and `useClerk()` (`{ signOut }`).
    - If `!isLoaded`, return `null`.
    - If `!isSignedIn`, render "Login" (`/sign-in`) and "Get Started" (`/sign-up`) links.
    - If `isSignedIn`, render user avatar dropdown (`user?.imageUrl`) with links to **Dashboard**, **Billing**, **Settings**, **Support**, and a **Logout** action (`await signOut()`).
  - Update `next.config.ts` / `next.config.mjs` `images.remotePatterns` to allow `https://img.clerk.com` (or Clerk image hostnames).
- **Acceptance Criteria:**
  - Users can sign up, sign in via Google/Email, create/select an organization, see their Google/Clerk avatar in the navbar, navigate to the main dashboard, and log out cleanly.

#### Ticket 1.2: Docker Compose Infrastructure Setup (Redis, ClickHouse, CH-UI, NATS JetStream)
- **Component:** Root / `services/docker-compose.yml`
- **Description:** Provision local stateful infrastructure services required for high-speed caching, message brokering, and columnar log storage.
- **Implementation Details:**
  - **Service 1: `redis`**
    - Image: `redis:7-alpine`
    - Container Name: `oneminutelogs-redis`
    - Environment: `REDIS_PASSWORD=oneminutelogs`
    - Ports: `6379:6379`
    - Volumes: `redis_data:/data`
    - Command: `redis-server --requirepass oneminutelogs --appendonly yes --maxmemory-policy allkeys-lru`
    - Restart: `unless-stopped`
    - Healthcheck: `test: ["CMD", "redis-cli", "-a", "oneminutelogs", "ping"]`, `interval: 10s`, `timeout: 5s`, `retries: 5`
  - **Service 2: `clickhouse`**
    - Image: `clickhouse/clickhouse-server:25.7-alpine`
    - Container Name: `clickhouse`
    - Ports: `8123:8123` (HTTP), `9000:9000` (Native)
    - Volumes: `clickhouse_data:/var/lib/clickhouse`
    - Environment: `CLICKHOUSE_DB=logs`, `CLICKHOUSE_USER=default`, `CLICKHOUSE_PASSWORD=""`, `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1`
    - Ulimits: `nofile: { soft: 262144, hard: 262144 }`
    - Restart: `unless-stopped`
  - **Service 3: `ch-ui`**
    - Image: `ghcr.io/caioricciuti/ch-ui:latest`
    - Container Name: `ch-ui`
    - Depends On: `clickhouse`
    - Ports: `5521:5521/tcp`
    - Environment: `VITE_CLICKHOUSE_URL=http://host.docker.internal:8123`, `VITE_CLICKHOUSE_USER=default`, `VITE_CLICKHOUSE_PASS=""`
  - **Service 4: `nats`**
    - Image: `nats:2.10-alpine`
    - Container Name: `oneminutelogs-nats`
    - Ports: `4222:4222`, `8222:8222`
    - Volumes: `nats_data:/data`
    - Command: `nats-server -js -m 8222`
    - Restart: `unless-stopped`
  - Declare named volumes: `redis_data`, `clickhouse_data`, `nats_data`.
- **Acceptance Criteria:**
  - `docker compose up -d` starts all 4 containers cleanly.
  - Redis responds `PONG`, ClickHouse web UI is accessible on `http://localhost:8123` / `5521`, and NATS JetStream monitoring runs on `http://localhost:8222`.

#### Ticket 1.3: NestJS Service Bootstrap, Global Pipes, Filters & Database/Cache Modules
- **Component:** `services`
- **Description:** Initialize the NestJS backend on port `8080`, configure Neon PostgreSQL with Drizzle ORM, and create global Redis and LRU Cache modules.
- **Implementation Details:**
  - Initialize NestJS project in `services/`. Remove deprecated `baseUrl` from `tsconfig.json` if using TypeScript 7+ compatibility.
  - Configure `services/src/main.ts`:
    - Create `NestExpressApplication` with `{ rawBody: true }` (critical for Stripe & Alert webhooks while supporting JSON parsing).
    - Set global prefix: `app.setGlobalPrefix('api')`.
    - Enable URI versioning: `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`.
    - Enable CORS: `app.enableCors({ origin: true, methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'], credentials: true })`.
    - Add Global ValidationPipe: `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` (install `class-validator` and `class-transformer`).
    - Register Global Exception Filter: `BodyParserExceptionFilter` (`services/src/filters/body-parser-exception.filter.ts`) to catch `entity.too.large` payloads and return a clean HTTP 413 JSON response instead of crashing the server.
  - **Database Module (`services/src/database/database.module.ts` & `client.ts`):**
    - Install `drizzle-orm`, `@neondatabase/serverless`, `ws`, `dotenv`, and dev dependency `drizzle-kit`.
    - Set `neonConfig.webSocketConstructor = ws`.
    - Provide global `DRIZZLE_DB` token using `Pool({ connectionString: process.env.DATABASE_URL })` and `drizzle(pool, { schema })`.
    - Also export a standalone `db` instance in `services/src/database/client.ts` for non-DI worker functions (e.g., `alert-consumer.ts`).
    - Configure `services/drizzle.config.ts` pointing to `./src/database/schema.ts`, output `./drizzle`, dialect `postgresql`.
  - **Cache Module (`services/src/infra/cache.module.ts`):**
    - Install `lru-cache`.
    - Global module exporting `LRU_CACHE` token (`max: 10000`, `ttl: 5 * 60 * 1000`, `updateAgeOnGet: true`, `updateAgeOnHas: false`, `allowStale: false`).
  - **Redis Module (`services/src/infra/redis.module.ts`):**
    - Install `ioredis` and `@nestjs/config`.
    - Global module exporting `REDIS_CLIENT` token configured with `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`, and exponential backoff `retryStrategy` (up to 3 times).
- **Acceptance Criteria:**
  - `npm run db:generate && npm run db:push` syncs schemas to Neon Postgres.
  - `npm run start:dev` boots on port `8080` and logs `Redis connected`.

---

### EPIC 2: API Key Management & High-Speed Multi-Tier AuthGuard
**Goal:** Enable users to generate, view, and revoke API keys with a 5-key limit per user, and authenticate both SDK requests (`x-api-key`) and Dashboard requests (`Bearer <Clerk_JWT>`) in under 1ms using a 3-tier caching architecture.

#### Ticket 2.1: API Key Service & Controller (`services/src/modules/api-key`)
- **Component:** `services/src/modules/api-key/`
- **Description:** Build the CRUD & lifecycle management service for `oml_<keyId>_<secret>` API keys.
- **Implementation Details:**
  - **Key Generation (`generateKey`):**
    - `keyId = crypto.randomUUID().replace(/-/g, '')` (32 hex chars).
    - `secret = crypto.randomBytes(32).toString('base64url')`.
    - `plainTextKey = "oml_" + keyId + "_" + secret`.
  - **Create API Key (`POST /api/v1/api-keys`):**
    - Count existing keys for `userId` in `api_key` table. If `count >= 5`, throw `BadRequestException('You have reached the maximum limit of 5 API keys. Please contact support for more.')`.
    - Hash `plainTextKey` using `argon2.hash(plainTextKey, { type: argon2.argon2id, timeCost: 3, memoryCost: 1 << 16, parallelism: 1 })`.
    - Extract `prefix = plainTextKey.slice(0, 18) + '...'`.
    - Insert `{ id: keyId, user_id: userId, value: hashedValue, prefix }` into `api_key`.
    - Return `{ key: plainTextKey }` (one-time reveal).
  - **List API Keys (`GET /api/v1/api-keys`):**
    - Select `id`, `prefix`, `created_at`, `last_used_at`, `revoked_at` from `api_key` where `eq(apiKey.user_id, userId)`.
  - **Get API Key Last Used (`GET /api/v1/api-keys/:id`):**
    - Query Redis first: `this.redis.hget(LAST_USED_HASH, normalizedKeyId)` where `LAST_USED_HASH = oml:api_key:last_used:v1`.
    - If present in Redis, return it immediately; otherwise fallback to querying `last_used_at` from PostgreSQL `api_key` table.
  - **Delete / Revoke API Key (`DELETE /api/v1/api-keys/:id`):**
    - Soft-delete by updating `revoked_at = new Date()` where `and(eq(apiKey.user_id, userId), eq(apiKey.id, keyId))` *(Critical Bug Fix: Must include `eq(apiKey.id, keyId)` so it doesn't revoke all keys for the user!)*.
    - Immediately evict from Redis (`await this.redis.del('oml:api_key:' + VERSION + ':' + keyId)`) and local LRU cache (`localCache.delete(VERSION + ':' + keyId)`).
  - **Regenerate API Key (`POST /api/v1/api-keys/:id/regenerate`):**
    - Generate new secret, hash with Argon2id, update `value`, `prefix`, `created_at` in DB, and invalidate Redis + LRU cache keys.
- **Acceptance Criteria:**
  - Users can create up to 5 keys, list keys, check real-time `last_used_at`, and revoke a specific key with instant cache eviction.

#### Ticket 2.2: Multi-Tier AuthGuard (`services/src/guards/auth.guard.ts`)
- **Component:** `services/src/guards/auth.guard.ts`, `services/src/utils/api-key-verifier.ts`, `services/src/utils/key-digest.ts`
- **Description:** Authenticate incoming requests via either `x-api-key` header (SDK) or `Authorization: Bearer <token>` (Clerk Dashboard).
- **Implementation Details:**
  - **Helper 1: `extractKeyId(plainKey: string)` (`api-key-verifier.ts`):**
    - Verify `plainKey.startsWith('oml_')`. Split by `_`. Ensure `parts.length === 3`.
    - Extract `keyId = parts[1]`. Validate against 32-char hex regex `/^[0-9a-f]{32}$/i`. Return `keyId` or `null`.
  - **Helper 2: `digest(rawKey: string)` (`key-digest.ts`):**
    - Compute `crypto.createHmac('sha256', process.env.REDIS_KEY_SECRET).update(rawKey).digest('hex')`.
  - **Path A: `x-api-key` Header Present:**
    1. Extract `keyId`. If `null`, throw `UnauthorizedException('Invalid API key')`.
    2. Compute `d = digest(apiKey)`.
    3. **L1 Local LRU Check:** Check `localCache.get(VERSION + ':' + keyId)`. If found, not expired (`c.expiresAt > now`), and `c.apiKeyDigest === d`:
       - Set `request.user = { id: c.userId, keyId }`.
       - Fire background `void this.trackApiKeyLastUsed(keyId)`. Return `true`.
    4. **L2 Redis Check:** Fetch `rDigest = await this.redis.hgetall('oml:api_key:' + VERSION + ':' + keyId)`.
       - If `rDigest.invalid === '1'`, throw `UnauthorizedException('Unauthorized')` (blocks brute-force attackers).
       - If `rDigest.api_key_digest`: if it does not match `d`, throw `UnauthorizedException('Unauthorized')`. If it matches and `rDigest.user_id` exists, populate L1 `localCache` (TTL `LRU_SOFT_TTL_MS = 5m`), set `request.user`, call `void this.trackApiKeyLastUsed(keyId)`, and return `true`.
    5. **L3 PostgreSQL + Argon2 Verification:**
       - Query `api_key` where `and(eq(ak.id, keyId), isNull(ak.revoked_at))`.
       - If no record, throw `UnauthorizedException('Unauthorized')`.
       - Verify hash: `const isValid = await argon2.verify(record.value, apiKey)`.
       - If `!isValid`: write negative cache entry to Redis (`hset(redisKey, { invalid: '1' })`, `expire(redisKey, REDIS_HARD_TTL_SECONDS = 600)`) and throw `UnauthorizedException('Unauthorized')`.
       - If valid: write `{ user_id: record.user_id, api_key_digest: d }` to Redis (`expire` 600s) and L1 `localCache`, set `request.user = { id: record.user_id, keyId }`, call `void this.trackApiKeyLastUsed(keyId)`, and return `true`.
  - **Debounced Last Used Tracking (`trackApiKeyLastUsed`):**
    - Lock key: `oml:api_key:last_used_lock:${VERSION}:${keyId}`.
    - Execute `await this.redis.set(lockKey, '1', 'EX', 60, 'NX')`.
    - If lock acquired (`ok === 'OK'`), execute `await this.redis.hset(LAST_USED_HASH, keyId, Date.now().toString())`.
  - **Path B: `Authorization: Bearer <token>` Header Present:**
    - Extract Bearer token. Verify using `@clerk/backend` `verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })`.
    - Set `request.user = { id: verifiedToken.sub }`. Return `true`.
- **Acceptance Criteria:**
  - Valid API keys resolve in <1ms on subsequent requests via L1/L2 cache.
  - Invalid keys with a valid `keyId` get locked out in Redis for 10 minutes (`invalid: '1'`).
  - Clerk Bearer tokens authenticate seamlessly for dashboard API endpoints.

#### Ticket 2.3: Dashboard API Keys UI (`apps/main-dashboard/app/api-keys/page.tsx`)
- **Component:** `apps/main-dashboard`
- **Description:** Connect the API Keys management page in the dashboard to the NestJS backend using TanStack Query.
- **Implementation Details:**
  - Create `QueryProvider` (`apps/main-dashboard/providers/query-provider.tsx`) with `staleTime: 5 * 60 * 1000`, `refetchOnWindowFocus: false`, `retry: 1`.
  - Remove legacy Key Name / Scope / Expiry modal inputs; clicking **Generate New Key** directly calls `POST ${NEXT_PUBLIC_SERVER_URI}/api-keys` with Clerk `Bearer` token and opens the **One-Time Secret Reveal Dialog**.
  - Fetch keys using `useQuery({ queryKey: ['api-keys'], enabled: isLoaded && isSignedIn })`.
  - Format `created_at` and `last_used_at` using `format()` from `timeago.js` (fallback to `"No uses yet"` when `last_used_at === null`).
  - Derive status from `revoked_at === null ? 'active' : 'revoked'`.
  - Implement key revocation (`DELETE ${NEXT_PUBLIC_SERVER_URI}/api-keys/${selected.id}`), invalidate `['api-keys']` query cache, close detail drawer (`setSelected(null)`), and hide the revoke button on already-revoked keys.
- **Acceptance Criteria:**
  - Users can generate keys, copy the plaintext key from the one-time modal, inspect key details in the side drawer, and revoke active keys.

---

### EPIC 3: `@oneminutelogs/next` TypeScript SDK
**Goal:** Build and package the official Next.js/TypeScript SDK supporting batched log transport, graceful process shutdown, historical log fetching (`getLogs`), real-time SSE log streaming (`getStream`), and webhook signature verification (`verifyWebhook`).

#### Ticket 3.1: SDK Types & Core Logger Factory (`sdks/oneminutelogs-next`)
- **Component:** `sdks/oneminutelogs-next/src/types/` & `src/core/index.ts`
- **Description:** Define comprehensive TypeScript interfaces for developer autocomplete and create the `createLogger` entry point.
- **Implementation Details:**
  - **Types (`src/types/`):**
    - `LogLevel`: `'info' | 'warn' | 'error'`
    - `LogType`: `'error' | 'warn' | 'info' | 'audit' | 'metric' | 'debug' | 'success'`
    - `Importance`: `'critical' | 'high' | 'medium' | 'low'`
    - `Subsystem`: `'auth' | 'db' | 'api' | 'payment' | 'cache' | 'queue' | 'worker' | 'ui' | 'other'` (or string union)
    - `LogTrack`: `{ user_id?: string; role?: UserRole; ip?: string; user_agent?: string; geo?: string }`
    - `LogSecurity`: `{ auth_status?: AuthStatus; suspicious?: boolean; tags?: string[] }`
    - `LogMetrics`: `{ latency_ms?: number; db_query_count?: number }`
    - `LogTimestamps`: `{ event_time: string; ingest_time?: string }`
    - `LoggerConfig`: `{ apiKey: string; appName?: string; environment?: string }`
    - `LogPayload`: Combines all fields above.
    - `VerifyWebhookOptions`: `{ signature: string; timestamp: string | number; body: string | Record<string, any> }`
  - **Core Factory (`createLogger(config: LoggerConfig)`):**
    - Instantiates `new OMLTransport(config)`.
    - Provides convenience methods: `send`, `info`, `error`, `metric`, `audit`, `warn`, `get(filters)`, `stream(filters)`, and `verifyWebhook(options)`.
    - Automatically defaults `appName` to `config.appName || 'default'` and `environment` to `config.environment || process.env.NODE_ENV || 'development'`.
- **Acceptance Criteria:**
  - `npm run build` compiles ESM + `.d.ts` declarations into `dist/` without errors.

#### Ticket 3.2: Batched Transport & Graceful Shutdown (`sdks/oneminutelogs-next/src/utils/index.ts`)
- **Component:** `sdks/oneminutelogs-next/src/utils/index.ts`
- **Description:** Implement `OMLTransport` with in-memory buffering, 2-second periodic flushing, process signal handlers, historical fetch, SSE readable stream proxy, and webhook verification.
- **Implementation Details:**
  - **Batching & Flushing:**
    - `buffer: LogPayload[] = []`, `flushInterval = 2000` (2 seconds), `isFlushing = false`, `shuttingDown = false`.
    - `send(payload)`: Pushes `{ ...payload, ingested_at: Date.now() }` into `buffer` and starts `setTimeout(() => this.flush(), this.flushInterval)` if no timer is active.
    - `flush()`: Splices all items from `buffer` and sends `POST ${this.baseUrl}/logs/send` with headers `Content-Type: application/json`, `x-api-key`, `x-oml-app-name`, `x-oml-env`, `keepalive: true`, and body `JSON.stringify({ logs: batch })`.
  - **Graceful Shutdown (`setupGracefulShutdown`):**
    - Registers listeners on `process.on('beforeExit')`, `process.on('SIGINT')`, and `process.on('SIGTERM')` to await `this.flush()` before `process.exit(0)`.
  - **Server-Side Query & Stream Methods:**
    - `get(filters)`: Builds `URLSearchParams` and sends `GET ${this.baseUrl}/logs?${qs}` with `x-api-key` headers.
    - `stream(filters)`: Uses `AbortController` and `ReadableStream<Uint8Array>` to pipe upstream SSE chunks from `GET ${this.baseUrl}/logs/stream?${qs}` to the Next.js route handler.
    - `verifyWebhook(options)`: Sends `POST ${this.baseUrl}/alerts/verify-webhook` with `{ signature, timestamp, body }` and `x-api-key` header.
- **Acceptance Criteria:**
  - Rapid calls to `logger.info()` / `logger.error()` are batched into a single HTTP POST every 2 seconds and flushed before process termination.

#### Ticket 3.3: React Client Hooks (`getLogs` & `getStream`) (`sdks/oneminutelogs-next/src/utils/`)
- **Component:** `get-logs.ts` & `get-stream.ts`
- **Description:** Provide `"use client"` React hooks with in-flight request deduplication and bounded 5,000-log SSE state management.
- **Implementation Details:**
  - **`getLogs(filters)` (`get-logs.ts`):**
    - Maintains module-level `inFlight = new Map<string, Promise<any>>()` (prevents React StrictMode double-fetching) and `cache = new Map<string, any>()`.
    - Fetches from `/api/oneminutelogs/logs?${key}` with `cache: 'no-store'`.
    - Returns `{ data, isLoading, error, refetch }`.
  - **`getStream(filters)` (`get-stream.ts`):**
    - Connects `new EventSource('/api/oneminutelogs/stream?' + qs)`.
    - Normalizes incoming ClickHouse rows (`toLogEntry`: maps `type` to `level`, formats `timestamp` to ISO string, assigns `crypto.randomUUID()`).
    - Handles both `payload.type === 'initial'` and `payload.type === 'live'` messages.
    - **Memory Cap:** Slices array to maximum **5,000 logs** (`next.slice(-5000)`) so long-running browser tabs never crash.
    - Returns `{ data, isLoading, error, connected, disconnect }`.
- **Acceptance Criteria:**
  - Hooks export cleanly from `@oneminutelogs/next` and stream/query logs via Next.js proxy route `/api/oneminutelogs/[...types]/route.ts`.

---

### EPIC 4: Log Ingestion Pipeline, NATS JetStream, ClickHouse & Live SSE
**Goal:** Build the core backend log ingestion pipeline, NATS JetStream producer/consumer, ClickHouse storage layer, custom query parser with cooldown caching, and real-time SSE broadcasting.

#### Ticket 4.1: ClickHouse Client, Schema Init & NATS JetStream Producer
- **Component:** `services/src/clickhouse/`, `services/src/infra/nats/`
- **Description:** Set up the ClickHouse client, auto-create the `logs.events` MergeTree table on startup, and configure NATS JetStream streams and producers.
- **Implementation Details:**
  - **ClickHouse Client (`src/clickhouse/client.ts`):**
    - Validate `CLICKHOUSE_URL` (default `http://localhost:8123`), `CLICKHOUSE_USER` (`default`), `CLICKHOUSE_PASSWORD` (`""`), `CLICKHOUSE_DB` (`logs`).
  - **ClickHouse Schema (`src/clickhouse/schema.ts`):**
    - Export `createLogsTable()` executing `CREATE DATABASE IF NOT EXISTS logs` and `CREATE TABLE IF NOT EXISTS logs.events (...) ENGINE = MergeTree() PARTITION BY toYYYYMM(timestamp) ORDER BY (timestamp, key_id) TTL timestamp + INTERVAL 30 DAY DELETE SETTINGS index_granularity = 8192`.
  - **NATS Connection & Stream Init (`src/infra/nats/index.ts`, `init-stream.ts`):**
    - Connect to `process.env.NATS_URL || 'nats://localhost:4222'`.
    - Initialize stream `OML_LOGS` with subjects `['logs.ingest', 'logs.alert.evaluate']`, `retention: RetentionPolicy.Workqueue`, `storage: StorageType.File`.
    - If stream already exists, check for missing subjects and update stream config so both `logs.ingest` and `logs.alert.evaluate` are registered.
  - **Producer (`src/infra/nats/producer.ts`):**
    - `publishLogBatch(keyId, userId, logs, serverReceivedAt)` publishes JSON-encoded `{ keyId, userId, serverReceivedAt, logs }` to subject `logs.ingest`.
- **Acceptance Criteria:**
  - On NestJS startup (`main.ts`), `createLogsTable()`, `initNatsStream()`, and `startWorkers()` run automatically.

#### Ticket 4.2: NATS Logs Consumer Worker & SSE Registry (`services/src/infra/nats/consumer.ts` & `src/sse/sse-registry.ts`)
- **Component:** `services/src/infra/nats/consumer.ts`, `services/src/sse/sse-registry.ts`
- **Description:** Consume log batches from `logs.ingest`, record ingestion latency and backlog metrics, bulk insert into ClickHouse, accumulate user usage, trigger alert evaluation, and broadcast live logs via SSE.
- **Implementation Details:**
  - Subscribe durable push consumer `oml_logs_consumer` on subject `logs.ingest` with explicit manual acknowledgement (`AckPolicy.Explicit`, deliver subject `oml.logs.worker`).
  - For each message:
    1. Calculate `latency = Date.now() - serverReceivedAt`. Push to Redis `ingest:latency` (`LPUSH` + `LTRIM 0 59`).
    2. Transform each log: map `importance` (`critical: 4, high: 3, medium: 2, low: 1`), `JSON.stringify` `track`, `security`, and `metrics`, convert `timestamp` to Unix seconds.
    3. Insert batch into ClickHouse: `await clickhouse.insert({ table: 'logs.events', values: transformed, format: 'JSONEachRow' })`.
    4. Publish transformed batch to NATS subject `logs.alert.evaluate`: `await js.publish('logs.alert.evaluate', jc.encode({ logs: transformed, processedAt: Date.now() }))`.
    5. **Usage Accumulation:**
       - `const usageKey = USAGE_REDIS_KEY(userId);`
       - `await redis.hincrby(usageKey, 'events_used', transformed.length);`
       - `await redis.expire(usageKey, PLAN_REDIS_TTL_SECONDS);`
       - `await redis.sadd(USAGE_DIRTY_KEY, userId);`
       - Update in-memory `usageCache` LRU if key is present.
    6. **SSE Broadcast (`broadcastLogs(transformed)`):**
       - Iterate over connected `clients` in `sse-registry.ts`.
       - Filter logs matching `client.filters` (`userId`, `type`, `env`, `appName`, `search`).
       - Stream matching logs in chunks of `50` via `res.write('data: ' + JSON.stringify({ type: 'live', logs: slice }) + '\n\n')`.
    7. Acknowledge NATS message: `msg.ack()`.
    8. Update `ingest:backlog` in Redis (at most once per 1,000ms) from `jsm.consumers.info(streamName, durable)`.
- **Acceptance Criteria:**
  - Ingested logs appear in ClickHouse, update Redis usage counters, trigger alert evaluation, and stream to active SSE clients in real time.

#### Ticket 4.3: Logs Controller, Query DSL Parser, SSE Stream & Live Metrics SSE (`services/src/modules/logs/`)
- **Component:** `services/src/modules/logs/`, `apps/main-dashboard/app/live-logs/`, `apps/main-dashboard/app/queries/`
- **Description:** Implement the `/api/v1/logs` endpoints for batch ingestion, historical search with query DSL, live log SSE streaming, and dashboard metrics SSE streaming.
- **Implementation Details:**
  - **`POST /api/v1/logs/send`:**
    - Protected by `@UseGuards(AuthGuard, UsageGuard)`.
    - Enforces per-plan batch size limit (e.g., max 100 logs per batch on Free plan; throws `BadRequestException('Too many logs in one batch')` if exceeded).
    - Calls `publishLogBatch(req.user.keyId, req.user.id, body.logs, Date.now())`.
  - **`GET /api/v1/logs` & `GET /api/v1/logs/dashboard`:**
    - Protected by `@UseGuards(AuthGuard)`.
    - **Synchronous `parseFilters(queryObj)`** *(Critical Bug Fix: `parseFilters` MUST NOT be `async` when called without `await`!)*:
      - Parses raw DSL strings (`type:error env:development app_name:Becodemy search:timeout range:24h limit:100`) as well as explicit query params.
      - Converts relative ranges (`s`, `m`, `h`, `d`, default 30d) and Unix timestamps (auto-detecting ms vs seconds via `> 2e12`) into `timestampFrom` and `timestampTo`.
    - **Rate-Limiting & Query Result Caching:**
      - `isCoolingDown(userId)` checks `queryCooldown` LRU (2,000ms window). If cooling down and `resultCache` has a fallback, returns cached fallback immediately.
      - Checks `resultCache` (1,000ms fresh TTL) before querying ClickHouse.
    - Executes `Promise.all` against ClickHouse for matching rows (`ORDER BY timestamp DESC LIMIT {limit:UInt32}`) and 24-hour total count.
  - **`GET /api/v1/logs/stream` (Live Logs SSE):**
    - Sets headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, calls `res.flushHeaders()`.
    - Queries initial historical logs from ClickHouse (default limit 500), sends `data: {"type":"initial","logs":[...]}\n\n`, and registers client in `sse-registry.ts` (`addClient(res, filters)`).
  - **`GET /api/v1/logs/metrics/stream` (Live Dashboard Metrics SSE):**
    - Protected by `@UseGuards(AuthGuard)`.
    - Streams real-time ingestion rate (`ingest:last_rate`), queue backlog (`ingest:backlog`), and average latency (computed from `ingest:latency` list in Redis) via SSE to Next.js proxy `/api/live-metrics/route.ts`.
- **Acceptance Criteria:**
  - Live Logs page streams logs in real time with level color coding and auto-scroll toggle.
  - Queries page executes DSL queries (`type:error`) and filters ClickHouse results in <15ms.

---

### EPIC 5: Usage Guard, Quota Enforcement & Background DB Sync Scheduler
**Goal:** Protect the ingestion API with a read-optimized `UsageGuard` that resolves user plans and usage limits via L1/L2 caches, blocks locked or over-quota accounts, and synchronizes accumulated Redis usage counts to PostgreSQL every 5 minutes via a NestJS Cron job.

#### Ticket 5.1: UsageGuard (`services/src/guards/usage.guard.ts`)
- **Component:** `services/src/guards/usage.guard.ts`, `services/src/configs/index.ts`
- **Description:** Implement `UsageGuard` (`CanActivate`) to verify user plan, initialize first-time usage records, and enforce plan quotas without performing database writes on hot paths.
- **Implementation Details:**
  - **Step 1: Verify User & Check Hard Lock (`isHardLocked`):**
    - Require `request.user?.id` (else `UnauthorizedException`).
    - Check `await this.redis.exists(HARD_LOCK_REDIS_KEY(userId))` (`oml:user:${userId}:locked`).
    - If locked, throw `ForbiddenException('Your account has been locked. You have exceeded the usage limit for your current plan. Please upgrade your 1 Minute Logs account plan to continue uploading logs.')`.
  - **Step 2: Resolve Plan (`resolvePlan(userId)`):**
    - Check L1 `planCache` LRU (`plan:${userId}`, 5m TTL).
    - Check L2 Redis Hash `PLAN_REDIS_KEY(userId)` (`oml:plan:v1:${userId}`, 6m TTL). If hit, refresh TTL in background (`void this.redis.expire(...)`), normalize tier via `normalizePlanTier`, update L1, and return.
    - Check L3 PostgreSQL `plan` table (`findFirst` where `eq(p.user_id, userId)`).
    - *Important Business Rule:* If no row exists in `plan` table, the user is on `PlanTier.FREE`—**do NOT insert a row into `plan` table for free users**. Cache `{ name: normalizedPlan }` in Redis and L1 LRU.
    - Attach `request.plan = plan.name`.
  - **Step 3: Get or Create Usage (`getOrCreateUsage(userId, planDefaults)`):**
    - Check L1 `usageCache` LRU (`usage:${userId}`).
    - Check L2 Redis Hash `USAGE_REDIS_KEY(userId)` (`oml:usage:v1:${userId}`).
    - Check L3 PostgreSQL `usage` table. If no record exists (first time the user ever sends a log), insert `{ user_id: userId, events_used: 0, events_limit: planDefaults.eventsLimit }` with `.onConflictDoNothing()`, and populate Redis & L1 LRU.
  - **Step 4: Quota Comparison:**
    - `effectiveUsageLimit = usage.events_limit > 0 ? usage.events_limit : planDefaults.eventsLimit`.
    - If `usage.events_used >= effectiveUsageLimit`, throw `ForbiddenException('You have reached your usage quota. Please upgrade your 1 Minute Logs account plan to upload more events.')`.
    - Otherwise return `true`.
- **Acceptance Criteria:**
  - `UsageGuard` guards `POST /api/v1/logs/send`, `POST /api/v1/alerts/verify-webhook`, and billing/alert endpoints.
  - Over-quota requests are rejected immediately with a clear upgrade prompt.

#### Ticket 5.2: 5-Minute Usage Database Sync Cron Scheduler (`services/src/schedulers/usage-db-sync.ts`)
- **Component:** `services/src/schedulers/usage-db-sync.ts`, `services/src/app.module.ts`
- **Description:** Periodically flush dirty user usage counters from Redis to PostgreSQL without losing concurrent increments.
- **Implementation Details:**
  - Install `@nestjs/schedule` and register `ScheduleModule.forRoot()` in `AppModule`.
  - Create `@Injectable() export class UsageDbSync` with `@Cron('*/5 * * * *') async syncFlushUsage()`.
  - Generate atomic processing key: `const processingKey = `${USAGE_DIRTY_KEY}:processing:${Date.now()}``.
  - Rename set atomically: `await this.redis.rename(USAGE_DIRTY_KEY, processingKey).catch(() => null)`. If `null` (set doesn't exist / no dirty users), return immediately.
  - Fetch dirty user IDs: `const userIds = await this.redis.smembers(processingKey)`.
  - Loop through `userIds`:
    - Fetch `usage = await this.redis.hgetall(USAGE_REDIS_KEY(userId))`.
    - If `usage?.events_used` is defined, convert strings to `Number` and update PostgreSQL `usage` table (`events_used`, `events_limit`, `updated_at: new Date()`) where `eq(schema.usage.user_id, userId)`.
  - Delete `processingKey` from Redis: `await this.redis.del(processingKey)`.
- **Acceptance Criteria:**
  - High-frequency log ingestion only increments Redis in real time, and PostgreSQL `usage` table is accurately synced every 5 minutes.

---

### EPIC 6: SaaS Billing, Stripe Subscriptions, Webhooks & Invoices
**Goal:** Implement end-to-end SaaS monetization with Stripe Checkout Subscriptions, Stripe Customer Billing Portal, cryptographic Webhook processing, instant cache/database plan & quota upgrades, and downloadable PDF invoices.

#### Ticket 6.1: Billing Service & Stripe Session/Portal Creation (`services/src/modules/billing/`)
- **Component:** `services/src/modules/billing/`
- **Description:** Create endpoints for current plan retrieval, Stripe Checkout Session creation, Stripe Billing Portal session creation, and invoice history listing.
- **Implementation Details:**
  - Install `stripe` SDK. Initialize with `STRIPE_SECRET_KEY` (Test Mode).
  - **`GET /api/v1/billing/current`:** Uses `@UseGuards(AuthGuard, UsageGuard)` and returns `{ plan: req.plan }`.
  - **Customer Resolution (`ensureStripeCustomer(userId)`):**
    - Fetch user's primary email from Clerk via `createClerkClient({ secretKey }).users.getUser(userId)`.
    - Check PostgreSQL `plan` table for existing `stripe_customer_id`.
    - If not in DB, search Stripe `stripe.customers.list({ email, limit: 1 })`.
    - If still not found, create via `stripe.customers.create({ email, metadata: { user_id: userId } })`.
  - **`POST /api/v1/billing/checkout` (`createBillingSession`):**
    - Validate `selectedPlan` is a paid plan (`starter` | `pro` | `business`). Reject `free`.
    - Resolve Stripe Price ID from env (`STRIPE_STARTER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_BUSINESS_PRICE_ID`).
    - Create `stripe.checkout.sessions.create`:
      - `mode: 'subscription'`, `customer: customerId`, `client_reference_id: userId`, `line_items: [{ price: priceId, quantity: 1 }]`
      - `metadata: { user_id: userId, plan }`, `subscription_data: { metadata: { user_id: userId, plan } }`
      - `success_url: ${appUrl}/settings?checkout=success&plan=${plan}`
      - `cancel_url: ${appUrl}/settings?checkout=cancelled`
    - Return `{ url: session.url }`.
  - **`POST /api/v1/billing/portal` (`createPortalSession`):**
    - Reject if user's current plan is `free` (`BadRequestException('Free plan users do not have a Stripe billing portal yet')`).
    - Call `stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${appUrl}/settings` })` and return `{ url: session.url }`.
  - **`GET /api/v1/billing/invoices` (`getInvoices`):**
    - Query `payment_invoices` table where `eq(user_id, userId)` ordered by `desc(created_at)`.
- **Acceptance Criteria:**
  - Paid plan selection generates a valid Stripe Checkout URL, and subscribed users can open the Stripe Billing Portal.

#### Ticket 6.2: Stripe Webhook Handler, Plan Activation & Invoice Persistence
- **Component:** `services/src/modules/billing/billing.service.ts` & `billing.controller.ts`
- **Description:** Process asynchronous Stripe webhook events to activate subscriptions, update Redis/LRU plan and usage limits immediately, and store invoices.
- **Implementation Details:**
  - **`POST /api/v1/billing/webhook`:**
    - Read `stripe-signature` header and `req.rawBody` Buffer (enabled via `{ rawBody: true }` in `main.ts`).
    - Verify signature via `this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)`.
  - **Handle Events in Switch Statement:**
    - `checkout.session.completed` -> `activatePlanFromCheckoutSession(session)`
    - `customer.subscription.created` | `customer.subscription.updated` -> `activatePlanFromSubscription(subscription)`
    - `invoice.created` | `invoice.finalized` | `invoice.payment_failed` | `invoice.voided` -> `saveInvoice(invoice)`
    - `invoice.paid` | `invoice.payment_succeeded` -> `saveInvoice(invoice)` AND `activatePlanFromInvoice(invoice)`
  - **`activatePaidPlan(userId, plan, stripeCustomerId, stripeSubscriptionId, stripePriceId)`:**
    1. `updatePlanSources`: Upsert PostgreSQL `plan` table (`onConflictDoUpdate` on `plan.user_id`) AND immediately update Redis (`PLAN_REDIS_KEY`) and L1 `planCache` LRU.
    2. `updateUsageSources`: Update `events_limit` to `PLAN_DEFAULTS[plan].eventsLimit` in PostgreSQL `usage` table, Redis (`USAGE_REDIS_KEY`), and L1 `usageCache` LRU while preserving current `events_used`.
  - **`saveInvoice(invoice)`:**
    - Resolve `userId` from invoice metadata or lookup `plan` table by `stripe_subscription_id` / `stripe_customer_id`.
    - Upsert `payment_invoices` table with `stripe_invoice_id`, `status`, `currency`, `amount_due`, `amount_paid`, `hosted_invoice_url`, `invoice_pdf`, `period_start`, `period_end`.
- **Acceptance Criteria:**
  - Completing a Stripe test payment (`4242...`) returns HTTP 201 on the webhook, upgrades the user's plan and quota in Redis/Postgres immediately, and populates the Invoices table.

#### Ticket 6.3: Dashboard Settings, Pricing Grid, Sidebar Plan Badge & Invoices UI
- **Component:** `apps/main-dashboard/app/settings/page.tsx`, `apps/main-dashboard/components/layout/dashboard-sidebar.tsx`
- **Description:** Build the 4-column responsive Pricing Grid, Manage Billing portal button, dynamic Invoices table with PDF download, and Sidebar plan badge.
- **Implementation Details:**
  - Define `PLAN_DETAILS` for `free` ($0), `starter` ($9.99, `popular: true`), `pro` ($24.99), and `business` ($49.99) with feature checklists (`included: true/false`).
  - Fetch current plan via `useQuery({ queryKey: ['current-plan'], queryFn: () => fetch('/api/v1/billing/current') })` in both Settings and `DashboardSidebar`.
  - Display `"POPULAR"` badge on Starter only if `planData?.plan === 'free'`.
  - Show **Manage Billing** button when `currentPlan !== 'free'`, triggering `createPortalSession.mutate()`.
  - Render Invoices table with truncated Invoice ID (`invoice.stripe_invoice_id.slice(0, 8) + '...'`), formatted date, formatted currency amount, status badge, and **Download PDF** button opening `invoice.invoice_pdf || invoice.hosted_invoice_url` in a new tab.
- **Acceptance Criteria:**
  - Sidebar and Settings page dynamically reflect the active subscription tier, and users can upgrade or download PDF invoices.

---

### EPIC 7: Event-Driven Smart Alerting Engine & Signed Webhooks
**Goal:** Allow paid users to configure threshold-based alert rules evaluated in real time by a dedicated NATS JetStream consumer, dispatching HMAC-SHA256 signed webhooks with cooldown protection.

#### Ticket 7.1: Alert Service, Tier Quotas, Form Validation & Persistent Redis Cache (`services/src/modules/alert/`)
- **Component:** `services/src/modules/alert/`
- **Description:** Implement alert creation, strict payload validation, plan-based alert count limits, persistent Redis caching, and cryptographic webhook signature verification.
- **Implementation Details:**
  - **Plan Quota Enforcement (`createAlert`):**
    - `free`: Throw `ForbiddenException('Alerts are not included in the free plan. Upgrade your plan to start setting up alerts.')`.
    - `starter`: Max `5` alerts.
    - `pro`: Max `12` alerts.
    - `business`: Max `20` alerts.
  - **Validation (`validateCreateAlertPayload`):**
    - Require non-empty `name`, `app_name`, `webhook_url` (valid `new URL()`), `cooldown_period`, `summary`.
    - `conditions`: Non-empty array. Allowed fields: `type`, `message`, `importance`, `environment`, `service`, `subsystem`, `operation`. Allowed operators: `equals`, `not_equals`. If field is `importance`, value must be `critical`, `high`, `medium`, or `low`.
    - `threshold.count >= 1` (integer) and `threshold.window_minutes >= 1` (integer).
  - **Database Insert & Cache Invalidation:**
    - Insert alert into PostgreSQL `alerts` table with `.returning()` *(Critical Bug Fix: ensure `.returning()` is spelled correctly, not `.retiring()`)*.
    - Delete Redis cache key `await this.redis.del('oml:alerts:' + userId)` so the subsequent `listAlerts` call repopulates Redis with fresh rules.
  - **List Alerts (`GET /api/v1/alerts`):**
    - Check Redis `oml:alerts:${userId}`. If miss, query PostgreSQL `alerts` table for `userId` and store in Redis **without TTL** (persistent in RAM so the high-speed consumer never hits PostgreSQL).
  - **Verify Webhook (`POST /api/v1/alerts/verify-webhook`):**
    - Protected by `@UseGuards(AuthGuard, UsageGuard)`.
    - Reject if `userPlan === 'free'`.
    - Validate `timestamp` is a number and within **60 seconds** (`Math.abs(Date.now() - ts) <= 60_000`), otherwise throw `'Webhook has expired'`.
    - Reconstruct signed payload `${timestamp}.${payloadString}`, compute HMAC-SHA256 using `process.env.WEBHOOK_SIGNING_SECRET`, and compare with `signature` using `crypto.timingSafeEqual`.
- **Acceptance Criteria:**
  - Paid users can create and list alerts within their tier quota, and client apps can cryptographically verify incoming webhook payloads within the 60-second replay window.

#### Ticket 7.2: NATS JetStream Alert Consumer Worker (`services/src/infra/nats/alert-consumer.ts`)
- **Component:** `services/src/infra/nats/alert-consumer.ts`, `services/src/infra/start-workers.ts`
- **Description:** Build the event-driven consumer on `logs.alert.evaluate` that matches ingested log batches against cached user alert rules and dispatches webhooks.
- **Implementation Details:**
  - Subscribe durable push consumer `oml_alert_consumer` on subject `logs.alert.evaluate` (deliver subject `oml.alert.worker`).
  - Group incoming batch logs by `user_id`.
  - For each `[userId, userLogs]`:
    - Fetch cached rules from Redis `oml:alerts:${userId}`. If no cache exists, `continue` (never query Postgres inside the consumer loop).
    - For each `rule` in `rules`:
      - Filter `userLogs` where `normalize(log.app_name) === normalize(rule.app_name)` AND `rule.conditions.every(cond => matchCondition(log, cond))`.
      - **`matchCondition(log, condition)`** *(Critical Bug Fix: Must include the `switch (condition.operator)` block comparing normalized actual vs expected values for `'equals'` and `'not_equals'`, and map numeric ClickHouse `importance` `1..4` back to `'low' | 'medium' | 'high' | 'critical'`!)*.
      - If `matchedLogs.length === 0`, `continue`.
      - Compute time-window bucket: `const windowSeconds = rule.threshold_window_minutes * 60; const bucket = Math.floor(Date.now() / 1000 / windowSeconds)`.
      - Increment counter key `oml:alert:count:${rule.id}:${bucket}` by `matchedLogs.length` and set `EXPIRE` to `windowSeconds`.
      - If `count < rule.threshold_count`, `continue`.
      - Check cooldown key `oml:alert:cooldown:${rule.id}`. If exists, `continue`.
      - **Fire Webhook (`callWebhook(rule, matchedLogs)`):**
        - Construct payload: `{ event_id: randomUUID(), type: 'alert.triggered', alert_id: rule.id, alert_name: rule.name, app_name: rule.app_name, matched_count: matchedLogs.length, sample_log: matchedLogs[0], triggered_at }`.
        - Sign `${timestamp}.${payloadJson}` with `HMAC-SHA256` using `process.env.WEBHOOK_SIGNING_SECRET`.
        - Send `POST` request to `rule.webhook_url` with 5,000ms `AbortController` timeout and headers:
          - `Content-Type: application/json`
          - `User-Agent: OneMinuteLogs-Webhooks/1.0`
          - `X-OML-Event-Id: eventId`
          - `X-OML-Signature: signature`
          - `X-OML-Timestamp: timestamp`
      - Set cooldown key `oml:alert:cooldown:${rule.id}` with TTL from `parseCooldownSeconds(rule.cooldown_period)` (e.g., `5m` -> 300s).
      - Update `rule.last_triggered = triggeredAt` in Redis (`oml:alerts:${userId}`) and PostgreSQL `alerts` table (via standalone `db` client).
  - Acknowledge NATS message: `msg.ack()`.
- **Acceptance Criteria:**
  - When matching logs meet or exceed `threshold_count` within `threshold_window_minutes`, the webhook fires once and enters cooldown for `cooldown_period`.

#### Ticket 7.3: Dashboard Alerts Page & 4-Step Rule Builder Modal (`apps/main-dashboard/app/alerts/page.tsx`)
- **Component:** `apps/main-dashboard/app/alerts/page.tsx`, `apps/main-dashboard/app/layout.tsx`
- **Description:** Build the Alerts overview stats cards, filterable alert list, and the 4-step interactive Alert Creation Modal.
- **Implementation Details:**
  - Add `<Toaster />` from `sonner` to root layout (`apps/main-dashboard/app/layout.tsx`) so validation and API toast notifications render properly.
  - Display 4 summary stat cards: **Active**, **Muted**, **Last Triggered** (formatted via `timeago.js`), and **Total Alerts**.
  - Clicking **New Alert** checks if `planData?.plan === 'free'`; if so, shows `toast.error('Please upgrade your plan for creating alert')`.
  - **4-Step Modal:**
    - **Step 1:** Alert Name input.
    - **Step 2:** Plain-English Rule Builder: Required `app_name` input + dynamic Conditions array (`field`, `operator`, `value`—switching to dropdown when field is `importance`) + Threshold (`count` matching logs within `window` minutes) + live auto-generated plain-English `ruleSummary` preview.
    - **Step 3:** Notify via Webhook (`webhook_url` input).
    - **Step 4:** Cooldown Period selector (`5m`, `10m`, `30m`, etc.).
  - Submit via `POST ${NEXT_PUBLIC_SERVER_URI}/alerts`, invalidate `['alerts']` query cache, close modal, and reset form state.
- **Acceptance Criteria:**
  - Paid users can build multi-condition alert rules with live English summaries, save them, and see real-time trigger timestamps.

---

### EPIC 8: Main Dashboard Overview & Live System Telemetry
**Goal:** Wire up the main dashboard overview page (`/`) with real-time 24-hour log analytics, error rates, top sources/activities, recent alerts, and live SSE server telemetry (Ingest Rate, Average Latency, Queue Backlog).

#### Ticket 8.1: Next.js API Proxies (`/api/live-metrics` & `/api/logs/get-logs`) & Overview Page (`apps/main-dashboard/app/page.tsx`)
- **Component:** `apps/main-dashboard/app/api/live-metrics/route.ts`, `apps/main-dashboard/app/api/logs/get-logs/route.ts`, `apps/main-dashboard/app/page.tsx`
- **Description:** Connect the main dashboard overview cards and charts to live backend endpoints and SSE streams.
- **Implementation Details:**
  - **`GET /api/live-metrics/route.ts`:**
    - Authenticates via Clerk `getToken()`, fetches `${NEXT_PUBLIC_SERVER_URI}/logs/metrics/stream` with `cache: 'no-store'`, and returns the upstream body with `Content-Type: text/event-stream`.
  - **`GET /api/logs/get-logs/route.ts`:**
    - Authenticates via Clerk `getToken()`, fetches `${NEXT_PUBLIC_SERVER_URI}/logs/dashboard?range=24h`, and returns JSON.
  - **Overview Page (`apps/main-dashboard/app/page.tsx`):**
    - Fetch 24h logs from `/api/logs/get-logs` to populate **24h Logs Count**, **Error Rate %**, **Error Trend Chart**, **Logs Over Time**, **Top Sources**, and **Top Activity** (displaying up to 16 items).
    - Fetch user alerts from `${NEXT_PUBLIC_SERVER_URI}/alerts` to populate **Active Alerts Count** and **Recent Alerts** (sorted by `last_triggered || created_at` descending, top 4).
    - Connect `new EventSource('/api/live-metrics')` to update **Ingest Rate** (`logs/s`), **Average Latency** (`ms`), and **Queue Backlog** (`jobs`) in real time.
- **Acceptance Criteria:**
  - All metric cards, charts, top activity lists, and recent alerts on the dashboard home page render live data with zero static placeholders.