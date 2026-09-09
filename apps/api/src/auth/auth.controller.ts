import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { CONSENT_SCOPES, type AccessContext } from '@modex/contracts';
import { AuthService } from './auth.service.js';
import { Actor, type AuthenticatedRequest } from './decorators/actor.decorator.js';
import { Public } from './decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { toAuditActor } from './audit-actor.js';

const RegisterSchema = z.object({
  email: z.email(),
  password: z.string(),
  displayName: z.string().min(2).max(120),
  role: z.enum(['student', 'guide']).optional(),
});

const LoginSchema = z.object({ email: z.email(), password: z.string() });
const RefreshSchema = z.object({ refreshToken: z.string().min(16) });
const ConsentSchema = z.object({
  scope: z.enum(CONSENT_SCOPES),
  subjectId: z.string().nullable().optional(),
  noticeVersion: z.string().min(1),
});

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body(new ZodValidationPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>) {
    return this.auth.register(body);
  }

  @Public()
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.login({
      ...body,
      ip: request.ip ?? null,
      userAgent: request.header('user-agent') ?? null,
    });
  }

  @Public()
  @Post('refresh')
  async refresh(@Body(new ZodValidationPipe(RefreshSchema)) body: z.infer<typeof RefreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  /** Device and session listing, so a student can see and cut off every login. */
  @Get('sessions')
  async sessions(@Actor() access: AccessContext) {
    return { data: await this.auth.listSessions(access.userId) };
  }

  @Delete('sessions/:id')
  async revokeSession(@Actor() access: AccessContext, @Param('id') id: string) {
    await this.auth.revokeSession(toAuditActor(access), access.userId, id);
    return { revoked: true };
  }

  @Post('consents')
  async grantConsent(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(ConsentSchema)) body: z.infer<typeof ConsentSchema>,
  ) {
    await this.auth.grantConsent(toAuditActor(access), access.userId, body.scope, {
      subjectId: body.subjectId ?? null,
      noticeVersion: body.noticeVersion,
    });
    return { granted: true };
  }

  @Delete('consents/:scope')
  async revokeConsent(@Actor() access: AccessContext, @Param('scope') scope: string) {
    const parsed = z.enum(CONSENT_SCOPES).parse(scope);
    await this.auth.revokeConsent(toAuditActor(access), access.userId, parsed);
    return { revoked: true };
  }
}
