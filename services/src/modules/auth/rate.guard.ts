import { createHash } from 'node:crypto';
import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { redisClient } from '../../infra/redis.module';
const SCRIPT = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],600) end; return n";
@Injectable()
export class AuthRateGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.method === 'GET') return true;
    const ip = createHash('sha256').update(String(req.ip ?? 'unknown')).digest('hex').slice(0, 24);
    const count = await redisClient.eval<number>(SCRIPT, ['oml:auth:rate:' + ip]);
    if (count > 30) throw new HttpException('Too many authentication attempts. Try again in 10 minutes.', 429);
    // Account-level throttling survives attempts from different IP addresses.
    const email = req.body?.email;
    if (typeof email === 'string') {
      const key = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
      if (await redisClient.eval<number>(SCRIPT, ['oml:auth:email:' + key]) > 10) throw new HttpException('Too many attempts for this account. Try again in 10 minutes.', 429);
    }
    return true;
  }
}
