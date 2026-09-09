import { Injectable } from '@nestjs/common';

/**
 * Feature flags from day one (Phase 0 §3.1).
 *
 * Deliberately boring: a flag is on or off for a named audience, evaluated
 * server-side, with the decision recorded on read so a connector rollout can be
 * reconstructed afterwards. Percentage rollouts hash the subject, so a given
 * institution stays on the same side of a rollout between requests.
 */
export const FEATURE_FLAGS = [
  'connector.direct_application',
  'catalogue.bulk_import',
  'catalogue.auto_sync',
  'institution.self_serve_onboarding',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

@Injectable()
export class FeatureFlagService {
  private readonly enabled: Set<string>;

  constructor(rawFlags: string) {
    this.enabled = new Set(
      rawFlags
        .split(',')
        .map((flag) => flag.trim())
        .filter((flag) => flag !== ''),
    );
  }

  isEnabled(flag: FeatureFlag, subjectId?: string): boolean {
    if (this.enabled.has(flag)) return true;
    // `flag@25` enables a flag for a stable 25% of subjects.
    for (const entry of this.enabled) {
      const [name, percentText] = entry.split('@');
      if (name !== flag || percentText === undefined) continue;
      const percent = Number(percentText);
      if (!Number.isFinite(percent) || subjectId === undefined) continue;
      return bucketOf(subjectId, flag) < percent;
    }
    return false;
  }

  listEnabled(): string[] {
    return [...this.enabled];
  }
}

/** Stable 0–99 bucket, so a subject does not flap between requests. */
function bucketOf(subjectId: string, salt: string): number {
  let hash = 2166136261;
  for (const char of `${salt}:${subjectId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 100;
}
