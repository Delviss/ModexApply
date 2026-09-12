import { Injectable } from '@nestjs/common';
import {
  checkDualApproval,
  isRefundable,
  requiresDualApproval,
  type AccessContext,
  type RefundReasonCode,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { currentContext } from '../common/observability/request-context.js';

/**
 * The finance console (Phase 6 §4).
 *
 * Two rules are enforced here and nowhere else, and both are the sort that
 * quietly stop being true if they live only in a UI.
 *
 * **One actor cannot both start and finish a high-value payout.** Checked
 * server-side against `initiatedBy`, by identity. The console renders the same
 * rule as a disabled button with the reason on it, but the button is a
 * courtesy; this is the control.
 *
 * **A guide's reward never depends on an application outcome** (Phase 3 §5).
 * There is no join in this file between a payout and an application, and there
 * is no column to make one with. A payout traces to a completed *session*, and
 * stops there.
 */
@Injectable()
export class FinanceConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Modex's own money. Tuition is not here and has no column to be in. */
  async transactions(filters: { kind?: 'service_payment' | 'service_refund' | 'guide_payout' } = {}) {
    return this.prisma.modexTransaction.findMany({
      where: filters.kind === undefined ? {} : { kind: filters.kind },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { refunds: true },
    });
  }

  /** Rewards earned and not yet paid — the queue a payout is started from. */
  async rewardQueue() {
    const entries = await this.prisma.guideRewardEntry.findMany({
      where: { state: { in: ['earned', 'approved'] } },
      orderBy: { earnedAt: 'asc' },
      take: 200,
      include: {
        payouts: true,
        session: { select: { id: true, status: true, completedAt: true } },
      },
    });

    return entries.map((entry) => ({
      id: entry.id,
      guideId: entry.guideId,
      kind: entry.kind,
      state: entry.state,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      earnedAt: entry.earnedAt?.toISOString() ?? null,
      sessionStatus: entry.session?.status ?? null,
      sessionCompletedAt: entry.session?.completedAt?.toISOString() ?? null,
      payout: entry.payouts[0] ?? null,
      needsDualApproval:
        entry.amountMinor !== null &&
        entry.currency !== null &&
        requiresDualApproval(entry.amountMinor, entry.currency),
    }));
  }

  /**
   * Starts a payout.
   *
   * Refuses a reward whose session was never completed. The reward ledger is
   * the source of truth for *whether* something was earned; this is the check
   * that the thing it was earned for actually happened.
   */
  async initiatePayout(access: AccessContext, rewardEntryId: string) {
    const entry = await this.prisma.guideRewardEntry.findUnique({
      where: { id: rewardEntryId },
      include: { payouts: true, session: { select: { status: true } } },
    });
    if (entry === null) throw AppError.notFound('Reward');
    if (entry.payouts.length > 0) {
      throw new AppError('conflict', 'A payout already exists for this reward.');
    }
    if (entry.amountMinor === null || entry.currency === null) {
      throw new AppError(
        'precondition_failed',
        'This reward has no cash value — a certificate is not paid out.',
      );
    }
    if (entry.state !== 'earned' && entry.state !== 'approved') {
      throw new AppError('precondition_failed', `A reward in state ${entry.state} is not payable.`);
    }
    if (entry.session !== null && entry.session.status !== 'completed') {
      throw new AppError(
        'precondition_failed',
        'The session behind this reward is not completed.',
      );
    }

    const correlationId = currentContext()?.correlationId ?? 'admin';
    const payout = await this.prisma.payout.create({
      data: {
        rewardEntryId,
        guideId: entry.guideId,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        initiatedBy: access.userId,
        correlationId,
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'payout.initiated',
      objectType: 'payout',
      objectId: payout.id,
      correlationId,
      metadata: {
        rewardEntryId,
        guideId: entry.guideId,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        requiresDualApproval: requiresDualApproval(entry.amountMinor, entry.currency),
      },
    });

    return payout;
  }

  /**
   * Approves one — **the dual-approval control.**
   *
   * The refusal is deliberately specific ("you initiated this payout") rather
   * than a generic forbidden: an operator who cannot tell why they were refused
   * will assume a bug and ask for the check to be removed.
   */
  async approvePayout(access: AccessContext, payoutId: string, note?: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (payout === null) throw AppError.notFound('Payout');
    if (payout.state !== 'pending_approval') {
      throw new AppError('conflict', `This payout is already ${payout.state}.`);
    }

    const check = checkDualApproval({
      amountMinor: payout.amountMinor,
      currency: payout.currency,
      initiatedBy: payout.initiatedBy,
      approverId: access.userId,
    });
    if (!check.ok) throw AppError.forbidden(check.reason ?? 'This payout needs a second approver.');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payout.update({
        where: { id: payoutId },
        data: {
          state: 'approved',
          approvedBy: access.userId,
          approvedAt: new Date(),
          decisionNote: note ?? null,
        },
      });
      await tx.guideRewardEntry.update({
        where: { id: payout.rewardEntryId },
        data: { state: 'approved', approvedAt: new Date() },
      });
      return result;
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'payout.approved',
      objectType: 'payout',
      objectId: payoutId,
      metadata: {
        initiatedBy: payout.initiatedBy,
        approvedBy: access.userId,
        amountMinor: payout.amountMinor,
        currency: payout.currency,
        note: note ?? null,
      },
    });

    return updated;
  }

  async rejectPayout(access: AccessContext, payoutId: string, reason: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (payout === null) throw AppError.notFound('Payout');
    if (payout.state !== 'pending_approval') {
      throw new AppError('conflict', `This payout is already ${payout.state}.`);
    }

    const updated = await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        state: 'rejected',
        rejectedBy: access.userId,
        rejectedAt: new Date(),
        decisionNote: reason,
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'payout.rejected',
      objectType: 'payout',
      objectId: payoutId,
      metadata: { reason, initiatedBy: payout.initiatedBy },
    });

    return updated;
  }

  /**
   * Marks an approved payout paid and writes the transaction.
   *
   * The transaction row and the state change are one transaction: a payout
   * marked paid with no money record, or money recorded against a payout that
   * still reads pending, are both worse than either failing outright.
   */
  async markPaid(access: AccessContext, payoutId: string, externalRef: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (payout === null) throw AppError.notFound('Payout');
    if (payout.state !== 'approved') {
      throw new AppError('precondition_failed', 'Only an approved payout can be paid.');
    }

    const correlationId = currentContext()?.correlationId ?? 'admin';
    const guide = await this.prisma.studentGuide.findUnique({
      where: { id: payout.guideId },
      select: { userId: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.modexTransaction.create({
        data: {
          kind: 'guide_payout',
          state: 'settled',
          amountMinor: payout.amountMinor,
          currency: payout.currency,
          externalRef,
          subjectUserId: guide?.userId ?? null,
          description: `Guide reward payout ${payout.id}`,
          correlationId,
          settledAt: new Date(),
        },
      });
      const updated = await tx.payout.update({
        where: { id: payoutId },
        data: { state: 'paid', paidAt: new Date(), transactionId: transaction.id },
      });
      await tx.guideRewardEntry.update({
        where: { id: payout.rewardEntryId },
        data: { state: 'paid', paidAt: new Date() },
      });
      return { payout: updated, transaction };
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'payout.paid',
      objectType: 'payout',
      objectId: payoutId,
      correlationId,
      metadata: {
        transactionId: result.transaction.id,
        externalRef,
        amountMinor: payout.amountMinor,
        currency: payout.currency,
      },
    });

    return result;
  }

  /**
   * Refunds a Modex service payment.
   *
   * Refuses anything else, and refuses to refund more than is left. Tuition
   * cannot be refunded here because Modex never held it — a refund against
   * money we did not take is a promise we cannot keep.
   */
  async refund(
    access: AccessContext,
    input: { transactionId: string; amountMinor: number; reasonCode: RefundReasonCode; reason: string },
  ) {
    const transaction = await this.prisma.modexTransaction.findUnique({
      where: { id: input.transactionId },
      include: { refunds: true },
    });
    if (transaction === null) throw AppError.notFound('Transaction');
    if (!isRefundable(transaction.kind)) {
      throw new AppError(
        'precondition_failed',
        'Only a Modex service payment can be refunded. Tuition is never collected by Modex.',
      );
    }

    const alreadyRefunded = transaction.refunds.reduce((sum, row) => sum + row.amountMinor, 0);
    if (alreadyRefunded + input.amountMinor > transaction.amountMinor) {
      throw new AppError('precondition_failed', 'That is more than is left on this payment.', {
        details: {
          paidMinor: transaction.amountMinor,
          refundedMinor: alreadyRefunded,
          requestedMinor: input.amountMinor,
        },
      });
    }

    const correlationId = currentContext()?.correlationId ?? 'admin';
    const refund = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          transactionId: transaction.id,
          amountMinor: input.amountMinor,
          currency: transaction.currency,
          reasonCode: input.reasonCode,
          reason: input.reason,
          actorId: access.userId,
          correlationId,
        },
      });
      await tx.modexTransaction.create({
        data: {
          kind: 'service_refund',
          state: 'settled',
          amountMinor: -input.amountMinor,
          currency: transaction.currency,
          subjectUserId: transaction.subjectUserId,
          description: `Refund of ${transaction.id} (${input.reasonCode})`,
          correlationId,
          settledAt: new Date(),
        },
      });
      if (alreadyRefunded + input.amountMinor === transaction.amountMinor) {
        await tx.modexTransaction.update({
          where: { id: transaction.id },
          data: { state: 'reversed' },
        });
      }
      return created;
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'refund.issued',
      objectType: 'transaction',
      objectId: transaction.id,
      correlationId,
      metadata: {
        refundId: refund.id,
        amountMinor: input.amountMinor,
        currency: transaction.currency,
        reasonCode: input.reasonCode,
        reason: input.reason,
      },
    });

    return refund;
  }

  /**
   * Settlement: what moved, per currency, in a window.
   *
   * Grouped by currency rather than converted to one. A settlement report with
   * a single total has applied an exchange rate nobody in this system chose.
   */
  async settlement(from: Date, to: Date) {
    const rows = await this.prisma.modexTransaction.findMany({
      where: { createdAt: { gte: from, lte: to }, state: { in: ['settled', 'reversed'] } },
      select: { kind: true, currency: true, amountMinor: true },
      take: 10_000,
    });

    const totals = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const entry = totals.get(row.currency) ?? {};
      entry[row.kind] = (entry[row.kind] ?? 0) + row.amountMinor;
      totals.set(row.currency, entry);
    }

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      currencies: [...totals.entries()].map(([currency, byKind]) => ({
        currency,
        byKind,
        netMinor: Object.values(byKind).reduce((sum, value) => sum + value, 0),
      })),
      transactionCount: rows.length,
    };
  }

  async payouts(state?: 'pending_approval' | 'approved' | 'rejected' | 'paid') {
    return this.prisma.payout.findMany({
      where: state === undefined ? {} : { state },
      orderBy: { initiatedAt: 'desc' },
      take: 200,
    });
  }
}
