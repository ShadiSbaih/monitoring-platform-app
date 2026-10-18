import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Neon pooled URLs are for application traffic. Drizzle migrations should use
// the direct URL when env pull has provided it, while retaining DATABASE_URL
// as a fallback for existing local setups.
const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!databaseUrl && process.argv.some((argument) => argument.includes('push'))) {
  throw new Error('DATABASE_URL or DATABASE_URL_UNPOOLED is required for db:push. Configure it in services/.env.');
}

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl ?? '',
  },
});
