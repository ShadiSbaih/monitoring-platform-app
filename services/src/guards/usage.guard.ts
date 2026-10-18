import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { redisClient } from '../infra/redis.module';
import { REDIS_KEYS } from '../configs';
@Injectable()
export class UsageGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (!req.user?.id || await redisClient.exists(REDIS_KEYS.hardLock(req.user.id))) throw new ForbiddenException('Ingestion is unavailable for this account');
    return true;
  }
}
