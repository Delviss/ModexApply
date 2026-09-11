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
import { GuidesService } from '../../src/guides/guides.service.js';
import { ReverificationService } from '../../src/guides/reverification.service.js';
import { MessagingService } from '../../src/messaging/messaging.service.js';
import { TrustService } from '../../src/trust/trust.service.js';
import { SessionsService } from '../../src/sessions/sessions.service.js';
import { QaService } from '../../src/qa/qa.service.js';
import type { MalwareScanner, ScanVerdict } from '../../src/documents/scanner.port.js';
import { ApplicationsService } from '../../src/applications/applications.service.js';
import { OffersService } from '../../src/offers/offers.service.js';
import { OfferPricingService } from '../../src/offers/offer-pricing.service.js';
import { OfferExpiryService } from '../../src/offers/offer-expiry.service.js';
import { OfferIntegrityService } from '../../src/offers/offer-integrity.service.js';
import { OfferLifecycleService } from '../../src/offers/offer-lifecycle.service.js';
import { ApplicationStateService } from '../../src/applications/application-state.service.js';
import { PayloadBuilderService } from '../../src/applications/payload-builder.service.js';
import { SubmissionService } from '../../src/applications/submission.service.js';
import { ConnectorRegistry } from '../../src/connectors/connector.registry.js';
import { InboundStatusService } from '../../src/connectors/inbound-status.service.js';
import { StatusPollService } from '../../src/connectors/status-poll.service.js';
import type { ConnectorPort, SecretResolver } from '../../src/connectors/connector.port.js';
import { FeatureFlagService } from '../../src/config/feature-flags.js';
import { UniversityPortalService } from '../../src/admin/university-portal.service.js';
import { TrustConsoleService } from '../../src/admin/trust-console.service.js';
import { OpsConsoleService } from '../../src/admin/ops-console.service.js';
import { FinanceConsoleService } from '../../src/admin/finance-console.service.js';
import { SanctionsService } from '../../src/admin/sanctions.service.js';
import { ImpersonationService } from '../../src/admin/impersonation.service.js';
import { PrivacyService } from '../../src/privacy/privacy.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import type { AccessContext, ConnectorType, Role, SubmissionOutcome } from '@modex/contracts';

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
  guides: GuidesService;
  reverification: ReverificationService;
  messaging: MessagingService;
  trust: TrustService;
  sessions: SessionsService;
  qa: QaService;
  applications: ApplicationsService;
  applicationState: ApplicationStateService;
  payloads: PayloadBuilderService;
  submissions: SubmissionService;
  connector: ScriptedConnector;
  inbound: InboundStatusService;
  poll: StatusPollService;
  secrets: SecretResolver;
  offers: OffersService;
  offerPricing: OfferPricingService;
  offerExpiry: OfferExpiryService;
  offerIntegrity: OfferIntegrityService;
  offerLifecycle: OfferLifecycleService;
  // Phase 6 — the four consoles.
  portal: UniversityPortalService;
  trustConsole: TrustConsoleService;
  opsConsole: OpsConsoleService;
  finance: FinanceConsoleService;
  sanctions: SanctionsService;
  impersonation: ImpersonationService;
  privacy: PrivacyService;
}

/**
 * A connector the test drives.
 *
 * Standing in for a university rather than for a network: the property under
 * test is what Modex does with each outcome, and a real HTTP call would only
 * add a way for these tests to fail for reasons that have nothing to do with
 * the guarantee. The adapters themselves are covered against recorded fixtures
 * in `connector-contract.test.ts`.
 */
export class ScriptedConnector implements ConnectorPort {
  readonly type: ConnectorType = 'api';
  readonly calls: { idempotencyKey: string; documentVersionIds: string[]; payloadHash: unknown }[] = [];
  /** Queued outcomes, consumed in order; the last one repeats. */
  outcomes: SubmissionOutcome[] = [
    { status: 'accepted', externalRef: 'UNI-REF-1', receivedAt: new Date().toISOString(), evidence: {} },
  ];

  async submit(request: Parameters<ConnectorPort['submit']>[0]): Promise<SubmissionOutcome> {
    this.calls.push({
      idempotencyKey: request.idempotencyKey,
      documentVersionIds: request.documents.map((document) => document.versionId),
      payloadHash: request.payload.application.id,
    });
    return this.outcomes.length > 1
      ? this.outcomes.shift()!
      : (this.outcomes[0] ?? {
          status: 'retryable_failure',
          reason: 'no outcome scripted',
          retryAfterSeconds: null,
        });
  }

  polled: Awaited<ReturnType<NonNullable<ConnectorPort['poll']>>> = [];

  async poll(): Promise<Awaited<ReturnType<NonNullable<ConnectorPort['poll']>>>> {
    return this.polled;
  }

  reset(): void {
    this.calls.length = 0;
    this.polled.length = 0;
    this.outcomes = [
      { status: 'accepted', externalRef: 'UNI-REF-1', receivedAt: new Date().toISOString(), evidence: {} },
    ];
  }
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

  override async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
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
  // Phase 3. Hand-wired like everything else here, so each test's dependency
  // graph is visible in the test rather than in a container configuration.
  const guides = new GuidesService(prismaService, audit, queue as unknown as QueueService);
  const trust = new TrustService(prismaService, audit);
  const messaging = new MessagingService(prismaService, audit, guides, trust);
  const sessions = new SessionsService(prismaService, audit, guides, trust);

  // Phase 4. Every partner secret is a test constant here, which is also how
  // `EnvSecretResolver` behaves in production: the connector row holds a name,
  // never a credential.
  const secrets: SecretResolver = {
    resolve: (ref) => (ref === null ? null : `secret-for-${ref}`),
  };
  const connector = new ScriptedConnector();
  const documents = new DocumentsService(
    prismaService,
    audit,
    storage,
    scanner,
    queue as unknown as QueueService,
  );
  const registry = new ConnectorRegistry(
    [connector],
    new FeatureFlagService('connector.direct_application'),
  );
  const applicationState = new ApplicationStateService(prismaService, audit);
  const payloads = new PayloadBuilderService(prismaService, documents, storage);
  const submissions = new SubmissionService(
    prismaService,
    audit,
    registry,
    applicationState,
    queue as unknown as QueueService,
    documents,
    storage,
  );
  const eligibility = new EligibilityService(prismaService, audit);

  // Phase 5. `indexer` is built here rather than reused from the object literal
  // below because the expiry sweep needs it before that literal exists — a
  // lapsed offer has to leave the search index in the same cycle it leaves the
  // catalogue, and the sweep is what does that.
  const indexer = new IndexerService(prismaService, index);
  const offers = new OffersService(prismaService, audit, queue as unknown as QueueService);
  const offerPricing = new OfferPricingService(prismaService, eligibility);
  const offerLifecycle = new OfferLifecycleService(prismaService, audit, offerPricing);
  const inbound = new InboundStatusService(
    prismaService,
    audit,
    applicationState,
    offerLifecycle,
    secrets,
  );

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
    eligibility,
    students: new StudentsService(prismaService, audit),
    documents,
    search: new SearchService(prismaService, index),
    indexer,
    index,
    storage,
    scanner,
    guides,
    trust,
    messaging,
    sessions,
    qa: new QaService(prismaService, audit, guides),
    applications: new ApplicationsService(
      prismaService,
      audit,
      applicationState,
      payloads,
      submissions,
      eligibility,
    ),
    applicationState,
    payloads,
    submissions,
    connector,
    inbound,
    poll: new StatusPollService(prismaService, audit, registry, inbound),
    secrets,
    offers,
    offerPricing,
    offerLifecycle,
    offerExpiry: new OfferExpiryService(
      prismaService,
      audit,
      offers,
      queue as unknown as QueueService,
      indexer,
    ),
    offerIntegrity: new OfferIntegrityService(
      prismaService,
      audit,
      offers,
      trust,
      queue as unknown as QueueService,
    ),
    reverification: new ReverificationService(
      prismaService,
      audit,
      guides,
      queue as unknown as QueueService,
    ),
    portal: new UniversityPortalService(prismaService, audit, applicationState),
    trustConsole: new TrustConsoleService(prismaService, audit),
    opsConsole: new OpsConsoleService(prismaService, audit),
    finance: new FinanceConsoleService(prismaService, audit),
    sanctions: new SanctionsService(prismaService, audit, guides),
    privacy: new PrivacyService(prismaService, audit, storage),
    impersonation: new ImpersonationService(
      prismaService,
      audit,
      // A real signer with a test key: the impersonation token is verified in
      // these tests, so a stub that returns a fixed string would prove nothing.
      new TokenService('test-signing-key-at-least-32-characters-long', 900, 86_400),
    ),
  };
}

/**
 * Clears state between tests.
 *
 * `audit_events`, `message_flags`, `requirement_reviews` and
 * `impersonation_grants` are deliberately absent: none can be truncated, which
 * is the property under test. Tests that touch them assert on the rows they
 * caused rather than on an empty table, and use a fresh subject each time. Tests therefore assert on the
 * rows they caused rather than on the table being empty. `message_flags` holds
 * no foreign key to `messages`, so truncating messages does not drag it in —
 * which is the same design decision, seen from the other side.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      admission_offers, application_offers,
      offer_source_checks, offer_exclusions, offers,
      payouts, refunds, modex_transactions,
      notification_deliveries, notification_templates,
      sanctions,
      submission_attempts, application_status_events, application_tasks,
      applications, connector_configs,
      guide_answers, guide_questions, guide_reward_entries, guide_sessions,
      guide_availability_slots, trust_case_events, trust_cases,
      messages, conversations,
      guide_identity_changes, guide_verifications, student_guides,
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
  return buildAccessContext({
    userId,
    sessionId: `session_${userId}`,
    // Staff actors in tests are treated as freshly stepped-up. The step-up
    // *guard* is exercised on its own in `test/step-up.test.ts`; forcing every
    // console test to re-stamp a session would test the harness rather than the
    // rule.
    stepUpAt: new Date(),
    roles,
    organisationId,
    mfaSatisfied: true,
    consents: [],
  });
}

/** A signed-in student, with the consents a Phase 3 flow needs. */
export function studentActor(
  userId: string,
  consents: AccessContext['consents'] = [],
): AccessContext {
  return buildAccessContext({
    userId,
    sessionId: `session_${userId}`,
    roles: ['student'],
    organisationId: null,
    mfaSatisfied: false,
    consents,
  });
}

/** A guide, in the RBAC sense. Whether they may *send* is a separate question. */
export const guideActor = (userId: string) => actor(['guide'], null, userId);

/** `guide_access` for one guide, which is what opening a conversation needs. */
export function guideAccessConsent(guideId: string): AccessContext['consents'] {
  return [
    {
      scope: 'guide_access',
      grantedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: null,
      revokedAt: null,
      subjectId: guideId,
    },
  ];
}

/** Modex trust agent: can verify, crosses organisation boundaries. */
export const trustAgent = (userId = 'user_trust') => actor(['trust_agent'], null, userId);

/** Modex operations: can write catalogue anywhere, cannot verify. */
export const opsUser = (userId = 'user_ops') => actor(['ops'], null, userId);

/** Phase 6. Finance holds both halves of a payout; identity is what separates them. */
export const financeUser = (userId = 'user_finance') => actor(['finance'], null, userId);

export const universityStaff = (organisationId: string, userId = 'user_uni_staff') =>
  actor(['university_staff'], organisationId, userId);

export const universityAdmin = (organisationId: string, userId = 'user_uni') =>
  actor(['university_admin'], organisationId, userId);
