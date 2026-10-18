import { Global, Module } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { LRU_CACHE, LRU_CACHE_MAX_ENTRIES, LRU_SOFT_TTL_MS } from '../configs';

export const localCache = new LRUCache<string, object>({
  max: LRU_CACHE_MAX_ENTRIES,
  ttl: LRU_SOFT_TTL_MS,
  updateAgeOnGet: true,
  updateAgeOnHas: false,
  allowStale: false,
});

@Global()
@Module({
  providers: [
    {
      provide: LRU_CACHE,
      useValue: localCache,
    },
  ],
  exports: [LRU_CACHE],
})
export class CacheModule {}
