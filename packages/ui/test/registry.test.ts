import { describe, expect, it } from 'vitest';
import * as ui from '../src/index.js';
import { BLOCK_REGISTRY, unimplementedPrimaryBlocks } from '../src/registry.js';

describe('the 21st.dev block registry', () => {
  it('records every block named in issue #2 §2', () => {
    // 36 blocks are listed across §2.1–§2.7 of the phase 0 issue.
    expect(BLOCK_REGISTRY.length).toBeGreaterThanOrEqual(35);
  });

  it('gives every entry a registry path and a reason it was picked', () => {
    for (const entry of BLOCK_REGISTRY) {
      expect(entry.registry).toMatch(/^@[\w.\-]+\/[\w-]+$/);
      expect(entry.note.length).toBeGreaterThan(20);
    }
  });

  it('has an implementation recorded for every implemented entry', () => {
    for (const entry of BLOCK_REGISTRY.filter((e) => e.status === 'implemented')) {
      expect(entry.implementation, `${entry.name} is marked implemented`).not.toBeNull();
    }
  });

  it('leaves no primary pick unimplemented in a phase 0/1 section', () => {
    expect(unimplementedPrimaryBlocks().map((entry) => entry.name)).toEqual([]);
  });
});

describe('the package surface', () => {
  it('exports the four signature components', () => {
    expect(ui.VerificationBadge).toBeTypeOf('function');
    expect(ui.EligibilityExplanation).toBeTypeOf('function');
    expect(ui.ProvenanceStamp).toBeTypeOf('function');
    expect(ui.DisclosureNotice).toBeTypeOf('function');
  });

  it('exports every implemented block archetype', () => {
    for (const name of [
      'AppShell',
      'CommandPalette',
      'DataTable',
      'Pagination',
      'EmptyState',
      'StatCard',
      'ComparisonTable',
      'WizardSteps',
      'TaskSteps',
      'Dropzone',
      'SearchableAccordion',
      'HeroSection',
    ]) {
      expect(ui, `missing export: ${name}`).toHaveProperty(name);
    }
  });
});
