import { Global, Module } from '@nestjs/common';
import { DRIZZLE_DB } from '../configs';
import { db } from './client';

@Global()
@Module({
  providers: [{ provide: DRIZZLE_DB, useValue: db }],
  exports: [DRIZZLE_DB],
})
export class DatabaseModule {}
