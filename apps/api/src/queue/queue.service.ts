import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type JobsOptions, type Processor } from 'bullmq';
import { metrics } from '../common/observability/telemetry.js';
import { requestContext } from '../common/observability/request-context.js';

/**
 * Redis-backed queues with retry, backoff and a dead-letter path
 * (Phase 0 section 3.4).
 *
 * Two things this wrapper adds over bare BullMQ:
 *
 *  1. The correlation ID travels with the job payload and is re-established in
 *     the worker, so a background failure is traceable back to the user action
 *     that caused it (Phase 0 section 3.3).
 *  2. Exhausted retries land in a dead-letter queue rather than vanishing. A job
 *     that silently gives up is how a catalogue quietly goes stale.
 */
export const QUEUES = {
  catalogueSync: 'catalogue-sync',
  freshnessSweep: 'freshness-sweep',
  domainVerification: 'domain-verification',
  partnershipCascade: 'partnership-cascade',
  notifications: 'notifications',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const DEAD_LETTER_SUFFIX = ':dead-letter';

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 60 * 60 * 24, count: 1_000 },
  // Failures are kept far longer than successes; they are the ones worth reading.
  removeOnFail: { age: 60 * 60 * 24 * 30 },
};

export interface JobEnvelope<T> {
  payload: T;
  correlationId: string;
  enqueuedAt: string;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  constructor(private readonly connectionUrl: string) {}

  queue(name: QueueName | string): Queue {
    const existing = this.queues.get(name);
    if (existing !== undefined) return existing;
    const queue = new Queue(name, { connection: { url: this.connectionUrl } });
    this.queues.set(name, queue);
    return queue;
  }

  async enqueue<T>(
    name: QueueName,
    jobName: string,
    payload: T,
    options: JobsOptions = {},
  ): Promise<string> {
    const envelope: JobEnvelope<T> = {
      payload,
      correlationId: requestContext.getStore()?.correlationId ?? 'system',
      enqueuedAt: new Date().toISOString(),
    };
    const job = await this.queue(name).add(jobName, envelope, {
      ...DEFAULT_JOB_OPTIONS,
      ...options,
    });
    return String(job.id);
  }

  /**
   * Registers a worker. The handler runs inside the originating request context,
   * so audit events written from a job carry the same correlation ID as the
   * request that queued it.
   */
  register<T>(
    name: QueueName,
    handler: (payload: T, correlationId: string) => Promise<void>,
    concurrency = 4,
  ): Worker {
    const processor: Processor<JobEnvelope<T>> = async (job) => {
      const startedAt = Date.now();
      const { payload, correlationId } = job.data;
      try {
        await requestContext.run({ requestId: `job:${job.id}`, correlationId }, () =>
          handler(payload, correlationId),
        );
        metrics.jobFinished(name, 'succeeded', Date.now() - startedAt);
      } catch (error) {
        metrics.jobFinished(name, 'failed', Date.now() - startedAt);
        const attemptsMade = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts ?? DEFAULT_JOB_OPTIONS.attempts ?? 1;
        if (attemptsMade >= maxAttempts) {
          // Last attempt: move it somewhere a human will see it.
          await this.queue(`${name}${DEAD_LETTER_SUFFIX}`).add(job.name, {
            ...job.data,
            failedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          });
          this.logger.error(
            `Job ${job.name} on ${name} exhausted ${maxAttempts} attempts; moved to dead-letter`,
          );
        }
        throw error;
      }
    };

    const worker = new Worker<JobEnvelope<T>>(name, processor, {
      connection: { url: this.connectionUrl },
      concurrency,
    });
    this.workers.push(worker);
    return worker;
  }

  /** Queue depth per queue, for the saturation golden signal. */
  async reportDepths(): Promise<void> {
    for (const [name, queue] of this.queues) {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
      metrics.queueDepth(name, (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
