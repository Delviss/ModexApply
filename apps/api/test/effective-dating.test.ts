import { describe, expect, it } from 'vitest';
import {
  currentVersion,
  supersede,
  validateTimeline,
  versionAt,
  type VersionedRecord,
} from '../src/catalogue/effective-dating.js';

const T1 = new Date('2026-01-01T00:00:00.000Z');
const T2 = new Date('2026-03-01T00:00:00.000Z');
const T3 = new Date('2026-06-01T00:00:00.000Z');

const v1: VersionedRecord = {
  id: 'prog_v1',
  programKey: 'key_1',
  version: 1,
  effectiveFrom: T1,
  effectiveTo: null,
};

describe('effective dating', () => {
  it('closes the old version exactly where the new one opens', () => {
    const plan = supersede(v1, { name: 'MSc Data Science' }, T2);
    expect(plan.close).toEqual({ id: 'prog_v1', effectiveTo: T2 });
    expect(plan.create.effectiveFrom).toEqual(T2);
    expect(plan.create.effectiveTo).toBeNull();
    expect(plan.create.version).toBe(2);
    expect(plan.create.programKey).toBe('key_1');
  });

  it('refuses to edit a closed version', () => {
    expect(() => supersede({ ...v1, effectiveTo: T2 }, { name: 'x' }, T3)).toThrowError(
      /already closed/,
    );
  });

  // The reason effective dating exists: a snapshot taken in February must still
  // resolve to what the student was shown in February.
  it('resolves the version that was current at a past instant', () => {
    const versions: VersionedRecord[] = [
      { ...v1, effectiveTo: T2 },
      { id: 'prog_v2', programKey: 'key_1', version: 2, effectiveFrom: T2, effectiveTo: null },
    ];
    expect(versionAt(versions, new Date('2026-02-01T00:00:00.000Z'))?.id).toBe('prog_v1');
    expect(versionAt(versions, T3)?.id).toBe('prog_v2');
    expect(versionAt(versions, new Date('2025-01-01T00:00:00.000Z'))).toBeNull();
    expect(currentVersion(versions)?.id).toBe('prog_v2');
  });

  it('treats the boundary instant as belonging to the new version', () => {
    const versions: VersionedRecord[] = [
      { ...v1, effectiveTo: T2 },
      { id: 'prog_v2', programKey: 'key_1', version: 2, effectiveFrom: T2, effectiveTo: null },
    ];
    expect(versionAt(versions, T2)?.id).toBe('prog_v2');
  });

  describe('timeline validation', () => {
    it('accepts a well-formed timeline', () => {
      expect(
        validateTimeline([
          { ...v1, effectiveTo: T2 },
          { id: 'v2', programKey: 'key_1', version: 2, effectiveFrom: T2, effectiveTo: null },
        ]).valid,
      ).toBe(true);
    });

    it('catches a gap between versions', () => {
      const result = validateTimeline([
        { ...v1, effectiveTo: T2 },
        { id: 'v2', programKey: 'key_1', version: 2, effectiveFrom: T3, effectiveTo: null },
      ]);
      expect(result.valid).toBe(false);
      expect(result.problems.join(' ')).toMatch(/closes at .* but version 2 opens at/);
    });

    it('catches two open versions', () => {
      const result = validateTimeline([
        v1,
        { id: 'v2', programKey: 'key_1', version: 2, effectiveFrom: T2, effectiveTo: null },
      ]);
      expect(result.valid).toBe(false);
      expect(result.problems.join(' ')).toMatch(/2 versions are open/);
    });

    it('catches a missing current version', () => {
      const result = validateTimeline([{ ...v1, effectiveTo: T2 }]);
      expect(result.valid).toBe(false);
      expect(result.problems.join(' ')).toMatch(/No current version/);
    });
  });
});
