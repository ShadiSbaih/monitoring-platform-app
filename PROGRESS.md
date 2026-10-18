# 1 Minute Logs Engineering Progress

Source of truth: `AGENTS.md` and `SPECS_AND_EPICS.md`.

## Epic 1: Monorepo Foundation, Authentication (Clerk) & Local Infrastructure

- [x] Epic 1.1: Landing Page Clerk Authentication & User Header Integration
- [x] Epic 1.2: Docker Compose Infrastructure Setup (Redis, ClickHouse, CH-UI, NATS JetStream)
- [x] Epic 1.3: NestJS Service Bootstrap, Global Pipes, Filters & Database/Cache Modules

## Epic 2: API Key Management & High-Speed Multi-Tier AuthGuard

- [x] Epic 2.1: API Key Service & Controller (`services/src/modules/api-key`)
- [x] Epic 2.2: Multi-Tier AuthGuard (`services/src/guards/auth.guard.ts`)
- [x] Epic 2.3: Dashboard API Keys UI (`apps/main-dashboard/app/api-keys/page.tsx`)

## Epic 3: `@oneminutelogs/next` TypeScript SDK

- [x] Epic 3.1: SDK Types & Core Logger Factory (`sdks/oneminutelogs-next`)
- [x] Epic 3.2: Batched Transport & Graceful Shutdown (`sdks/oneminutelogs-next/src/utils/index.ts`)
- [x] Epic 3.3: React Client Hooks (`getLogs` & `getStream`) (`sdks/oneminutelogs-next/src/utils/`)

## Epic 4: Log Ingestion Pipeline, NATS JetStream, ClickHouse & Live SSE

- [x] Epic 4.1: ClickHouse Client, Schema Init & NATS JetStream Producer
- [x] Epic 4.2: NATS Logs Consumer Worker & SSE Registry
- [x] Epic 4.3: Logs Controller, Query DSL Parser, SSE Stream & Live Metrics SSE

## Epic 5: Usage Guard, Quota Enforcement & Background DB Sync Scheduler

- [x] Epic 5.1: UsageGuard (`services/src/guards/usage.guard.ts`)
- [x] Epic 5.2: 5-Minute Usage Database Sync Cron Scheduler

## Epic 6: SaaS Billing, Stripe Subscriptions, Webhooks & Invoices

- [x] Epic 6.1: Billing Service & Stripe Session/Portal Creation
- [x] Epic 6.2: Stripe Webhook Handler, Plan Activation & Invoice Persistence
- [x] Epic 6.3: Dashboard Settings, Pricing Grid, Sidebar Plan Badge & Invoices UI

## Epic 7: Event-Driven Smart Alerting Engine & Signed Webhooks

- [x] Epic 7.1: Alert Service, Tier Quotas, Form Validation & Persistent Redis Cache
- [x] Epic 7.2: NATS JetStream Alert Consumer Worker
- [x] Epic 7.3: Dashboard Alerts Page & 4-Step Rule Builder Modal

## Epic 8: Main Dashboard Overview & Live System Telemetry

- [x] Epic 8.1: Next.js API Proxies & Overview Page

## Current Active Ticket

All listed tickets complete.

## Known Blockers / Notes

- Epic 1 is complete. Epic 1.1 adds Clerk sign-in/sign-up, authenticated account actions, organization selection/creation, and a browser-local demo auth path for environments without Clerk credentials.
- To enable live Clerk authentication, configure the dashboard providers and keys described in `apps/landing-page/CLERK_SETUP.md` and `apps/landing-page/.env.example`.
- Verification passed: `apps/landing-page` `npx tsc --noEmit`, `apps/landing-page` `npm run build`, and `services` `npm run build`.
- Compose is running. The current `ch-ui:latest` image listens internally on port 3488, so host port 5521 maps to container port 3488; its HTTP GET returns 200.
- `services` database schema generation completed. A live `db:push` still requires `DATABASE_URL`; use mocked behaviors/data where a live Neon connection is unavailable.
- Epic 2.1 implemented authenticated API key CRUD, one-time key creation/regeneration, ownership scoped revocation, and immediate L1/L2 cache eviction. `services` `npm run build` and `npx tsc --noEmit -p tsconfig.json` passed; live endpoint checks require local Redis and `DATABASE_URL`.
- Epic 2.2 implements API key parsing and HMAC digest helpers, 5-minute L1 caching, 10-minute Redis digest/negative caches, Argon2id verification, 60-second last-used debounce, and Clerk bearer verification. Service build and typecheck passed. Use a configured `REDIS_KEY_SECRET` and Clerk secret for live auth checks.
- Epic 2.3 adds the TanStack Query provider and authenticated API key management UI with one-time secret reveal, key details, relative timestamps, and specific-key revocation. Dashboard `npx tsc --noEmit` and `npm run build` passed. Dashboard lockfile was repaired by `npm install` because the initial lockfile was inconsistent; React DayPicker's v10 `month_grid` class key and asset module declarations now typecheck cleanly.
- Epic 3.1 adds the SDK package build configuration, public types, logger factory, and ESM/declaration output. `sdks/oneminutelogs-next` `npm run build` passed.
- Epic 3.2 implements the two-second batch buffer, retry-on-failed-flush, shutdown flush handlers, historical log fetch, streamed SSE proxy, and webhook verification request. `sdks/oneminutelogs-next` `npm run build` passed.
- Epic 3.3 implements `getLogs` request caching/deduplication and the EventSource `getStream` hook with normalized log entries and the 5,000 row cap. SDK build and dashboard typecheck/build passed; SDK `npm link` and dashboard link resolution to the built entry succeeded.
- Epic 4.1 validates ClickHouse URL/configuration, ensures the database/table DDL matches the required monthly partition/order/TTL, normalizes NATS stream subjects, and adds JetStream batch publishing on `logs.ingest`. Service build and typecheck passed.
- Epic 4.2 adds the durable JetStream ingest consumer, ClickHouse bulk insert, latency/backlog Redis metrics, usage counter updates, alert-evaluation publishing, SSE filtering/chunking, and automatic worker startup/shutdown wiring. Service build and typecheck passed.
- Epic 4.3 adds guarded asynchronous batch ingestion, synchronous query DSL parsing with parameterized ClickHouse filters and query/result caches, initial/live log SSE, Redis-backed metrics SSE, authenticated dashboard API proxies, a mock-capable log smoke-test route, and SDK-backed Live Logs and Queries pages. Dashboard `npx tsc --noEmit`, dashboard `npm run build`, service `npx tsc --noEmit -p tsconfig.json`, and service `npm run build` passed. Turbopack now resolves the local SDK from the monorepo root via `apps/main-dashboard/next.config.ts`.
- Epic 5.1 implements hard-lock enforcement, cached plan and usage resolution, implicit Free plan defaults, first-time `usage` row initialization with conflict protection, and quota rejection. Service `npx tsc --noEmit -p tsconfig.json` and `npm run build` passed.
- Epic 5.2 adds a five-minute `UsageDbSync` cron job that atomically renames the dirty set, persists Redis usage counts to PostgreSQL, requeues failed users, and cleans up its processing set. Service typecheck and build passed.
- Epic 6.1 adds authenticated current-plan, Checkout, Billing Portal, and invoice endpoints. Stripe customer resolution uses Clerk email and reuses database/Stripe customers; local mock URLs and invoice data support environments without Stripe, Clerk, or Neon credentials. Service typecheck and build passed.
- Epic 6.2 verifies Stripe webhook signatures against Nest's raw request body, processes checkout, subscription, and invoice events, updates plan and usage data across PostgreSQL/Redis/L1 caches, and upserts invoice records. The no-Stripe configuration returns an explicit local mock response; service typecheck and build passed. Epic 5.1 also has mock Free plan and usage resolution when `DATABASE_URL` is absent.
- Epic 6.3 replaces the billing mock screen with a four-column Free/Starter/Pro/Business pricing grid, dynamic Popular and active-plan states, Checkout and Billing Portal mutations, invoice history/PDF downloads, and a live sidebar plan badge. An authenticated `/api/v1` proxy includes local mock plan, checkout, and invoice data without Clerk configuration. Dashboard typecheck and production build passed.
- Epic 7.1 adds alert CRUD, strict field/operator/threshold/URL/cooldown validation, tier quotas, persistent Redis list caching with invalidation after create/delete, and the paid-plan 60-second HMAC-SHA256 verification endpoint. A local in-process store and mock verification mode cover environments without Neon/signing credentials. Service typecheck and build passed.
- Epic 7.2 adds the durable `oml_alert_consumer` on `logs.alert.evaluate`, groups batches by user, reads only persistent Redis alert rules, maps numeric importance to text, counts threshold windows, applies cooldowns, signs webhook calls with a 5-second timeout, and updates last-triggered state in Redis/PostgreSQL. Missing signing configuration simulates delivery locally. Service typecheck and build passed.
- Epic 7.3 replaces the static Alerts page with alert statistics, searchable/status-filtered rules, deletion, plan-gated creation, and a four-step rule builder with condition editing and live summary preview. The root layout now mounts Sonner's Toaster; mock alert API paths support local paid-plan mode. Dashboard typecheck and production build passed.
- Epic 8.1 adds authenticated live-metrics SSE and 24-hour log JSON proxies, mock streams/data for local use, error-count aggregation, and a live overview with six metric cards, log/error charts, top sources, 16 latest activities, and four recent alerts. Final `services` typecheck/build and `apps/main-dashboard` typecheck/build passed.
- All Epic 1–8 tickets listed above are checked. Live Clerk, Neon, Stripe, and outbound webhook flows still require configured external credentials; local mock paths cover dashboard and no-credential development flows.
