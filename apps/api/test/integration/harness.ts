import { PrismaClient } from '../../src/generated/prisma/index.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { InstitutionsService } from '../../src/institutions/institutions.service.js';
import { DomainVerificationService, type DnsLookup } from '../../src/institutions/domain-verification.service.js';
import { CatalogueService } from '../../src/catalogue/catalogue.service.js';
import { IngestionService } from '../../src/ingestion/ingestion.service.js';
import { FreshnessService } from '../../src/ingestion/freshness.service.js';
import type { QueueService } from '../../src/queue/queue.service.js';
import { buildAccessContext } from '../../src/auth/access-context.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import type { AccessContext, Role } from '@modex/contracts';

/**
 * Integration harness.
 *
 * These tests run against a real PostgreSQL because the guarantees they check
 * are enforced by the database, not the application: the append-only audit
 * trigger, the cascade on partnership revocation, and the effective-dated
 * timeline under a real transaction.
 *
 * Services are constructed directly rather than through the Nest container --
 * there is no HTTP layer under test here, and hand-wiring keeps the dependency
 * graph of each test visible in the test itself.
 */

export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgresql://modex@127.0.0.1:5433/modex_test';
}

export function createPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
}

/** A queue that records rather than connects, so tests need no Redis. */
export class RecordingQueue {
  readonly enqueued: { queue: string; job: string; payload: unknown }[] = [];

  async enqueue(queue: string, job: string, payload: unknown): Promise<string> {
    this.enqueued.push({ queue, job, payload });
    return `job_${this.enqueued.length}`;
  }
}

/** A DNS resolver driven by the test rather than by the network. */
export class FakeDns implements DnsLookup {
  private readonly records = new Map<string, string[][]>();

  publish(hostname: string, value: string): void {
    this.records.set(hostname, [[value]]);
  }

  /** Publishes the value split across two strings, as real resolvers often do. */
  publishChunked(hostname: string, value: string): void {
    const half = Math.ceil(value.length / 2);
    this.records.set(hostname, [[value.slice(0, half), value.slice(half)]]);
  }

  async resolveTxt(hostname: string): Promise<string[][]> {
    const record = this.records.get(hostname);
    if (record === undefined) {
      const error = new Error(`queryTxt ENOTFOUND ${hostname}`);
      throw error;
    }
    return record;
  }
}

export interface Harness {
  prisma: PrismaClient;
  audit: AuditService;
  institutions: InstitutionsService;
  domains: DomainVerificationService;
  catalogue: CatalogueService;
  ingestion: IngestionService;
  freshness: FreshnessService;
  dns: FakeDns;
  queue: RecordingQueue;
}

export function createHarness(prisma: PrismaClient): Harness {
  const prismaService = prisma as unknown as PrismaService;
  const audit = new AuditService(prismaService);
  const dns = new FakeDns();
  const queue = new RecordingQueue();
  const domains = new DomainVerificationService(prismaService, audit, dns);
  return {
    prisma,
    audit,
    domains,
    dns,
    queue,
    institutions: new InstitutionsService(
      prismaService,
      audit,
      domains,
      queue as unknown as QueueService,
    ),
    catalogue: new CatalogueService(prismaService, audit),
    ingestion: new IngestionService(prismaService, audit),
    freshness: new FreshnessService(prismaService, audit),
  };
}

/**
 * Clears state between tests.
 *
 * `audit_events` is deliberately absent: it cannot be truncated, which is the
 * property under test. Tests therefore assert on the events they caused rather
 * than on the table being empty.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      requirements, program_fees, intakes, programs,
      catalogue_imports, sync_runs,
      verification_evidence, domain_challenges, institution_contacts,
      campuses, institution_partnerships,
      consent_grants, sessions, user_role_grants, users,
      idempotency_records,
      institutions
    RESTART IDENTITY CASCADE;
  `);
}

export function actor(roles: Role[], organisationId: string | null = null, userId = 'user_test'): AccessContext {
  return buildAccessContext({ userId, roles, organisationId, mfaSatisfied: true, consents: [] });
}

/** Modex trust agent: can verify, crosses organisation boundaries. */
export const trustAgent = (userId = 'user_trust') => actor(['trust_agent'], null, userId);

/** Modex operations: can write catalogue anywhere, cannot verify. */
export const opsUser = (userId = 'user_ops') => actor(['ops'], null, userId);

export const universityAdmin = (organisationId: string, userId = 'user_uni') =>
  actor(['university_admin'], organisationId, userId);
