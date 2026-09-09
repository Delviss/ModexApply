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

  REDIS_URL: z.string().default('redis://localhost:6379'),

  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('eu-west-2'),
  S3_BUCKET: z.string().default('modex-documents'),
  S3_ACCESS_KEY_ID: z.string().default('modex'),
  S3_SECRET_ACCESS_KEY: z.string().default('modex-local-secret'),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().max(900).default(300),

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
