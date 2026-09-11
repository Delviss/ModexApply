import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { PAYOUT_STATES, RefundSchema, TRANSACTION_KINDS, type AccessContext } from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions, RequireStepUp } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { FinanceConsoleService } from './finance-console.service.js';

const InitiateSchema = z.object({ rewardEntryId: z.string().min(1) });
const DecisionSchema = z.object({ note: z.string().trim().max(1_000).optional() });
const RejectSchema = z.object({ reason: z.string().trim().min(10).max(1_000) });
const PaidSchema = z.object({ externalRef: z.string().trim().min(1).max(200) });

/** The finance console (Phase 6 §4). */
@Controller({ path: 'admin/finance', version: '1' })
export class FinanceConsoleController {
  constructor(private readonly finance: FinanceConsoleService) {}

  @Get('transactions')
  @RequirePermissions('transaction:read')
  @RequireStepUp('console_entry')
  async transactions(@Query('kind') kind?: string) {
    return {
      data: await this.finance.transactions({
        kind: kind === undefined ? undefined : z.enum(TRANSACTION_KINDS).parse(kind),
      }),
    };
  }

  @Get('rewards')
  @RequirePermissions('reward:read')
  @RequireStepUp('console_entry')
  async rewards() {
    return { data: await this.finance.rewardQueue() };
  }

  @Get('payouts')
  @RequirePermissions('reward:read')
  @RequireStepUp('console_entry')
  async payouts(@Query('state') state?: string) {
    return {
      data: await this.finance.payouts(
        state === undefined ? undefined : z.enum(PAYOUT_STATES).parse(state),
      ),
    };
  }

  @Post('payouts')
  @RequirePermissions('payout:initiate')
  @RequireStepUp('console_entry')
  async initiate(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(InitiateSchema)) body: z.infer<typeof InitiateSchema>,
  ) {
    return this.finance.initiatePayout(access, body.rewardEntryId);
  }

  /** Its own step-up, because approving money is the point of the console. */
  @Post('payouts/:id/approve')
  @RequirePermissions('payout:approve')
  @RequireStepUp('payout_approval')
  async approve(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DecisionSchema)) body: z.infer<typeof DecisionSchema>,
  ) {
    return this.finance.approvePayout(access, id, body.note);
  }

  @Post('payouts/:id/reject')
  @RequirePermissions('payout:approve')
  @RequireStepUp('console_entry')
  async reject(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectSchema)) body: z.infer<typeof RejectSchema>,
  ) {
    return this.finance.rejectPayout(access, id, body.reason);
  }

  @Post('payouts/:id/paid')
  @RequirePermissions('payout:approve')
  @RequireStepUp('payout_approval')
  async markPaid(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PaidSchema)) body: z.infer<typeof PaidSchema>,
  ) {
    return this.finance.markPaid(access, id, body.externalRef);
  }

  @Post('refunds')
  @RequirePermissions('refund:write')
  @RequireStepUp('console_entry')
  async refund(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(RefundSchema)) body: z.infer<typeof RefundSchema>,
  ) {
    return this.finance.refund(access, body);
  }

  @Get('settlement')
  @RequirePermissions('transaction:read')
  @RequireStepUp('console_entry')
  async settlement(@Query('from') from?: string, @Query('to') to?: string) {
    const to_ = to === undefined ? new Date() : new Date(to);
    const from_ = from === undefined ? new Date(to_.getTime() - 30 * 86_400_000) : new Date(from);
    return this.finance.settlement(from_, to_);
  }
}
