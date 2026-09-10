import { describe, expect, it } from 'vitest';
import {
  IDENTITY_DRIFT_THRESHOLD,
  actionFor,
  canTransitionCase,
  exceedsMessageRate,
  flagSummary,
  normaliseForScanning,
  requiresReverificationForDrift,
  scanMessage,
  SIGNAL_CASE_TYPE,
  suspendsImmediately,
  type RiskSignal,
} from '../src/domain/trust.js';

const signals = (body: string, sender: 'guide' | 'student' = 'guide'): RiskSignal[] =>
  scanMessage(body, sender).findings.map((finding) => finding.signal);

describe('payment solicitation', () => {
  it('catches the ways a guide asks for money', () => {
    const attempts = [
      'Send me the deposit and I will hold your place.',
      'You can transfer the money to my bank account today.',
      'my paypal is ready, just pay me 200 and it is done',
      'IBAN: GB29 NWBK 6016 1331 9268 19',
      'Pay via Western Union, it is faster.',
      'The processing fee is 150 GBP, payable to me.',
    ];
    for (const attempt of attempts) {
      expect(signals(attempt), attempt).toContain('payment_solicitation');
    }
  });

  it('sees through spaced-out and digit-swapped obfuscation', () => {
    expect(signals('p a y  m e  first')).toContain('payment_solicitation');
    expect(signals('my b4nk details are below')).toContain('payment_solicitation');
  });

  it('does not flag a student asking an ordinary question about fees', () => {
    const ordinary = [
      'How much is the tuition deposit, and when do I pay the university?',
      'Did you have to pay an application fee?',
      'Is the accommodation deposit refundable?',
    ];
    for (const question of ordinary) {
      expect(signals(question, 'student'), question).not.toContain('payment_solicitation');
    }
  });

  it('warns a student who offers to pay, without treating them as the scammer', () => {
    const assessment = scanMessage('I can pay you for your help, just send me your bank details', 'student');
    const finding = assessment.findings.find((entry) => entry.signal === 'payment_solicitation');
    expect(finding?.severity).toBe('medium');
    expect(suspendsImmediately(assessment.severity)).toBe(false);
  });

  it('treats a guide asking for money as immediately suspendable', () => {
    const assessment = scanMessage('transfer the money to my account', 'guide');
    expect(assessment.severity).toBe('critical');
    expect(suspendsImmediately(assessment.severity)).toBe(true);
    expect(assessment.action).toBe('warn_and_open_case');
  });
});

describe('guarantee claims', () => {
  it('catches promises about admission and visas', () => {
    const claims = [
      'I guarantee you admission if you apply through me',
      '100% acceptance, nobody is rejected here',
      'I can get you in, my friend works there',
      'your visa is guaranteed with this university',
    ];
    for (const claim of claims) {
      expect(signals(claim), claim).toContain('guarantee_claim');
    }
  });

  it('leaves honest hedged experience alone', () => {
    const honest = [
      'I applied with a 3.2 GPA and got in, but everyone is different.',
      'My visa took six weeks. There is no guarantee, it depends on your documents.',
    ];
    for (const line of honest) {
      expect(signals(line), line).not.toContain('guarantee_claim');
    }
  });
});

describe('off-platform solicitation', () => {
  it('catches the move to another app and the shared contact details', () => {
    expect(signals('add me on whatsapp')).toContain('off_platform_solicitation');
    expect(signals('message me on telegram, it is quicker')).toContain('off_platform_solicitation');
    expect(signals('my number is +44 7700 900123')).toContain('off_platform_solicitation');
    expect(signals('write to me at helper@gmail.com')).toContain('off_platform_solicitation');
  });

  it('does not flag the platform’s own address', () => {
    expect(signals('forward it to trust@modex.example')).not.toContain('off_platform_solicitation');
  });
});

describe('impersonation', () => {
  it('catches a guide claiming to be staff or to decide admissions', () => {
    expect(signals('I am an admissions officer here')).toContain('impersonation');
    expect(signals('I work for the university international office')).toContain('impersonation');
    expect(signals('I review your application personally')).toContain('impersonation');
  });

  it('leaves a guide describing their actual job alone', () => {
    expect(signals('I work in the library part-time, 8 hours a week')).not.toContain('impersonation');
  });
});

describe('assessment', () => {
  it('allows a clean message and opens nothing', () => {
    const assessment = scanMessage('Halls are about 140 a week, and the kitchens are shared.', 'guide');
    expect(assessment.findings).toEqual([]);
    expect(assessment.severity).toBeNull();
    expect(assessment.action).toBe('allow');
    expect(flagSummary(assessment)).toBeNull();
  });

  it('warns without a case for a low-severity finding, and opens one above that', () => {
    expect(actionFor('low')).toBe('warn');
    expect(actionFor('medium')).toBe('warn_and_open_case');
    expect(actionFor('critical')).toBe('warn_and_open_case');
    expect(actionFor(null)).toBe('allow');
  });

  it('gives the student a warning that names what to do', () => {
    const assessment = scanMessage('send me the money by western union', 'guide');
    expect(flagSummary(assessment)).toContain('never collect tuition');
    expect(assessment.findings[0]?.matches.length).toBeGreaterThan(0);
  });

  it('maps every risk signal to a trust case type', () => {
    for (const signal of Object.keys(SIGNAL_CASE_TYPE) as RiskSignal[]) {
      expect(SIGNAL_CASE_TYPE[signal]).toBeTruthy();
    }
  });
});

describe('normalisation', () => {
  it('rejoins spaced words and strips zero-width padding', () => {
    expect(normaliseForScanning('w h a t s a p p')).toContain('whatsapp');
    expect(normaliseForScanning('what​s​app')).toContain('whatsapp');
  });

  it('leaves ordinary two-letter pairs alone', () => {
    expect(normaliseForScanning('a b')).toBe('a b');
  });
});

describe('rate limits and drift', () => {
  it('fires on volume or on breadth, not only on both', () => {
    expect(exceedsMessageRate({ messagesLastHour: 61, distinctRecipientsLastHour: 2 })).toBe(true);
    expect(exceedsMessageRate({ messagesLastHour: 5, distinctRecipientsLastHour: 21 })).toBe(true);
    expect(exceedsMessageRate({ messagesLastHour: 40, distinctRecipientsLastHour: 10 })).toBe(false);
  });

  it('forces reverification after enough identity changes inside the window', () => {
    const recent = Array.from({ length: IDENTITY_DRIFT_THRESHOLD }, (_, index) => ({
      changedAt: new Date(2026, 4, index + 1).toISOString(),
    }));
    expect(requiresReverificationForDrift(recent, new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
    expect(requiresReverificationForDrift(recent.slice(1), new Date('2026-06-01T00:00:00.000Z'))).toBe(
      false,
    );
    // The same changes, long ago, are a history rather than a pattern.
    expect(requiresReverificationForDrift(recent, new Date('2028-06-01T00:00:00.000Z'))).toBe(false);
  });
});

describe('trust case state machine', () => {
  it('allows the triage path and closes terminally', () => {
    expect(canTransitionCase('open', 'triaging')).toBe(true);
    expect(canTransitionCase('triaging', 'evidence_preserved')).toBe(true);
    expect(canTransitionCase('evidence_preserved', 'actioned')).toBe(true);
    expect(canTransitionCase('actioned', 'open')).toBe(false);
    expect(canTransitionCase('dismissed', 'triaging')).toBe(false);
  });
});
