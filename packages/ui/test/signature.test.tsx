import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type {
  EligibilityExplanation as Explanation,
  Provenance,
  VerificationClaim,
} from '@modex/contracts';
import { VerificationBadge } from '../src/signature/verification-badge.js';
import { ProvenanceStamp } from '../src/signature/provenance-stamp.js';
import { EligibilityExplanation } from '../src/signature/eligibility-explanation.js';
import { DisclosureNotice } from '../src/signature/disclosure-notice.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

function claim(overrides: Partial<VerificationClaim> = {}): VerificationClaim {
  return {
    objectType: 'institution',
    objectId: 'inst_1',
    state: 'verified',
    verifierName: 'A. Okafor',
    verifierType: 'trust_agent',
    verifiedAt: '2026-01-15T00:00:00.000Z',
    expiresAt: '2027-01-15T00:00:00.000Z',
    evidenceSummary: 'Domain confirmed by DNS TXT record; contract on file.',
    ...overrides,
  };
}

describe('<VerificationBadge>', () => {
  it('renders every state, including expired and unverified', () => {
    const cases = [
      [claim(), 'Verified'],
      [claim({ state: 'pending' }), 'Verification pending'],
      [claim({ state: 'unverified', verifierName: null }), 'Not verified'],
      [claim({ state: 'revoked' }), 'Verification revoked'],
    ] as const;

    for (const [input, label] of cases) {
      const { unmount } = render(<VerificationBadge claim={input} now={NOW} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  // The stored column says "verified"; the claim lapsed in March. The badge must
  // not launder a lapsed claim into a current one.
  it('renders a lapsed claim as expired, not as the stored verified state', () => {
    render(<VerificationBadge claim={claim({ expiresAt: '2026-03-01T00:00:00.000Z' })} now={NOW} />);
    expect(screen.getByText('Verification expired')).toBeInTheDocument();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });

  it('never conveys state by colour alone — every state carries a text label', () => {
    render(<VerificationBadge claim={claim({ state: 'pending' })} now={NOW} variant="full" />);
    const badge = screen.getByText('Verification pending');
    expect(badge.textContent).toMatch(/pending/i);
  });

  it('exposes the verifier and the evidence summary', () => {
    render(<VerificationBadge claim={claim()} now={NOW} variant="full" />);
    expect(screen.getByText(/A\. Okafor/)).toBeInTheDocument();
    expect(screen.getByText(/DNS TXT record/)).toBeInTheDocument();
  });

  it('says so plainly when no evidence was recorded', () => {
    render(
      <VerificationBadge
        claim={claim({ state: 'unverified', verifierName: null, evidenceSummary: null })}
        now={NOW}
        variant="full"
      />,
    );
    expect(screen.getByText(/No verifier recorded/)).toBeInTheDocument();
    expect(screen.getByText(/no evidence summary recorded/)).toBeInTheDocument();
  });

  it('keeps the evidence disclosure keyboard reachable', () => {
    render(<VerificationBadge claim={claim()} now={NOW} />);
    const toggle = screen.getByRole('button', { name: /what was checked/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls');
  });
});

describe('<ProvenanceStamp>', () => {
  const provenance = (overrides: Partial<Provenance> = {}): Provenance => ({
    sourceUpdatedAt: '2026-05-20T00:00:00.000Z',
    verifiedAt: '2026-05-21T00:00:00.000Z',
    expiresAt: '2026-11-20T00:00:00.000Z',
    syncState: 'synced',
    sourceRef: 'partner-feed',
    reviewedBy: null,
    ...overrides,
  });

  it('renders source updated, verified and expires — permanently, not on hover', () => {
    render(<ProvenanceStamp provenance={provenance()} now={NOW} />);
    expect(screen.getByText('Source updated')).toBeVisible();
    expect(screen.getByText('Verified')).toBeVisible();
    expect(screen.getByText('Expires')).toBeVisible();
  });

  it('marks a stale record rather than presenting it as current', () => {
    const { container } = render(
      <ProvenanceStamp provenance={provenance({ syncState: 'stale' })} now={NOW} />,
    );
    expect(container.querySelector('[data-stale="true"]')).not.toBeNull();
    expect(screen.getByText('Not confirmed recently')).toBeInTheDocument();
  });

  it('treats a passed expiry as stale even when the sync state says synced', () => {
    const { container } = render(
      <ProvenanceStamp provenance={provenance({ expiresAt: '2026-01-01T00:00:00.000Z' })} now={NOW} />,
    );
    expect(container.querySelector('[data-stale="true"]')).not.toBeNull();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('names the reviewer on the manual-entry path', () => {
    render(
      <ProvenanceStamp
        provenance={provenance({ syncState: 'manual', reviewedBy: 'M. Haddad, Modex Ops' })}
        now={NOW}
      />,
    );
    expect(screen.getByText('M. Haddad, Modex Ops')).toBeInTheDocument();
  });

  it('lists the fields that could not be confirmed', () => {
    render(
      <ProvenanceStamp
        provenance={provenance({ syncState: 'stale' })}
        staleFields={['tuitionFee']}
        now={NOW}
      />,
    );
    expect(screen.getByText('tuitionFee')).toBeInTheDocument();
  });
});

describe('<EligibilityExplanation>', () => {
  const explanation = (overrides: Partial<Explanation> = {}): Explanation => ({
    programId: 'prog_1',
    intakeId: null,
    verdict: 'incomplete',
    evaluatedAt: '2026-06-01T00:00:00.000Z',
    catalogueVersion: '2026-05-30',
    checks: [
      {
        requirementId: 'r1',
        ruleType: 'english_language',
        outcome: 'pass',
        requirement: 'IELTS 6.5 overall with no band below 6.0.',
        studentValue: 'IELTS 7.0 (writing 6.5)',
        reason: 'Your recorded IELTS result meets the overall and per-band minimums.',
        sourceRef: 'https://example.ac.uk/entry',
        remedy: null,
      },
      {
        requirementId: 'r2',
        ruleType: 'academic_qualification',
        outcome: 'missing_data',
        requirement: 'A completed bachelor degree.',
        studentValue: null,
        reason: 'You have not added a degree transcript yet.',
        sourceRef: 'https://example.ac.uk/entry',
        remedy: 'Upload your transcript to the document vault to finish this check.',
      },
    ],
    ...overrides,
  });

  // The central rule: an absence of data must never render as a rejection.
  it('never collapses to a boolean and never reads missing data as a rejection', () => {
    render(<EligibilityExplanation explanation={explanation()} />);
    expect(screen.getByText(/cannot finish this check yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing here says you are ineligible/i)).toBeInTheDocument();
    expect(screen.getByText('We need more from you')).toBeInTheDocument();
  });

  it('shows the source of every requirement so it can be contested', () => {
    render(<EligibilityExplanation explanation={explanation()} />);
    expect(screen.getAllByText(/Source: https:\/\/example\.ac\.uk\/entry/)).toHaveLength(2);
  });

  it('tells the student what to do about a missing-data row', () => {
    render(<EligibilityExplanation explanation={explanation()} />);
    expect(screen.getByText(/Upload your transcript/)).toBeInTheDocument();
  });

  it('renders each of the four outcomes with a distinct label', () => {
    const outcomes = ['pass', 'fail', 'unknown', 'missing_data'] as const;
    const labels = ['Met', 'Not met', 'Cannot assess', 'We need more from you'];
    outcomes.forEach((outcome, index) => {
      const { unmount, container } = render(
        <EligibilityExplanation
          explanation={explanation({
            verdict: 'not_assessable',
            checks: [
              {
                requirementId: 'r',
                ruleType: 'gpa_minimum',
                outcome,
                requirement: 'GPA 3.0',
                studentValue: null,
                reason: 'reason',
                sourceRef: null,
                remedy: null,
              },
            ],
          })}
        />,
      );
      const list = container.querySelector('.mx-eligibility__list');
      expect(within(list as HTMLElement).getByText(labels[index] as string)).toBeInTheDocument();
      unmount();
    });
  });

  it('states that Modex does not make admission decisions', () => {
    render(<EligibilityExplanation explanation={explanation()} />);
    expect(screen.getByText(/does not make admission decisions/i)).toBeInTheDocument();
  });
});

describe('<DisclosureNotice>', () => {
  it('discloses a commercial relationship in plain words', () => {
    render(<DisclosureNotice kind="commission" />);
    expect(screen.getByText(/receives a fee from this university/i)).toBeInTheDocument();
    expect(screen.getByText(/does not come out of your tuition/i)).toBeInTheDocument();
  });

  it('states that ranking is not for sale', () => {
    render(<DisclosureNotice kind="ranking_method" />);
    expect(screen.getByText(/do not move a programme up this list/i)).toBeInTheDocument();
  });

  it('states that guides never collect fees', () => {
    render(<DisclosureNotice kind="guide_compensation" />);
    expect(screen.getByText(/cannot collect application fees or tuition/i)).toBeInTheDocument();
  });

  it('is a landmark, not a dismissible toast', () => {
    render(<DisclosureNotice kind="partnership" />);
    const notice = screen.getByRole('complementary', { name: /partnership disclosure/i });
    expect(notice).toBeInTheDocument();
    expect(within(notice).queryByRole('button')).toBeNull();
  });
});
