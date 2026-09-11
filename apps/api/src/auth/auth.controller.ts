import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { CONSENT_SCOPES, STEP_UP_ACTIONS, type AccessContext } from '@modex/contracts';
import { AuthService } from './auth.service.js';
import { Actor, type AuthenticatedRequest } from './decorators/actor.decorator.js';
import { AllowPendingMfa, Public } from './decorators/access.decorators.js';
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
const MfaCodeSchema = z.object({ code: z.string().trim().min(6).max(8) });
const StepUpSchema = MfaCodeSchema.extend({
  action: z.enum(STEP_UP_ACTIONS).default('console_entry'),
});
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

  // -------------------------------------------------------------------------
  // Multi-factor authentication (Phase 0 §3.2) and step-up (Phase 6 §2)
  // -------------------------------------------------------------------------

  /**
   * Starts enrolment. The secret comes back once, for the authenticator app.
   *
   * `@AllowPendingMfa` because a staff account that has never enrolled cannot
   * satisfy MFA, and would otherwise be unable to reach the route that fixes
   * that — the first staff login of a new account would be unrecoverable.
   */
  @AllowPendingMfa()
  @Post('mfa/enrol')
  async beginMfaEnrolment(@Actor() access: AccessContext) {
    // No audit event: starting an enrolment changes nothing and grants nothing.
    // Confirming it does, and that is what `user.mfa_enrolled` records.
    return this.auth.beginMfaEnrolment(access.userId);
  }

  @AllowPendingMfa()
  @Post('mfa/enrol/confirm')
  async confirmMfaEnrolment(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(MfaCodeSchema)) body: z.infer<typeof MfaCodeSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.auth.confirmMfaEnrolment(
      toAuditActor(access, { ip: request.ip, userAgent: request.header('user-agent') }),
      access.userId,
      body.code,
    );
    return { enrolled: true };
  }

  /** The login challenge. Upgrades this session to MFA-satisfied. */
  @AllowPendingMfa()
  @Post('mfa/challenge')
  async challengeMfa(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(MfaCodeSchema)) body: z.infer<typeof MfaCodeSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.satisfyMfa(
      toAuditActor(access, { ip: request.ip, userAgent: request.header('user-agent') }),
      { sessionId: access.sessionId, userId: access.userId, code: body.code },
    );
  }

  /** Step-up: the same factor, asked again, for a console or a sanction. */
  @Post('step-up')
  async stepUp(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(StepUpSchema)) body: z.infer<typeof StepUpSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.stepUp(
      toAuditActor(access, { ip: request.ip, userAgent: request.header('user-agent') }),
      {
        sessionId: access.sessionId,
        userId: access.userId,
        code: body.code,
        action: body.action,
      },
    );
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
