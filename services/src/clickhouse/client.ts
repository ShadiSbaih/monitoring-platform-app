import 'dotenv/config';
import { createClient } from '@clickhouse/client';
import { CLICKHOUSE_DATABASE } from '../configs';

function validateClickHouseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('CLICKHOUSE_URL must be a valid HTTP or HTTPS URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('CLICKHOUSE_URL must use HTTP or HTTPS.');
  }
  return url.toString().replace(/\/$/, '');
}

export const clickhouseConfig = Object.freeze({
  url: validateClickHouseUrl(process.env.CLICKHOUSE_URL ?? 'http://localhost:8123'),
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DB ?? CLICKHOUSE_DATABASE,
});

export const clickhouseClient = createClient({
  ...clickhouseConfig,
});

export async function closeClickHouse(): Promise<void> {
  await clickhouseClient.close();
}
