# 1 Minute Logs (OML) — Product & Technical Specification

## 1. Executive Summary
**1 Minute Logs (OML)** is a production-ready, real-time application monitoring and log management SaaS platform designed specifically for small-scale applications, indie developers, early-stage startups, and agile teams. 

While enterprise tools like Datadog, New Relic, and Sentry cater to complex, large-scale infrastructures requiring heavy configuration, **1 Minute Logs** focuses on extreme simplicity and speed: allowing developers to drop in an lightweight SDK and start streaming, querying, and alerting on production logs in **under one minute** without managing servers, ELK stacks, or complex schemas.

---

## 2. Target Audience & Value Proposition
* **Target Audience:** Indie hackers, junior-to-mid developers, small engineering teams, and early-stage SaaS startups.
* **The Problem:** Traditional logging and observability stacks (like ELK or Datadog) are expensive, require hours of configuration ("YAML jungles"), and have steep learning curves just to answer one simple question: *"What broke in production?"*
* **The Solution:** A zero-configuration, affordable, high-throughput logging platform. Developers install an NPM package, initialize it with an API key, and immediately get real-time log tailing, sub-15ms historical search, and automated webhook alerts.
* **Performance Benchmarks:**
  * **Ingestion Capacity:** $2\text{M+}$ logs per minute.
  * **Search Latency:** $< 15\text{ms}$ average query time.
  * **Auth & Validation Latency:** $0\text{--}1\text{ms}$ via multi-tiered caching.

---

## 3. Core Features

### 3.1. Lightweight NPM SDK (`@1minutelogs/next`)
* **Zero-Config Setup:** Initialize with `createLogger({ apiKey, appName, environment })`.
* **Typed Log Methods:** Built-in support for `.info()`, `.error()`, `.warn()`, `.audit()`, `.metric()`, `.debug()`, and `.success()`.
* **Client-Side Batching & Buffering:** Automatically queues logs in memory and flushes them in batches every $2\text{ seconds}$ to minimize network overhead.
* **Graceful Shutdown:** Hooks into Node.js process signals (`SIGINT`, `SIGTERM`, `beforeExit`) to flush remaining buffered logs before the application exits.
* **Frontend Hooks:** Includes React hooks (`getLogs`, `getStream`) for secure client-side log consumption via Next.js proxy routes.
* **Webhook Verification Helper:** Built-in `verifyWebhook()` method for validating incoming alert webhooks.

### 3.2. High-Throughput Ingestion Pipeline
* **Event-Driven Architecture:** Decouples the REST ingestion endpoint from database writes using **NATS JetStream** as a durable message broker.
* **Batch & Rate Limiting:** Protects the backend from abuse by enforcing batch size limits per request and plan-based usage quotas.
* **Columnar Storage:** Uses **ClickHouse** (`MergeTree` engine) partitioned monthly with automatic TTL-based data retention to store and compress millions of log events efficiently.

### 3.3. Real-Time Log Streaming (Live Tail)
* **Server-Sent Events (SSE):** One-way, low-latency real-time streaming directly from the NATS consumer to connected dashboard clients without querying the database.
* **Live Filtering:** Stream logs dynamically filtered by level/type, environment, application name, or search keywords.
* **Client Memory Protection:** Automatically caps the live stream buffer at $5,000\text{ logs}$ in the browser UI, splicing older entries to prevent memory leaks.

### 3.4. Instant Log Search & Query Engine
* **Structured & Free-Text Search:** Filter historical logs using query syntax (e.g., `type:error env:production app:my-app`) or keyword matching (`ILIKE`).
* **Time-Range Filtering:** Query logs across relative timeframes (e.g., last $15\text{m}$, $24\text{h}$, $7\text{d}$, $30\text{d}$) or custom Unix timestamps.
* **Query Caching & Cooldowns:** Built-in LRU result caching ($1\text{s}$ TTL for identical queries) and per-user rate-limiting ($2,000\text{ms}$ cooldown) to prevent database overload from rapid querying.

### 3.5. Smart Alerting Engine & Webhooks
* **Custom Rule Builder:** Plain-English UI modal to create multi-condition alert rules across fields (`type`, `message`, `importance`, `environment`, `service`, `subsystem`, `operation`) using `equals` or `does not equal` operators.
* **Threshold & Window Evaluation:** Trigger alerts when $X$ matching logs occur within $Y\text{ minutes}$ (e.g., *"5 critical errors within 5 minutes"*).
* **Cooldown Periods:** Configurable wait times (e.g., $5\text{m}$, $10\text{m}$, $30\text{m}$) after an alert triggers to prevent notification spam.
* **Signed Webhook Delivery:** Sends HTTP `POST` requests to user-defined webhook URLs with an `HMAC-SHA256` cryptographic signature, timestamp, and sample log payload.

### 3.6. API Key Management
* **Structured Key Generation:** Keys follow the format `oml_<public_uuid>_<32_byte_secret>`.
* **Cryptographic Security:** The public UUID is used for fast indexing/lookup, while the full key is hashed using **Argon2id** in PostgreSQL and **HMAC-SHA256** in Redis. Plaintext keys are shown only once upon creation.
* **Lifecycle Controls:** Users can create up to $5\text{ active API keys}$, regenerate keys, revoke compromised keys (with instant cache invalidation), and track real-time `last_used_at` timestamps.

### 3.7. Live Overview Dashboard & System Telemetry
* **Real-Time KPIs:** Displays 24-hour log volume, error rates, active alerts, and live infrastructure telemetry via SSE (Ingestion Rate/sec, Average Ingestion Latency in ms, and NATS Queue Backlog).
* **Visual Analytics:** Top log sources, 24-hour activity charts, error trends, and recent triggered alerts.

---

## 4. System Architecture & Data Flow

```
[Client Application (Next.js / Node.js)]
       │
       ▼ (1. Batched Logs every 2s via @1minutelogs/next SDK)
[NestJS Ingestion API] ◄───► [Multi-Tier Cache: Local LRU (5m) ➔ Redis (6m) ➔ PostgreSQL]
       │                     (Validates AuthGuard & UsageGuard in 0-1ms)
       ▼ (2. Publishes to "logs.ingest")
[NATS JetStream Broker]
       │
       ▼ (3. Consumed by OML Logs Worker)
┌──────┴──────────────────────────────────────────────────────────┐
│                                                                 │
▼ (4a. Batch Insert)        ▼ (4b. Direct Broadcast)              ▼ (4c. Publishes "logs.alert.evaluate")
[ClickHouse DB]             [SSE Gateway Registry]                [NATS Alert Consumer]
(Historical Storage)        (Live Logs & Metrics UI)              (Evaluates Rules in Redis & Fires Webhooks)
```

### Multi-Tiered Caching & Sync Strategy
1. **Authentication (`AuthGuard`) & Quota Enforcement (`UsageGuard`):**
   * **Tier 1 (In-Memory LRU Cache):** Checks local server memory first ($5\text{min}$ TTL).
   * **Tier 2 (Redis Cache):** Falls back to Redis ($6\text{min}$ TTL) if not in local memory.
   * **Tier 3 (PostgreSQL / Neon):** Source of truth on cache miss; hydrates Redis and LRU caches.
   * **Spam Protection:** Invalid API keys or hard-locked accounts (exceeded quota) are flagged in Redis to block abusive requests immediately at the edge.
2. **Write-Behind Usage Synchronization:**
   * Instead of hitting PostgreSQL on every log ingestion, the NATS consumer increments `events_used` in Redis (`HINCRBY`) and adds the `user_id` to a Redis Set (`oml:usage:dirty:v1`).
   * A **NestJS Cron Scheduler (`UsageDbSync`)** runs every $5\text{ minutes}$, atomically renames the dirty set, and batch-updates PostgreSQL with the latest usage counts.

---

## 5. Technology Stack

| Layer | Technologies Used |
| :--- | :--- |
| **Frontend (Landing & Dashboard)** | Next.js (App Router), React 19, TypeScript, Tailwind CSS, TanStack React Query, Lucide Icons, Sonner (Toasts), `timeago.js` |
| **Backend Framework** | NestJS (Express platform), TypeScript, `@nestjs/schedule` (Cron jobs), `class-validator` |
| **Databases** | **PostgreSQL (Neon Serverless)** via **Drizzle ORM** (Users, Plans, Usage, API Keys, Invoices, Alerts)<br>**ClickHouse** (High-volume columnar log event storage)<br>**Redis (ioredis)** + **`lru-cache`** (Multi-tier caching, rate limiting, alert counters, dirty usage sets) |
| **Message Broker** | **NATS JetStream** (Durable event streaming for log ingestion & alert evaluation) |
| **Authentication & Billing** | **Clerk** (User auth, JWT verification, Organization support)<br>**Stripe** (Subscriptions, Checkout Sessions, Customer Portal, Webhooks) |
| **Security & Cryptography** | **Argon2** (`argon2id` for DB API key hashing), Node `crypto` (`HMAC-SHA256` for Redis digests & webhook signatures) |
| **DevOps & Testing** | Docker & Docker Compose (Redis, ClickHouse, ClickHouse UI, NATS), TestSprite (MCP Server for automated E2E/API testing) |

---

## 6. Database Schemas

### 6.1. PostgreSQL (Relational Data via Drizzle ORM)
* **`api_key`**: `id` (UUID/Public Key ID), `user_id`, `prefix` (first 18 chars), `value` (Argon2 hash), `created_at`, `last_used_at`, `revoked_at`.
* **`usage`**: `id`, `user_id`, `events_used` (BigInt), `events_limit` (BigInt), `created_at`, `updated_at`.
* **`plan`**: `id`, `user_id`, `name` (`free`, `starter`, `pro`, `business`), `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `created_at`, `updated_at`. *(Note: Free users do not have a row in the `plan` table to save DB storage).*
* **`payment_invoices`**: `id`, `user_id`, `stripe_customer_id`, `stripe_subscription_id`, `stripe_invoice_id`, `status`, `currency`, `amount_due` (BigInt), `amount_paid` (BigInt), `hosted_invoice_url`, `invoice_pdf`, `period_start`, `period_end`, `created_at`, `updated_at`.
* **`alerts`**: `id` (UUID), `user_id`, `name`, `app_name`, `conditions` (JSONB array of `{ field, operator, value }`), `threshold_count`, `threshold_window_minutes`, `webhook_url`, `cooldown_period`, `summary`, `status`, `last_triggered`, `created_at`, `updated_at`.

### 6.2. ClickHouse (Analytical Log Storage)
* **`logs.events`**:
  * **Identifiers:** `key_id` (String), `user_id` (String)
  * **LowCardinality Strings:** `type`, `app_name`, `environment` (optimized for fast filtering and reduced disk footprint)
  * **Strings & Nullable Fields:** `message`, `importance` (Nullable Int32: $1=\text{Low}, 2=\text{Medium}, 3=\text{High}, 4=\text{Critical}$), `subsystem`, `service`, `operation`, `track` (JSON string), `security` (JSON string), `metrics` (JSON string)
  * **Timestamps:** `timestamp` (DateTime), `ingested_at` (DateTime)
  * **Storage Engine:** `MergeTree()` partitioned monthly (`toYYYYMM(timestamp)`), ordered by `(timestamp, key_id)`, with a $30\text{-day}$ automatic deletion TTL.

---

## 7. Pricing & Subscription Tiers

Billing is managed via **Stripe Checkout** and **Stripe Customer Portal**, synchronized in real time via Stripe Webhooks (`checkout.session.completed`, `customer.subscription.created/updated`, `invoice.paid`, etc.).

| Tier | Price | Monthly Log Quota | Log Retention | Active Alerts | Key Features |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Free** | $\$0/\text{mo}$ | $10,000\text{ events}$ | $7\text{ days}$ | $0$ (Disabled) | Live stream, search, full SDK access, $100\text{ logs/batch}$ limit |
| **Starter** *(Popular)* | $\$9.99/\text{mo}$ | $100,000\text{ events}$ | $30\text{ days}$ | Up to $5$ | Webhook notifications, email support, full SDK access |
| **Pro** | $\$24.99/\text{mo}$ | $500,000\text{ events}$ | $60\text{ days}$ | Up to $12$ | Webhook notifications, priority email support, full SDK access |
| **Business** | $\$49.99/\text{mo}$ | $1,000,000\text{ events}$ | $90\text{ days}$ | Up to $20$ | High-volume ingestion, webhook notifications, dedicated support |

---

## 8. Infrastructure & Deployment Requirements
Because the backend stack runs memory-intensive, high-throughput services (**ClickHouse**, **NATS JetStream**, **Redis**, and **NestJS**), standard free-tier hobby hosting is insufficient for production:
* **Minimum Recommended Server Specs:** $16\text{ GB RAM}$, $200\text{--}320\text{ GB NVMe SSD}$, and $2\text{ TB+}$ bandwidth.
* **Recommended Providers:** Hetzner Dedicated/Cloud VPS or Hostinger VPS (using Docker Compose for self-managed services alongside Neon Serverless PostgreSQL).