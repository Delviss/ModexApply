import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createHarness, createPrisma, resetDatabase, trustAgent, type Harness } from './harness.js';
import { systemActor, toAuditActor } from '../../src/auth/audit-actor.js';

let prisma: PrismaClient;
let harness: Harness;

beforeAll(async () => {
  prisma = createPrisma();
  await prisma.$connect();
  harness = createHarness(prisma);
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Phase 0 acceptance criterion: "a test proves the audit table rejects update
 * and delete."
 *
 * These assertions run against real PostgreSQL as the table owner, which is the
 * only way the claim means anything -- an application-level convention would
 * pass a mocked test and fail the moment somebody wrote raw SQL.
 */
describe('the audit table is append-only', () => {
  it('rejects UPDATE', async () => {
    const event = await harness.audit.record({
      actor: systemActor(),
      action: 'institution.created',
      objectType: 'institution',
      objectId: 'inst_append_only_1',
    });

    await expect(
      prisma.$executeRawUnsafe(`UPDATE audit_events SET action = 'tampered' WHERE id = $1`, event.id),
    ).rejects.toThrow(/append-only/i);

    const stored = await prisma.auditEvent.findUnique({ where: { id: event.id } });
    expect(stored?.action).toBe('institution.created');
  });

  it('rejects DELETE', async () => {
    const event = await harness.audit.record({
      actor: systemActor(),
      action: 'institution.created',
      objectType: 'institution',
      objectId: 'inst_append_only_2',
    });

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM audit_events WHERE id = $1`, event.id),
    ).rejects.toThrow(/append-only/i);

    expect(await prisma.auditEvent.findUnique({ where: { id: event.id } })).not.toBeNull();
  });

  // TRUNCATE bypasses row triggers, so it needs its own statement trigger --
  // without it the "no delete path" guarantee has a hole big enough for the
  // entire table.
  it('rejects TRUNCATE', async () => {
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE audit_events')).rejects.toThrow(
      /append-only/i,
    );
  });

  it('still accepts INSERT', async () => {
    const before = await prisma.auditEvent.count();
    await harness.audit.record({
      actor: systemActor(),
      action: 'institution.created',
      objectType: 'institution',
      objectId: 'inst_append_only_3',
    });
    expect(await prisma.auditEvent.count()).toBe(before + 1);
  });
});

describe('the audit chain', () => {
  it('links each event to its predecessor and verifies end to end', async () => {
    const first = await harness.audit.record({
      actor: toAuditActor(trustAgent()),
      action: 'institution.verification_advanced',
      objectType: 'institution',
      objectId: 'inst_chain',
      metadata: { toStage: 'legal_entity_check' },
    });
    const second = await harness.audit.record({
      actor: toAuditActor(trustAgent()),
      action: 'institution.verification_advanced',
      objectType: 'institution',
      objectId: 'inst_chain',
      metadata: { toStage: 'official_domain_confirmation' },
    });

    expect(first.integrityRef).not.toBe(second.integrityRef);
    const result = await harness.audit.verifyIntegrity();
    expect(result.valid).toBe(true);
    expect(result.checked).toBeGreaterThan(1);
  });

  it('redacts secrets before they are written, not after', async () => {
    const event = await harness.audit.record({
      actor: systemActor(),
      action: 'institution.domain_challenge_issued',
      objectType: 'institution',
      objectId: 'inst_redaction',
      metadata: {
        domain: 'example.ac.uk',
        dnsChallengeToken: 'modex-verification=super-secret-value',
        nested: { refreshToken: 'rt_live_should_not_persist' },
      },
    });

    const stored = await prisma.auditEvent.findUniqueOrThrow({ where: { id: event.id } });
    const metadata = stored.metadata as Record<string, unknown>;
    expect(metadata.domain).toBe('example.ac.uk');
    expect(metadata.dnsChallengeToken).toBe('[redacted]');
    expect((metadata.nested as Record<string, unknown>).refreshToken).toBe('[redacted]');

    // And the raw value is nowhere in the row at all.
    expect(JSON.stringify(stored)).not.toContain('super-secret-value');
    expect(JSON.stringify(stored)).not.toContain('rt_live_should_not_persist');
  });

  it('hashes the actor IP rather than storing it', async () => {
    const event = await harness.audit.record({
      actor: { ...systemActor(), id: 'user_1', type: 'user', ip: '203.0.113.42' },
      action: 'user.login_succeeded',
      objectType: 'user',
      objectId: 'user_1',
    });
    const stored = await prisma.auditEvent.findUniqueOrThrow({ where: { id: event.id } });
    const authContext = stored.authContext as Record<string, unknown>;
    expect(authContext.ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(stored)).not.toContain('203.0.113.42');
  });
});
