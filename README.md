# 1 Minute Logs (OML)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-ea2845)](https://nestjs.com/)
[![ClickHouse](https://img.shields.io/badge/ClickHouse-Production_Ready-yellw)](https://clickhouse.com/)

## Executive Summary
**1 Minute Logs (OML)** is a production-ready, real-time application monitoring and log management SaaS platform designed for early-stage startups, independent developers, and agile engineering teams.

Unlike traditional observability stacks (e.g., Datadog, ELK) that require complex YAML configurations, heavy infrastructure overhead, and steep learning curves, OML provides a zero-configuration, affordable, and high-throughput logging platform. By integrating a lightweight SDK, developers can begin streaming, querying, and alerting on production logs in **under one minute**.

## Architecture & Performance
OML is built upon a high-performance, event-driven distributed architecture designed to ingest millions of events while keeping validation, latency, and query times to an absolute minimum.

- **Ingestion Capacity:** Capable of handling $2\text{M+}$ logs per minute using client-side batching and NATS JetStream durable work queues.
- **Instant Search:** Leverages ClickHouse `MergeTree` bulk columnar storage and `LowCardinality` indexing to achieve $< 15\text{ms}$ average query latencies.
- **Live Tailing:** Direct Worker-to-SSE (Server-Sent Events) broadcasting ensures zero-latency live streaming, completely bypassing database polling overhead.
- **Authentication Latency:** Achieves $0\text{--}1\text{ms}$ validation latency via multi-tier caching (Redis LRU policies and debounced writes).

## Key Features
1. **Under 1-Minute Integration:** Simply install the `@oneminutelogs/next` package, initialize with your API key, and start streaming structured logs and security events immediately.
2. **High-Throughput Event Architecture:** Robust pipeline backed by NATS JetStream and ClickHouse.
3. **Smart Alerting:** Configurable, automated webhooks and alerts.
4. **Multi-Tier SaaS Economics:** Built-in safeguards (e.g., bounded Redis RAM usage, ClickHouse `30 DAY DELETE` TTL policies) for cost-effective scale.

## Repository Structure
The project is built as a monorepo consisting of the following core components:

```text
.
├── apps/
│   ├── landing-page/          # Next.js Marketing + Authentication Portal (Port 3000)
│   └── main-dashboard/        # Next.js SaaS Application Dashboard (Port 3001)
├── services/                  # NestJS Event-Driven Backend Services + Workers (Port 8080)
│   ├── src/                   # Backend modules, queues, and logic
│   └── docker-compose.yml     # Infrastructure (Redis, ClickHouse, NATS)
├── sdks/
│   └── oneminutelogs-next/    # Next.js / Node drop-in SDK
└── docs/                      # Technical specs, architecture outlines, and product guides
```

## Setup & Installation

### Prerequisites
- Node.js >= 18.0.0
- Docker & Docker Compose
- NPM or Yarn

### 1. Environment Variables
You must configure the required environment variables. Create a `.env` file in the relevant subdirectories (`apps/main-dashboard`, `apps/landing-page`, and `services`).

Below are key variables typically required across the platform:

```env
# Infrastructure (Services / Workers)
REDIS_URL=redis://localhost:6379
CLICKHOUSE_URL=http://localhost:8123
NATS_URL=nats://localhost:4222

# Authentication & SaaS
CLERK_SECRET_KEY=your_clerk_secret
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_public
STRIPE_SECRET_KEY=your_stripe_secret
```
*(Please consult individual service directories for exhaustive `.env.example` configurations).*

### 2. Run Local Infrastructure
Start the backing state stores and event buses via Docker Compose:
```bash
cd services
docker-compose up -d
```
*This provisions Redis, ClickHouse, ClickHouse UI, and NATS JetStream locally.*

### 3. Install Dependencies & Start
From the repository root, install dependencies for all workspaces:
```bash
npm install
```

Start the primary applications:
```bash
# Start Backend Services
cd services
npm run start:dev &

# Start Marketing / Auth Portal
cd ../apps/landing-page
npm run dev &

# Start Main SaaS Dashboard
cd ../main-dashboard
npm run dev &
```

## Documentation
For extensive system specifications, epic tracking, product vision, and agent instructions, please refer to the `docs/` directory:
- [Product Specifications](docs/Product.md)
- [Architecture & Epics](docs/SPECS_AND_EPICS.md)
- [Agent & Autonomous Development Guide](docs/AGENTS.md)
- [Progress Tracker](docs/PROGRESS.md)

---
*Built for scale, designed for speed. 1 Minute Logs is the simplest way to observe your production environments.*
