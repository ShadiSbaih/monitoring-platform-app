import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl && process.argv.some((argument) => argument.includes('push'))) {
  throw new Error('DATABASE_URL is required for db:push. Configure it in services/.env.');
}

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl ?? '',
  },
});
