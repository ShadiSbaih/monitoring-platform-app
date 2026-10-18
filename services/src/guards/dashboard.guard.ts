import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
@Injectable()
export class DashboardGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest().user;
    if (!user || user.keyId) throw new ForbiddenException('Sign in to manage your account');
    return true;
  }
}
