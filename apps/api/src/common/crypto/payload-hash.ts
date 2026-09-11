import { createHash } from 'node:crypto';
import { canonicalJson, type ApplicationPayload } from '@modex/contracts';

/**
 * The half of the payload contract that needs a cryptographic runtime.
 *
 * It lives in the API rather than in `@modex/contracts` for one concrete
 * reason: `apps/web` compiles the contracts package from source into client
 * bundles (`transpilePackages`), and a `node:crypto` import anywhere in that
 * barrel breaks the browser build of every client component that imports a
 * label or a state helper from it.
 *
 * So the *rule* — canonical JSON, sorted keys, bytes as a function of values
 * rather than of insertion order — stays in `domain/applications.ts` where the
 * browser can see it and a contract test can check it. Only the digest is
 * here, and nothing in the browser needs to compute a digest: it reads the one
 * the API already stored.
 */

/** SHA-256 over the canonical form. The hash stored on a snapshot. */
export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

/**
 * The profile version.
 *
 * `StudentProfile` has no version column and deliberately gains none: a counter
 * would have to be bumped by every write path, and a path that forgets produces
 * a snapshot that lies. A content hash cannot be forgotten — it is computed from
 * the values that went into the payload, so two snapshots share a version
 * exactly when they were built from identical profile data.
 */
export function profileVersionOf(profile: ApplicationPayload['profile'] | unknown): string {
  return payloadHash(profile).slice(0, 32);
}

/**
 * Verifies a snapshot against itself: regenerate the canonical bytes from the
 * stored payload and check the stored hash still describes them.
 *
 * The acceptance criterion is "the original payload still reproduces and its
 * hash still verifies", and this is the function that answers it — in a test,
 * in the trust console, and on the student's own receipt.
 */
export function verifySnapshot(snapshot: { payload: unknown; payloadHash: string }): {
  valid: boolean;
  recomputed: string;
} {
  const recomputed = payloadHash(snapshot.payload);
  return { valid: recomputed === snapshot.payloadHash, recomputed };
}
