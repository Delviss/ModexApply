/**
 * Effective dating for the programme catalogue (Phase 1 section 3).
 *
 * "A change creates a new effective record, it does not overwrite history."
 *
 * The reason is epic principle 3: every submission must be reproducible from an
 * immutable snapshot. If editing a tuition figure mutated the row, then a
 * snapshot taken last month would silently start resolving to this month's
 * price, and the platform's central promise -- that you can reconstruct exactly
 * what a student was shown when they applied -- would be false.
 *
 * The mechanics:
 *   * `programKey` is stable across versions; `id` identifies one version.
 *   * The current version is the one with `effectiveTo === null`.
 *   * Editing closes the current version at `now` and opens a new one at `now`,
 *     so the timeline has no gaps and no overlaps.
 *   * A snapshot stores the version `id`, which never changes again.
 */

export interface VersionedRecord {
  id: string;
  programKey: string;
  version: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface SupersedeResult<T> {
  /** Update to apply to the outgoing version. */
  close: { id: string; effectiveTo: Date };
  /** Row to insert for the incoming version. */
  create: T & { programKey: string; version: number; effectiveFrom: Date; effectiveTo: null };
}

export function supersede<T extends object>(
  current: VersionedRecord,
  changes: T,
  now: Date = new Date(),
): SupersedeResult<T> {
  if (current.effectiveTo !== null) {
    throw new Error(
      `Cannot supersede version ${current.version} of ${current.programKey}: it was already closed ` +
        `at ${current.effectiveTo.toISOString()}. Only the current version can be edited.`,
    );
  }
  // The new version opens exactly when the old one closes: no gap in which a
  // reader would find no current record, and no overlap in which two match.
  return {
    close: { id: current.id, effectiveTo: now },
    create: {
      ...changes,
      programKey: current.programKey,
      version: current.version + 1,
      effectiveFrom: now,
      effectiveTo: null,
    },
  };
}

/** The version that was current at a given instant. Used to resolve snapshots. */
export function versionAt<T extends VersionedRecord>(versions: readonly T[], at: Date): T | null {
  return (
    versions.find(
      (version) =>
        version.effectiveFrom <= at && (version.effectiveTo === null || version.effectiveTo > at),
    ) ?? null
  );
}

export function currentVersion<T extends VersionedRecord>(versions: readonly T[]): T | null {
  return versions.find((version) => version.effectiveTo === null) ?? null;
}

/**
 * Validates a version timeline: no gaps, no overlaps, exactly one open version.
 * Asserted by the catalogue tests, because a broken timeline makes every
 * snapshot that touches it unresolvable.
 */
export function validateTimeline(versions: readonly VersionedRecord[]): {
  valid: boolean;
  problems: string[];
} {
  const problems: string[] = [];
  const ordered = [...versions].sort((a, b) => a.version - b.version);

  const open = ordered.filter((version) => version.effectiveTo === null);
  if (open.length === 0) problems.push('No current version: every version is closed.');
  if (open.length > 1) {
    problems.push(`${open.length} versions are open; exactly one must have effectiveTo === null.`);
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const next = ordered[index];
    if (previous === undefined || next === undefined) continue;
    if (previous.version + 1 !== next.version) {
      problems.push(`Version numbers jump from ${previous.version} to ${next.version}.`);
    }
    if (previous.effectiveTo === null) {
      problems.push(`Version ${previous.version} is open but version ${next.version} exists after it.`);
      continue;
    }
    if (previous.effectiveTo.getTime() !== next.effectiveFrom.getTime()) {
      problems.push(
        `Version ${previous.version} closes at ${previous.effectiveTo.toISOString()} but version ` +
          `${next.version} opens at ${next.effectiveFrom.toISOString()}.`,
      );
    }
  }

  return { valid: problems.length === 0, problems };
}
