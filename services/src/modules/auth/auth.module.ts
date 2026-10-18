import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { EmailService } from './email.service';
import { AuthRateGuard } from './rate.guard';
@Global()
@Module({
  imports: [JwtModule.registerAsync({ useFactory: () => {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 random characters');
    return { secret, signOptions: { algorithm: 'HS256' as const, issuer: 'tracebloom', audience: 'oml-dashboard', expiresIn: 900 },
      verifyOptions: { algorithms: ['HS256' as const], issuer: 'tracebloom', audience: 'oml-dashboard' } };
  } })],
  controllers: [AuthController], providers: [AuthService, EmailService, AuthRateGuard], exports: [AuthService],
})
export class AuthModule {}
