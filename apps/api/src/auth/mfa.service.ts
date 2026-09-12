import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { AppError } from '../common/errors/app-error.js';

/**
 * TOTP (RFC 6238) for the staff roles, and the step-up challenge behind it.
 *
 * MFA is mandatory for every staff and high-risk role (Phase 0 §3.2), and Phase
 * 6 adds a second question on top of it: not "who signed in three hours ago"
 * but "who is at the keyboard now". Both use the same authenticator app and the
 * same code path; only what they update differs.
 *
 * Three things are deliberate here.
 *
 * **The shared secret is never stored in the clear.** `users.mfaSecretRef` holds
 * a sealed blob, and the key that opens it lives in the environment — which in
 * a deployed environment means the managed secret store. A database backup, on
 * its own, does not let anyone mint codes.
 *
 * **Verification accepts one step either side.** Phones drift. A ±30s window is
 * the standard trade-off; widening it further would start to make a stolen code
 * useful for minutes rather than seconds.
 *
 * **Comparison is constant-time.** A six-digit code compared with `===` leaks
 * its prefix through timing, which turns 10^6 guesses into something far
 * smaller.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** One step either side of now. */
export const TOTP_DRIFT_STEPS = 1;

const SEAL_PREFIX = 'aesgcm.v1';
/**
 * `:` rather than `.`, because the version prefix contains a dot of its own and
 * base64url never does. Splitting on the wrong character produced five parts
 * instead of four and made every sealed secret unopenable.
 */
const SEAL_SEPARATOR = ':';

@Injectable()
export class MfaService {
  private readonly key: Buffer;

  constructor(encryptionKey: string) {
    // scrypt rather than the raw string: the env value is a passphrase, and
    // AES-256-GCM needs exactly 32 bytes of key material.
    this.key = scryptSync(encryptionKey, 'modex-mfa-secret-v1', 32);
  }

  /** A fresh base32 shared secret, plus the URI an authenticator app scans. */
  enrol(accountEmail: string): { secret: string; otpauthUrl: string; sealed: string } {
    const secret = base32Encode(randomBytes(20));
    const label = encodeURIComponent(`Modex Apply:${accountEmail}`);
    return {
      secret,
      otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Modex%20Apply&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`,
      sealed: this.seal(secret),
    };
  }

  /**
   * Checks a code against a sealed secret.
   *
   * Returns a boolean rather than throwing, because the caller decides what a
   * failure means: a failed enrolment confirmation and a failed step-up are
   * different audit events and different responses.
   */
  verify(sealedSecret: string, code: string, now: Date = new Date()): boolean {
    const normalised = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(normalised)) return false;

    const secret = this.open(sealedSecret);
    const counter = Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
    for (let offset = -TOTP_DRIFT_STEPS; offset <= TOTP_DRIFT_STEPS; offset += 1) {
      if (constantTimeEquals(totp(secret, counter + offset), normalised)) return true;
    }
    return false;
  }

  /** The current code. Used by tests and by the local development helper only. */
  currentCode(sealedSecret: string, now: Date = new Date()): string {
    return totp(this.open(sealedSecret), Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS));
  }

  seal(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [
      SEAL_PREFIX,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(SEAL_SEPARATOR);
  }

  private open(sealed: string): string {
    const [prefix, iv, tag, ciphertext] = sealed.split(SEAL_SEPARATOR);
    if (prefix !== SEAL_PREFIX || iv === undefined || tag === undefined || ciphertext === undefined) {
      throw unopenable();
    }

    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      // A wrong key fails the GCM tag check and raises "unable to authenticate
      // data" — which, unwrapped, reaches the operator as a 500 and reaches the
      // on-call engineer as a mystery. Naming it is the difference between a
      // five-minute diagnosis and an hour of it.
      throw unopenable(error);
    }
  }
}

/**
 * A secret we cannot open is an operational failure, not a user error: the
 * sealing key has been rotated without re-sealing, and telling somebody their
 * code is wrong would send them chasing their phone instead.
 */
function unopenable(cause?: unknown): AppError {
  return new AppError(
    'dependency_unavailable',
    'Multi-factor authentication is temporarily unavailable. Contact support.',
    cause === undefined ? {} : { cause },
  );
}

/** RFC 4226 HOTP, truncated to six digits — the counter is the time step. */
function totp(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of input.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
