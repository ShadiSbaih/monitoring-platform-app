import 'dotenv/config';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

neonConfig.webSocketConstructor = ws;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 });
pool.on('error', (error: Error) => {
  console.error('Neon PostgreSQL pool error', error);
});

export const db = drizzle(pool, { schema });
export type DrizzleDatabase = typeof db;

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
