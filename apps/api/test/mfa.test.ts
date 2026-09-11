import { describe, expect, it } from 'vitest';
import { MfaService, TOTP_STEP_SECONDS, base32Decode, base32Encode } from '../src/auth/mfa.service.js';

const KEY = 'test-mfa-sealing-key-at-least-32-characters';

describe('TOTP', () => {
  const mfa = new MfaService(KEY);

  it('accepts the code its own secret produces', () => {
    const { sealed } = mfa.enrol('staff@example.ac.uk');
    expect(mfa.verify(sealed, mfa.currentCode(sealed))).toBe(true);
  });

  it('accepts one step of drift either side and refuses two', () => {
    const now = new Date('2026-09-11T12:00:00.000Z');
    const { sealed } = mfa.enrol('staff@example.ac.uk');
    const code = mfa.currentCode(sealed, now);

    const oneStepLater = new Date(now.getTime() + TOTP_STEP_SECONDS * 1_000);
    const threeStepsLater = new Date(now.getTime() + 3 * TOTP_STEP_SECONDS * 1_000);
    expect(mfa.verify(sealed, code, oneStepLater)).toBe(true);
    expect(mfa.verify(sealed, code, threeStepsLater)).toBe(false);
  });

  it('refuses anything that is not six digits without touching the secret', () => {
    const { sealed } = mfa.enrol('staff@example.ac.uk');
    expect(mfa.verify(sealed, '')).toBe(false);
    expect(mfa.verify(sealed, 'abcdef')).toBe(false);
    expect(mfa.verify(sealed, '12345')).toBe(false);
  });

  it('does not accept another account’s code', () => {
    const a = mfa.enrol('a@example.ac.uk');
    const b = mfa.enrol('b@example.ac.uk');
    expect(mfa.verify(a.sealed, mfa.currentCode(b.sealed))).toBe(false);
  });

  it('seals the secret so the stored value is not the secret', () => {
    const { secret, sealed } = mfa.enrol('staff@example.ac.uk');
    expect(sealed).not.toContain(secret);
    expect(sealed.startsWith('aesgcm.v1:')).toBe(true);
    expect(sealed.split(':')).toHaveLength(4);
  });

  it('cannot be opened with a different key', () => {
    const { sealed } = mfa.enrol('staff@example.ac.uk');
    const other = new MfaService('a-completely-different-key-32-characters-long');
    // Surfaces as an operational failure rather than "wrong code", so a key
    // rotation does not send every operator hunting for their phone.
    expect(() => other.verify(sealed, '000000')).toThrowError(/temporarily unavailable/);
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 128, 64]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it('produces an otpauth URI an authenticator can read', () => {
    const { otpauthUrl, secret } = mfa.enrol('staff@example.ac.uk');
    expect(otpauthUrl).toContain('otpauth://totp/');
    expect(otpauthUrl).toContain(`secret=${secret}`);
    expect(otpauthUrl).toContain('issuer=Modex%20Apply');
  });
});
