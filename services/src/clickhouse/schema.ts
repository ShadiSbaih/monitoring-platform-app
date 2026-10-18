import { clickhouseClient } from './client';

export async function createLogsTable(): Promise<void> {
  await clickhouseClient.command({
    query: 'CREATE DATABASE IF NOT EXISTS logs',
    clickhouse_settings: { wait_end_of_query: 1 },
  });

  await clickhouseClient.command({
    query: `
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
      SETTINGS index_granularity = 8192
    `,
    clickhouse_settings: { wait_end_of_query: 1 },
  });
}
