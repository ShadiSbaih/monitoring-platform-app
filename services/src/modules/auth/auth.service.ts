import { createHash, createHmac, randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { and, eq, gt, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../configs';
import type { DrizzleDatabase } from '../../database/client';
import { users, sessions, emailTokens } from '../../database/schema';
import { EmailService } from './email.service';

export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export type PublicUser = { id: string; email: string; name: string; email_verified: boolean };
const publicUser = (user: typeof users.$inferSelect): PublicUser => ({
  id: user.id, email: user.email, name: user.name, email_verified: user.email_verified,
});
@Injectable()
export class AuthService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    private readonly jwt: JwtService, private readonly email: EmailService) {}
  async signup(input: { email: string; password: string; name: string }) {
    if (input.password.length < 12) throw new BadRequestException('Use a password with at least 12 characters');
    const address = input.email.trim().toLowerCase();
    const hash = await argon2.hash(input.password, { type: argon2.argon2id });
    const [user] = await this.db.insert(users).values({
      email: address, name: input.name.trim(), password_hash: hash,
    }).onConflictDoNothing().returning();
    // Existing addresses get the same response; recovery/resend handles ownership.
    if (user) await this.sendToken(user.id, address, 'verify');
    return { message: 'Check your email to verify your account. You can request a new verification email if needed.' };
  }
  async login(email: string, password: string) {
    const [user] = await this.db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
    if (!user || !await argon2.verify(user.password_hash, password)) throw new UnauthorizedException('Invalid email or password');
    if (!user.email_verified) throw new ForbiddenException('Verify your email before signing in');
    return this.createSession(user);
  }
  async verifyAccess(token: string): Promise<{ id: string }> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; ver: number }>(token);
      const [user] = await this.db.select({ id: users.id, version: users.token_version }).from(users).where(eq(users.id, claims.sub)).limit(1);
      if (!user || user.version !== claims.ver) throw new Error('Revoked');
      return { id: user.id };
    } catch { throw new UnauthorizedException('Session expired'); }
  }
  async me(token: string) {
    const identity = await this.verifyAccess(token);
    const [user] = await this.db.select().from(users).where(eq(users.id, identity.id)).limit(1);
    return publicUser(user);
  }
  async refresh(token: string) {
    return this.db.transaction(async tx => {
      const [session] = await tx.select().from(sessions).where(and(
        eq(sessions.token_hash, tokenHash(token)), gt(sessions.expires_at, new Date()),
      )).limit(1).for('update');
      if (!session) throw new UnauthorizedException('Session expired');
      const [user] = await tx.select().from(users).where(eq(users.id, session.user_id)).limit(1);
      // A short grace period makes parallel requests on separate frontend instances
      // receive the same rotated token instead of invalidating each other's session.
      const refreshToken = createHmac('sha512', process.env.JWT_SECRET!).update('refresh:' + token).digest('base64url');
      if (session.rotated_at) {
        if (Date.now() - session.rotated_at.getTime() > 10_000) throw new UnauthorizedException('Session expired');
        const [next] = await tx.select().from(sessions).where(eq(sessions.token_hash, tokenHash(refreshToken))).limit(1);
        if (!next) throw new UnauthorizedException('Session expired');
      } else {
        await tx.update(sessions).set({ rotated_at: new Date(), expires_at: new Date(Date.now() + 10_000) }).where(eq(sessions.id, session.id));
        await tx.insert(sessions).values({ user_id: user.id, token_hash: tokenHash(refreshToken),
          expires_at: new Date(Date.now() + 30 * 86_400_000) });
      }
      return { user: publicUser(user), refreshToken, accessToken: await this.sign(user) };
    });
  }
  async logout(token: string) { await this.db.delete(sessions).where(eq(sessions.token_hash, tokenHash(token))); return { success: true }; }
  async requestEmail(email: string, purpose: 'verify' | 'reset') {
    const [user] = await this.db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
    if (user && (purpose === 'reset' || !user.email_verified)) await this.sendToken(user.id, user.email, purpose);
    return { message: 'If an eligible account exists, an email has been sent.' };
  }
  async consumeToken(token: string, purpose: 'verify' | 'reset', password?: string) {
    const passwordHash = password ? await argon2.hash(password, { type: argon2.argon2id }) : undefined;
    await this.db.transaction(async tx => {
      const [record] = await tx.delete(emailTokens).where(and(
        eq(emailTokens.token_hash, tokenHash(token)), eq(emailTokens.purpose, purpose),
        gt(emailTokens.expires_at, new Date()),
      )).returning();
      if (!record) throw new BadRequestException('This link is invalid or expired');
      if (purpose === 'verify') await tx.update(users).set({ email_verified: true }).where(eq(users.id, record.user_id));
      else {
        await tx.update(users).set({ password_hash: passwordHash!, token_version: sql`${users.token_version} + 1` }).where(eq(users.id, record.user_id));
        await tx.delete(sessions).where(eq(sessions.user_id, record.user_id));
        await tx.delete(emailTokens).where(eq(emailTokens.user_id, record.user_id));
      }
    });
    return { message: purpose === 'verify' ? 'Email verified. You can sign in.' : 'Password changed. Sign in with your new password.' };
  }
  private async sendToken(userId: string, email: string, purpose: 'verify' | 'reset') {
    const token = randomBytes(48).toString('base64url');
    await this.db.delete(emailTokens).where(and(eq(emailTokens.user_id, userId), eq(emailTokens.purpose, purpose)));
    await this.db.insert(emailTokens).values({ user_id: userId, purpose, token_hash: tokenHash(token),
      expires_at: new Date(Date.now() + (purpose === 'verify' ? 86_400_000 : 1_800_000)) });
    await this.email.send(email, purpose, token);
  }
  private sign(user: typeof users.$inferSelect) { return this.jwt.signAsync({ sub: user.id, ver: user.token_version }); }
  private async createSession(user: typeof users.$inferSelect) {
    const refreshToken = randomBytes(48).toString('base64url');
    await this.db.insert(sessions).values({ user_id: user.id, token_hash: tokenHash(refreshToken), expires_at: new Date(Date.now() + 30 * 86_400_000) });
    return { user: publicUser(user), accessToken: await this.sign(user), refreshToken };
  }
}
