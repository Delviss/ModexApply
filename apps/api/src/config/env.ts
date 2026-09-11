import { z } from 'zod';

/**
 * Environment is validated at boot and never read via `process.env` elsewhere.
 * A missing secret should stop the process on line one, not surface as a 500 at
 * 3am on the one code path that needed it.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.string().min(1),

  /** Signing key for access tokens. Rotated through the managed secret store. */
  JWT_SIGNING_KEY: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().default(60 * 60 * 24 * 30),

  /**
   * Passphrase the per-user TOTP secrets are sealed with (Phase 6 §2).
   *
   * The sealed blob lives in `users.mfaSecretRef`; this key lives in the managed
   * secret store, so a database backup on its own cannot mint codes. Rotating it
   * invalidates every enrolment, which is why it is separate from
   * `JWT_SIGNING_KEY` — those rotate on very different schedules.
   */
  MFA_SECRET_KEY: z.string().min(32),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  /**
   * Proxy hops in front of the API (Phase 7 §1).
   *
   * `X-Forwarded-For` is walked from the right by exactly this many entries to
   * find the client address, and everything further left is ignored. The
   * default of 1 matches a single load balancer; a deployment behind a CDN as
   * well needs 2. Setting it too high is a rate-limit bypass, and setting it to
   * 0 behind a proxy makes every request look like it came from the balancer.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('eu-west-2'),
  S3_BUCKET: z.string().default('modex-documents'),
  S3_ACCESS_KEY_ID: z.string().default('modex'),
  S3_SECRET_ACCESS_KEY: z.string().default('modex-local-secret'),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().max(900).default(300),

  /**
   * Malware scanning (Phase 2 §2).
   *
   * The default is `none`, which is the **fail-closed** setting: no scanner
   * means every document stays `pending` and nothing reaches a university
   * connector. An environment that wants documents to flow has to say which
   * scanner it trusts.
   */
  MALWARE_SCANNER: z.enum(['none', 'clamav']).default('none'),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),

  /**
   * Per-country document retention, as `GB:2555,NG:1825`, with `default:` for
   * everything else. Launch-market data rules differ and are still an open
   * decision (issue #1 §7), so this is configuration rather than a constant.
   */
  DOCUMENT_RETENTION_DAYS: z.string().default('default:2555'),

  /**
   * Which `SearchIndex` adapter to use. `postgres` today; `opensearch` when the
   * adapter lands against the same contract tests.
   */
  SEARCH_INDEX_DRIVER: z.enum(['postgres', 'opensearch']).default('postgres'),
  OPENSEARCH_URL: z.string().optional(),

  /** Public origin, used in domain-confirmation copy and CORS. */
  PUBLIC_WEB_ORIGIN: z.string().default('http://localhost:3000'),

  /**
   * Feature flags, required from day one for connector rollout and
   * market-specific behaviour (Phase 0 §3.1). Comma-separated enabled flags.
   */
  FEATURE_FLAGS: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
