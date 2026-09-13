import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { PERMISSIONS_KEY, PUBLIC_KEY, STEP_UP_KEY } from '../src/auth/decorators/access.decorators.js';
import { DocumentReviewController } from '../src/admin/document-review.controller.js';
import { InsightsController } from '../src/admin/insights.controller.js';
import type { Permission, StepUpAction } from '@modex/contracts';

/**
 * The guards on the Phase 8 routes, read off the routes themselves.
 *
 * These endpoints hand back a student's uploaded documents and an aggregate
 * over every application on the platform, and both are protected entirely by
 * decorators. A decorator is the easiest thing in a codebase to drop during a
 * refactor and the hardest to notice missing, because the route keeps working —
 * for everybody. So the assertions below are deliberately about metadata rather
 * than behaviour: they fail the moment a guard stops being requested, without
 * needing a database or a live Nest context.
 */
function permissionsOn(controller: object, method: string): Permission[] {
  const handler = (controller as Record<string, unknown>)[method];
  return (Reflect.getMetadata(PERMISSIONS_KEY, handler as object) as Permission[]) ?? [];
}

function stepUpOn(controller: object, method: string): StepUpAction | undefined {
  const handler = (controller as Record<string, unknown>)[method];
  return Reflect.getMetadata(STEP_UP_KEY, handler as object) as StepUpAction | undefined;
}

const reviewRoutes = DocumentReviewController.prototype;
const insightRoutes = InsightsController.prototype;

describe('the document assessment routes', () => {
  it('never marks a route public', () => {
    for (const method of ['queue', 'open', 'decide']) {
      const handler = (reviewRoutes as Record<string, unknown>)[method];
      expect(Reflect.getMetadata(PUBLIC_KEY, handler as object)).toBeUndefined();
    }
  });

  /**
   * Triage is the normal day and discloses no document, so the queue needs no
   * more than console entry. Opening one is where the privacy cost is, and it
   * carries the same step-up as viewing verification evidence.
   */
  it('gates the queue on console entry and the document permission', () => {
    expect(permissionsOn(reviewRoutes, 'queue')).toContain('document:read');
    expect(stepUpOn(reviewRoutes, 'queue')).toBe('console_entry');
  });

  it('gates opening a document on a fresh evidence step-up', () => {
    expect(stepUpOn(reviewRoutes, 'open')).toBe('evidence_view');
    expect(permissionsOn(reviewRoutes, 'open')).toContain('evidence:read');
  });

  it('gates a decision on the same step-up as opening', () => {
    // Deciding must be no easier than looking. If it were, the cheapest path to
    // a verdict would be one that skipped the document.
    expect(stepUpOn(reviewRoutes, 'decide')).toBe('evidence_view');
    expect(permissionsOn(reviewRoutes, 'decide')).toContain('evidence:read');
  });
});

describe('the insights route', () => {
  it('is gated on analytics:read, which trust and finance do not hold', () => {
    expect(permissionsOn(insightRoutes, 'overview')).toEqual(['analytics:read']);
    expect(stepUpOn(insightRoutes, 'overview')).toBe('console_entry');
  });

  it('is not public', () => {
    const handler = (insightRoutes as Record<string, unknown>).overview;
    expect(Reflect.getMetadata(PUBLIC_KEY, handler as object)).toBeUndefined();
  });
});
