import { Injectable } from '@nestjs/common';
import {
  canPublishAnswer,
  guideDisplayName,
  publicationBlockReason,
  scanMessage,
  type AccessContext,
  type GuideTopic,
  type PublishedAnswer,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { GuidesService } from '../guides/guides.service.js';

/**
 * Public Q&A (Phase 3 §3).
 *
 * A private answer becoming a public statement needs two independent yeses — a
 * moderator's and the guide's own — and this service is where "independent" is
 * enforced: consent is recorded by the guide's own request, moderation by a
 * trust agent's, and `canPublishAnswer` requires both plus a live guide.
 *
 * Answers go through the same anti-scam scan as messages. A guarantee of
 * admission is worse in a searchable public answer than in one conversation, not
 * better, so there is no relaxed path here.
 */
@Injectable()
export class QaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guides: GuidesService,
  ) {}

  async ask(
    access: AccessContext,
    input: { institutionId: string; programKey?: string | null; topic: GuideTopic; body: string },
  ) {
    return this.prisma.guideQuestion.create({
      data: {
        askedById: access.userId,
        institutionId: input.institutionId,
        programKey: input.programKey ?? null,
        topic: input.topic,
        body: input.body,
      },
    });
  }

  /**
   * A guide answers. The answer is a draft until the guide says it may be
   * published, so writing a helpful reply never silently publishes it.
   */
  async answer(
    access: AccessContext,
    questionId: string,
    input: { body: string; consentToPublish: boolean },
  ) {
    const guide = await this.guides.requireOwnGuide(access);
    if (guide.state !== 'active') {
      throw AppError.forbidden('Only an active guide can answer questions.');
    }

    const question = await this.prisma.guideQuestion.findUnique({ where: { id: questionId } });
    if (question === null) throw AppError.notFound('Question');
    if (question.institutionId !== guide.institutionId) {
      // A guide speaks for their own university and no other.
      throw AppError.forbidden('You can only answer questions about your own university.');
    }

    const assessment = scanMessage(input.body, 'guide');
    if (assessment.action === 'warn_and_open_case') {
      throw AppError.validation(
        'This answer cannot be published as written.',
        assessment.findings.map((finding) => ({
          field: 'body',
          code: finding.signal,
          message: finding.senderNotice,
        })),
      );
    }

    const answer = await this.prisma.guideAnswer.create({
      data: {
        questionId,
        guideId: guide.id,
        body: input.body,
        state: input.consentToPublish ? 'pending_moderation' : 'draft',
        guideConsentedAt: input.consentToPublish ? new Date() : null,
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'qa.answer_submitted',
      objectType: 'qa_answer',
      objectId: answer.id,
      metadata: { questionId, consentToPublish: input.consentToPublish },
    });

    return answer;
  }

  /** The guide changes their mind, in either direction. */
  async setConsent(access: AccessContext, answerId: string, consent: boolean) {
    const guide = await this.guides.requireOwnGuide(access);
    const answer = await this.prisma.guideAnswer.findFirst({
      where: { id: answerId, guideId: guide.id },
    });
    if (answer === null) throw AppError.notFound('Answer');

    const updated = await this.prisma.guideAnswer.update({
      where: { id: answerId },
      data: consent
        ? { guideConsentedAt: new Date(), state: answer.state === 'draft' ? 'pending_moderation' : answer.state }
        : // Withdrawing consent unpublishes. A guide who no longer wants their
          // name on an answer does not have to ask a moderator to agree.
          { guideConsentedAt: null, state: 'withdrawn', publishedAt: null },
    });

    return { id: updated.id, state: updated.state, consented: updated.guideConsentedAt !== null };
  }

  /** Moderation. Trust only — `qa:moderate`. */
  async moderate(
    access: AccessContext,
    answerId: string,
    decision: 'approve' | 'reject',
    note?: string,
  ) {
    const answer = await this.prisma.guideAnswer.findUnique({
      where: { id: answerId },
      include: { guide: { select: { state: true } } },
    });
    if (answer === null) throw AppError.notFound('Answer');

    if (decision === 'reject') {
      await this.prisma.guideAnswer.update({
        where: { id: answerId },
        data: { state: 'rejected', moderatedAt: new Date(), moderatedBy: access.userId, moderationNote: note ?? null },
      });
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'qa.answer_rejected',
        objectType: 'qa_answer',
        objectId: answerId,
        metadata: { note },
      });
      return { state: 'rejected' as const };
    }

    const moderated = {
      state: answer.state,
      moderatedAt: new Date().toISOString(),
      guideConsentedAt: answer.guideConsentedAt?.toISOString() ?? null,
    };
    if (!canPublishAnswer(moderated, answer.guide.state)) {
      throw AppError.stateTransition(
        publicationBlockReason(moderated, answer.guide.state) ?? 'This answer cannot be published.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.guideAnswer.update({
        where: { id: answerId },
        data: {
          state: 'published',
          moderatedAt: new Date(),
          moderatedBy: access.userId,
          moderationNote: note ?? null,
          publishedAt: new Date(),
        },
      }),
      // The question becomes public; the student who asked it does not.
      this.prisma.guideQuestion.update({
        where: { id: answer.questionId },
        data: { askedById: null },
      }),
    ]);

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'qa.answer_published',
      objectType: 'qa_answer',
      objectId: answerId,
      metadata: { questionId: answer.questionId },
    });

    return { state: 'published' as const };
  }

  /**
   * The public knowledge base.
   *
   * Only published answers, and only from guides who are still active — the
   * state is re-read on every query rather than baked in at publication time, so
   * suspending a guide removes their answers from the public site without a
   * separate cleanup job.
   */
  async published(filters: { institutionId?: string; topic?: GuideTopic } = {}): Promise<PublishedAnswer[]> {
    const answers = await this.prisma.guideAnswer.findMany({
      where: {
        state: 'published',
        guide: { state: 'active' },
        question: {
          ...(filters.institutionId === undefined ? {} : { institutionId: filters.institutionId }),
          ...(filters.topic === undefined ? {} : { topic: filters.topic }),
        },
      },
      orderBy: [{ helpfulCount: 'desc' }, { publishedAt: 'desc' }],
      take: 200,
      include: {
        question: { include: { institution: { select: { displayName: true } } } },
        guide: {
          include: {
            user: { select: { displayName: true } },
          },
        },
      },
    });

    const programNames = new Map<string, string | null>();
    for (const answer of answers) {
      const key = answer.guide.programKey;
      if (key === null || programNames.has(key)) continue;
      const program = await this.prisma.program.findFirst({
        where: { programKey: key, effectiveTo: null },
        select: { name: true },
      });
      programNames.set(key, program?.name ?? null);
    }

    return answers.map((answer) => ({
      id: answer.id,
      questionId: answer.questionId,
      question: answer.question.body,
      topic: answer.question.topic,
      institutionId: answer.question.institutionId,
      institutionName: answer.question.institution.displayName,
      programName: answer.guide.programKey === null ? null : (programNames.get(answer.guide.programKey) ?? null),
      body: answer.body,
      guideDisplayName: guideDisplayName(answer.guide.user.displayName),
      guideId: answer.guideId,
      publishedAt: (answer.publishedAt ?? answer.updatedAt).toISOString(),
      helpfulCount: answer.helpfulCount,
    }));
  }

  /** Open questions a guide could answer, for their dashboard. */
  async openQuestions(access: AccessContext) {
    const guide = await this.guides.requireOwnGuide(access);
    return this.prisma.guideQuestion.findMany({
      where: {
        institutionId: guide.institutionId,
        answers: { none: { guideId: guide.id } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
