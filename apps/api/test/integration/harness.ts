import { PrismaClient } from '@prisma/client';
import { AuditService } from '../../src/audit/audit.service.js';
import { InstitutionsService } from '../../src/institutions/institutions.service.js';
import { DomainVerificationService, type DnsLookup } from '../../src/institutions/domain-verification.service.js';
import { CatalogueService } from '../../src/catalogue/catalogue.service.js';
import { IngestionService } from '../../src/ingestion/ingestion.service.js';
import { FreshnessService } from '../../src/ingestion/freshness.service.js';
import type { QueueService } from '../../src/queue/queue.service.js';
import { buildAccessContext } from '../../src/auth/access-context.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { EligibilityService } from '../../src/eligibility/eligibility.service.js';
import { StudentsService } from '../../src/students/students.service.js';
import { DocumentsService } from '../../src/documents/documents.service.js';
import { SearchService } from '../../src/search/search.service.js';
import { IndexerService } from '../../src/search/indexer.service.js';
import { PostgresSearchIndex } from '../../src/search/postgres-search-index.js';
import { StorageService } from '../../src/storage/storage.service.js';
import type { MalwareScanner, ScanVerdict } from '../../src/documents/scanner.port.js';
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
  // Matches docker-compose.yml. The previous fallback pointed at 5433 with no
  // password, which is nothing this repo ever starts -- so a developer running
  // `make test-integration` without a .env got a connection error rather than a
  // database.
  return process.env.DATABASE_URL ?? 'postgresql://modex:modex@127.0.0.1:5432/modex_test';
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

  /**
   * Forgets what it recorded.
   *
   * The harness is built once per file while the database is reset per test, so
   * without this a test asserting "one job was enqueued" is really asserting
   * "one job since the file started" -- which passes alone and fails in suite
   * order.
   */
  clear(): void {
    this.enqueued.length = 0;
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
  eligibility: EligibilityService;
  students: StudentsService;
  documents: DocumentsService;
  search: SearchService;
  indexer: IndexerService;
  index: PostgresSearchIndex;
  storage: FakeStorage;
  scanner: ScriptedScanner;
}

/**
 * Storage that keeps objects in a Map, so the vault flow is exercised end to
 * end without MinIO. It still signs real URLs, because the expiry and replay
 * assertions are about the signature, not about the bytes.
 */
export class FakeStorage extends StorageService {
  readonly objects = new Map<string, Buffer>();

  constructor() {
    super({
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'eu-west-2',
      S3_BUCKET: 'modex-documents',
      S3_ACCESS_KEY_ID: 'modex',
      S3_SECRET_ACCESS_KEY: 'modex-local-secret',
      SIGNED_URL_TTL_SECONDS: 300,
    } as never);
  }

  put(key: string, bytes: Buffer): void {
    this.objects.set(key, bytes);
  }

  override async fetchObject(key: string): Promise<Buffer | null> {
    return this.objects.get(key) ?? null;
  }
}

/**
 * A scanner the test drives.
 *
 * The default is `clean` so the ordinary path is one line; a test that cares
 * about quarantine says so explicitly. Real ClamAV is not in the loop here --
 * the property under test is the state machine, not the signature database.
 */
export class ScriptedScanner implements MalwareScanner {
  readonly name = 'scripted';
  verdict: ScanVerdict = { state: 'clean', detail: null };
  readonly scanned: string[] = [];

  async scan(_bytes: Buffer, hint: { key: string }): Promise<ScanVerdict> {
    this.scanned.push(hint.key);
    return this.verdict;
  }
}

export function createHarness(prisma: PrismaClient): Harness {
  const prismaService = prisma as unknown as PrismaService;
  const audit = new AuditService(prismaService);
  const dns = new FakeDns();
  const queue = new RecordingQueue();
  const domains = new DomainVerificationService(prismaService, audit, dns);
  const storage = new FakeStorage();
  const scanner = new ScriptedScanner();
  const index = new PostgresSearchIndex(prismaService);
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
    catalogue: new CatalogueService(prismaService, audit, queue as unknown as QueueService),
    ingestion: new IngestionService(prismaService, audit),
    freshness: new FreshnessService(prismaService, audit, queue as unknown as QueueService),
    eligibility: new EligibilityService(prismaService, audit),
    students: new StudentsService(prismaService, audit),
    documents: new DocumentsService(
      prismaService,
      audit,
      storage,
      scanner,
      queue as unknown as QueueService,
    ),
    search: new SearchService(prismaService, index),
    indexer: new IndexerService(prismaService, index),
    index,
    storage,
    scanner,
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
      shortlist_items, shortlists, saved_searches,
      document_versions, documents,
      language_tests, academic_records, student_profiles,
      program_search_documents, eligibility_overrides,
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
