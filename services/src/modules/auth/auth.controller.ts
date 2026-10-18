import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { EmailDto, LoginDto, RefreshDto, ResetDto, SignupDto, TokenDto } from './auth.dto';
import { AuthRateGuard } from './rate.guard';
@Controller('auth')
@UseGuards(AuthRateGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('signup') signup(@Body() body: SignupDto) { return this.auth.signup(body); }
  @Post('login') login(@Body() body: LoginDto) { return this.auth.login(body.email, body.password); }
  @Post('refresh') refresh(@Body() body: RefreshDto) { return this.auth.refresh(body.refreshToken); }
  @Post('logout') logout(@Body() body: RefreshDto) { return this.auth.logout(body.refreshToken); }
  @Get('me') me(@Headers('authorization') value?: string) { return this.auth.me(value?.replace(/^Bearer /i, '') ?? ''); }
  @Post('forgot-password') forgot(@Body() body: EmailDto) { return this.auth.requestEmail(body.email, 'reset'); }
  @Post('resend-verification') resend(@Body() body: EmailDto) { return this.auth.requestEmail(body.email, 'verify'); }
  @Post('verify-email') verify(@Body() body: TokenDto) { return this.auth.consumeToken(body.token, 'verify'); }
  @Post('reset-password') reset(@Body() body: ResetDto) { return this.auth.consumeToken(body.token, 'reset', body.password); }
}
