import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_REASONS,
  ASSESSMENT_REASON_TEXT,
  AssessmentDecisionSchema,
  assessmentBlockReason,
  assessmentState,
  blocksSubmission,
  canAssess,
  CORE_DOCUMENT_TYPES,
  decisionText,
  escalatesToTrust,
  isOverdue,
  missingCoreTypes,
  type DocumentAssessment,
} from '../src/domain/document-review.js';
import { SCAN_STATES, type DocumentVersion } from '../src/domain/documents.js';

function version(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    id: 'dv_1',
    documentId: 'doc_1',
    version: 1,
    objectKey: 'documents/9f2c/6a1e-…',
    checksum: 'a'.repeat(64),
    sizeBytes: 182_311,
    contentType: 'application/pdf',
    scanState: 'clean',
    scannedAt: '2026-05-30T00:00:00.000Z',
    scanDetail: null,
    uploadComplete: true,
    createdAt: '2026-05-30T00:00:00.000Z',
    ...overrides,
  };
}

function assessment(overrides: Partial<DocumentAssessment> = {}): DocumentAssessment {
  return {
    id: 'as_1',
    documentVersionId: 'dv_1',
    documentId: 'doc_1',
    studentId: 'user_1',
    type: 'transcript',
    institutionId: null,
    applicationId: null,
    state: 'awaiting_review',
    decision: null,
    reasons: [],
    note: null,
    reviewerId: null,
    startedAt: null,
    decidedAt: null,
    createdAt: '2026-05-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('the review gate', () => {
  it('opens only a clean, complete, checksummed version', () => {
    expect(canAssess(version())).toBe(true);
    expect(assessmentBlockReason(version())).toBeNull();
  });

  // The reviewer must never be the person who finds the malware. This loop is
  // what proves a scan state added later is refused by default rather than
  // slipping through a `!== 'quarantined'` check.
  it('refuses every scan state except clean, with a reason', () => {
    for (const scanState of SCAN_STATES) {
      if (scanState === 'clean') continue;
      const blocked = version({ scanState });
      expect(canAssess(blocked)).toBe(false);
      expect(assessmentBlockReason(blocked)).toBeTruthy();
    }
  });

  it('refuses a version whose bytes never landed', () => {
    expect(canAssess(version({ uploadComplete: false }))).toBe(false);
  });

  it('never offers a retry on a quarantined file', () => {
    expect(assessmentBlockReason(version({ scanState: 'quarantined' }))).toContain('clean copy');
  });
});

describe('the derived queue state', () => {
  it('reports a file still being scanned as awaiting the scan, not the reviewer', () => {
    expect(assessmentState(version({ scanState: 'pending' }), null)).toBe('awaiting_scan');
  });

  it('separates opened-not-decided from untouched', () => {
    expect(assessmentState(version(), null)).toBe('awaiting_review');
    expect(assessmentState(version(), { decision: null, startedAt: '2026-06-01T09:00:00.000Z' })).toBe(
      'in_review',
    );
  });

  it('reports the decision once one exists', () => {
    expect(assessmentState(version(), { decision: 'rejected', startedAt: '2026-06-01T09:00:00.000Z' })).toBe(
      'rejected',
    );
  });
});

describe('decisions', () => {
  it('refuses a rejection that names no reason', () => {
    const parsed = AssessmentDecisionSchema.safeParse({ decision: 'rejected', reasons: [], note: 'wrong' });
    expect(parsed.success).toBe(false);
  });

  it('refuses a request for more information that names no reason', () => {
    expect(
      AssessmentDecisionSchema.safeParse({ decision: 'more_information', reasons: [] }).success,
    ).toBe(false);
  });

  it('accepts an acceptance with no reason', () => {
    expect(AssessmentDecisionSchema.safeParse({ decision: 'accepted' }).success).toBe(true);
  });

  it('gives every reason code a sentence a student can act on', () => {
    for (const reason of ASSESSMENT_REASONS) {
      expect(ASSESSMENT_REASON_TEXT[reason].length).toBeGreaterThan(20);
    }
  });

  it('puts the reviewer’s own words after the reason codes, never instead of them', () => {
    const text = decisionText(
      assessment({ decision: 'rejected', reasons: ['incomplete'], note: 'Page 2 is missing.' }),
    );
    expect(text[0]).toBe(ASSESSMENT_REASON_TEXT.incomplete);
    expect(text[1]).toBe('Page 2 is missing.');
  });

  it('blocks a submission on a rejection and on a request for more information', () => {
    expect(blocksSubmission(assessment({ decision: 'rejected', reasons: ['illegible'] }))).toBe(true);
    expect(blocksSubmission(assessment({ decision: 'more_information', reasons: ['incomplete'] }))).toBe(
      true,
    );
  });

  // Assessment is a service to the student, not a gate the platform puts in
  // front of their own application. An undecided document blocks nothing.
  it('does not block a submission on an undecided or accepted document', () => {
    expect(blocksSubmission(assessment())).toBe(false);
    expect(blocksSubmission(assessment({ decision: 'accepted' }))).toBe(false);
    expect(blocksSubmission(null)).toBe(false);
  });

  it('escalates a suspected alteration and nothing else', () => {
    expect(escalatesToTrust({ reasons: ['suspected_alteration'] })).toBe(true);
    expect(escalatesToTrust({ reasons: ['illegible', 'incomplete', 'expired'] })).toBe(false);
  });
});

describe('the review commitment', () => {
  const created = '2026-06-01T00:00:00.000Z';

  it('calls an undecided row late once it passes the SLA', () => {
    expect(isOverdue({ createdAt: created, decidedAt: null }, new Date('2026-06-02T01:00:00.000Z'))).toBe(
      false,
    );
    expect(isOverdue({ createdAt: created, decidedAt: null }, new Date('2026-06-03T05:00:00.000Z'))).toBe(
      true,
    );
  });

  it('never calls a decided row late, however long it took', () => {
    expect(
      isOverdue(
        { createdAt: created, decidedAt: '2026-06-30T00:00:00.000Z' },
        new Date('2026-07-30T00:00:00.000Z'),
      ),
    ).toBe(false);
  });
});

describe('the document pack', () => {
  it('names what is missing from the floor every application needs', () => {
    expect(missingCoreTypes(['passport'])).toEqual(['transcript', 'language_test']);
    expect(missingCoreTypes([...CORE_DOCUMENT_TYPES])).toEqual([]);
  });
});
