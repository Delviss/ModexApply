/**
 * The 21st.dev block manifest.
 *
 * Issue #2 §2 names a specific set of community blocks; issue #3 pins the picks
 * for the Phase 1 surfaces. Installing them needs `API_KEY_21ST`, which lives in
 * the managed secret store and is not available in this environment — so each
 * entry records the registry path it is sourced from, what it maps to here, and
 * whether it has been implemented yet.
 *
 * This is the traceability record for the re-theming rule. When the key is
 * available, `npx shadcn@latest add "https://21st.dev/r/<path>?api_key=$API_KEY_21ST"`
 * pulls the vendor source; the re-theme is then a diff against the component
 * named in `implementation`, and the vendor-colour CI gate is what proves it was
 * finished.
 */

export type BlockStatus =
  /** Implemented in this package, re-themed onto the Red Velvet tokens. */
  | 'implemented'
  /** Named in the issue as an alternate or upgrade path; not yet built. */
  | 'deferred';

export interface BlockEntry {
  /** 21st.dev registry path, without the `https://21st.dev/r/` prefix. */
  registry: string;
  name: string;
  section: string;
  primary: boolean;
  status: BlockStatus;
  /** Export in `@modex/ui` that carries this archetype, once implemented. */
  implementation: string | null;
  /** Why it was picked, and what had to be rebound on the way in. */
  note: string;
}

export const BLOCK_REGISTRY: readonly BlockEntry[] = Object.freeze([
  // §2.1 App shell & navigation
  {
    registry: '@arunjdass/dashboard-sidebar',
    name: 'Dashboard Sidebar',
    section: 'app-shell',
    primary: true,
    status: 'implemented',
    implementation: 'AppShell',
    note: 'Primary shell for the student, university, trust and ops portals. Vendor palette replaced wholesale; brand crimson kept to the mark and the active nav item.',
  },
  {
    registry: '@ruixen.ui/sidebar-showcase',
    name: 'SidebarShowcase',
    section: 'app-shell',
    primary: false,
    status: 'implemented',
    implementation: 'AppShell (organisation slot)',
    note: 'Org-switcher pattern folded into AppShell rather than shipped as a second shell.',
  },
  {
    registry: '@unlumen/sidebar-001',
    name: 'Animated Sidebar',
    section: 'app-shell',
    primary: false,
    status: 'deferred',
    implementation: null,
    note: 'Drag-to-resize and animated active indicator. Deferred: AppShell covers the need, and the animation needs the reduced-motion gate before it earns its place.',
  },
  {
    registry: '@ddoemonn/command-palette',
    name: 'Command Palette',
    section: 'app-shell',
    primary: true,
    status: 'implemented',
    implementation: 'CommandPalette',
    note: '⌘K fuzzy search with arrow-key navigation.',
  },
  {
    registry: '@lovesickfromthe6ix/omni-command-palette',
    name: 'Omni Command Palette',
    section: 'app-shell',
    primary: false,
    status: 'implemented',
    implementation: 'CommandPalette (student dashboard actions)',
    note: 'Multi-source palette over programmes, documents and profile actions, now that Phase 2 gives it something to search across.',
  },
  {
    registry: '@cnippet-dev/v-skeleton-8',
    name: 'Sidebar Dashboard Skeleton',
    section: 'app-shell',
    primary: false,
    status: 'implemented',
    implementation: 'Skeleton',
    note: 'Loading state built from the Skeleton primitive rather than a dedicated block.',
  },

  // §2.2 Data display
  {
    registry: '@7ovr/team-members-data-table',
    name: 'Team Members Data Table',
    section: 'data-display',
    primary: true,
    status: 'implemented',
    implementation: 'DataTable',
    note: 'Primary table: sort, search, checkbox selection, bulk actions, status badges, column visibility. Status badges rebound to the semantic tokens.',
  },
  {
    registry: '@hero_ui/heroui-table',
    name: 'HeroUI Table',
    section: 'data-display',
    primary: false,
    status: 'implemented',
    implementation: 'SyncDiffTable (apps/web)',
    note: 'Expandable rows for the per-field sync diff. Implemented as a purpose-built table in the catalogue admin rather than pulling the vendor dependency.',
  },
  {
    registry: '@felipemenezes098/table-row-selection',
    name: 'Data Table Row Selection',
    section: 'data-display',
    primary: false,
    status: 'implemented',
    implementation: 'DataTable (bulk toolbar)',
    note: 'Selected-count toolbar folded into DataTable.',
  },
  {
    registry: '@shadcnui-blocks/pagination-14',
    name: 'Table Pagination',
    section: 'data-display',
    primary: true,
    status: 'implemented',
    implementation: 'Pagination',
    note: 'Rows-per-page plus range label. Rebuilt cursor-based to match the API contract; there is no page number.',
  },
  {
    registry: '@ruixen.ui/flexi-filter-table',
    name: 'Flexi Filter Table',
    section: 'data-display',
    primary: false,
    status: 'implemented',
    implementation: 'CatalogueFilters (apps/web)',
    note: 'Configurable filter categories for level, field, intake and sync state.',
  },
  {
    registry: '@cnippet-dev/cnippet-empty',
    name: 'Empty',
    section: 'data-display',
    primary: true,
    status: 'implemented',
    implementation: 'EmptyState',
    note: 'Primary empty state and the carrier for the "explain why there are no results" rule — `description` is a required prop for exactly that reason.',
  },
  {
    registry: '@shadcnui-blocks/empty-state-04',
    name: 'Empty State with Marquee',
    section: 'data-display',
    primary: false,
    status: 'deferred',
    implementation: null,
    note: 'First-run state for an institution with no programmes. EmptyState covers it; the marquee is decoration this surface does not need.',
  },
  {
    registry: '@felipemenezes098/card-05',
    name: 'Stat Card',
    section: 'data-display',
    primary: true,
    status: 'implemented',
    implementation: 'StatCard',
    note: 'Primary KPI tile. Downward trend badge uses --mx-danger, never brand crimson (issue #3 re-theming note).',
  },
  {
    registry: '@uilayout.contact/advanced-stats',
    name: 'Advanced Stats',
    section: 'data-display',
    primary: false,
    status: 'deferred',
    implementation: null,
    note: 'Area chart + KPI row for university analytics. Belongs with the Phase 6 university portal.',
  },
  {
    registry: '@makviesainte/progress-metric-card',
    name: 'Progress Metric Card',
    section: 'data-display',
    primary: false,
    status: 'deferred',
    implementation: null,
    note: 'Recharts-based. Deferred with the rest of the charting surface; the dataviz palette in tokens is ready for it.',
  },
  {
    registry: '@7ovr/comparison-3',
    name: 'Feature Comparison Table',
    section: 'data-display',
    primary: true,
    status: 'implemented',
    implementation: 'ComparisonTable',
    note: 'Primary programme and offer compare. Highlighted column uses the tinted brand surface, never a crimson fill — highlighting marks the reader’s selection, not an endorsement.',
  },

  // §2.3 Forms & multi-step flows
  {
    registry: '@ddoemonn/wizard-steps',
    name: 'Wizard Steps',
    section: 'forms',
    primary: true,
    status: 'implemented',
    implementation: 'WizardSteps',
    note: 'Primary onboarding and application wizard. Framer Motion transition replaced with a token-bound CSS fade gated on prefers-reduced-motion.',
  },
  {
    registry: '@dhileepkumargm/multi-step-wizard',
    name: 'Multi-step Wizard',
    section: 'forms',
    primary: false,
    status: 'implemented',
    implementation: 'WizardSteps (validate hook)',
    note: 'Per-step validation pattern adopted: a step is unreachable until every step before it validates.',
  },
  // Phase 3 (#5) archetypes.
  {
    registry: '@ruixen.ui/flexi-filter-table',
    name: 'Flexi Filter Table (guide directory)',
    section: 'messaging',
    primary: false,
    status: 'implemented',
    implementation: 'GuideCard + directory facets (apps/web)',
    note: 'Named for the guide directory facets — university, campus, programme, language, topic, home country. Rebuilt as cards rather than rows: a person is not a table row, and the verification badge and match reason do not fit in a cell.',
  },
  {
    registry: '@felipemenezes098/card-05',
    name: 'Stat Card (guide dashboard)',
    section: 'data-display',
    primary: false,
    status: 'implemented',
    implementation: 'StatCard (guide dashboard)',
    note: 'Response rate, sessions and reward balance on the guide’s own dashboard, reusing the Phase 0 stat card rather than a second one.',
  },
  {
    registry: '@ddoemonn/task-steps',
    name: 'Task Steps (guide verification)',
    section: 'forms',
    primary: false,
    status: 'implemented',
    implementation: 'TaskSteps (guide verification pipeline)',
    note: 'identity → current-student evidence → institution confirmation → active, with the error state carrying a suspension. Same component as the institution pipeline, which is the point: one verification vocabulary across the platform.',
  },
  {
    registry: '@shadcnspace/progress-02',
    name: 'Onboarding Stepper Progress',
    section: 'forms',
    primary: false,
    status: 'implemented',
    implementation: 'Progress',
    note: 'Step counter and percentage bar built on the Progress primitive.',
  },
  {
    registry: '@sean0205/stepper',
    name: 'Stepper',
    section: 'forms',
    primary: false,
    status: 'implemented',
    implementation: 'TaskSteps',
    note: 'Vertical title + description variant is what TaskSteps renders.',
  },
  {
    registry: '@ddoemonn/task-steps',
    name: 'Task Steps',
    section: 'forms',
    primary: true,
    status: 'implemented',
    implementation: 'TaskSteps',
    note: 'Primary status timeline. State colours rebound to --mx-success / --mx-action / --mx-ink-500 / --mx-danger; the error state is what makes a failed submission legible.',
  },

  // §2.4 Files
  {
    registry: '@elements-/uploadthing-dropzone',
    name: 'UploadThing Dropzone',
    section: 'files',
    primary: true,
    status: 'implemented',
    implementation: 'Dropzone',
    note: 'Primary document uploader. Kept backend-agnostic so it sits on the platform signed-URL flow — documents never pass through a third-party upload service.',
  },
  {
    registry: '@ephraimduncan/file-upload-01',
    name: 'File Upload with Preview',
    section: 'files',
    primary: false,
    status: 'implemented',
    implementation: 'Dropzone (file rows)',
    note: 'Per-file progress rows folded into Dropzone.',
  },
  {
    registry: '@joyco/file-dropzone',
    name: 'File Dropzone',
    section: 'files',
    primary: false,
    status: 'implemented',
    implementation: 'Dropzone (validation)',
    note: 'Type and size validation with an explicit rejection message.',
  },

  // §2.5 Messaging — Phase 3 surface
  {
    registry: '@rayimanoj8/chat-template',
    name: 'Chat template',
    section: 'messaging',
    primary: true,
    status: 'implemented',
    implementation: 'ChatLayout',
    note: 'The two-pane layout — conversation list plus thread. Rebuilt on the tokens with one addition the vendor has no equivalent for: the safety banner is rendered by the layout, so no surface that shows a thread can omit it.',
  },
  {
    registry: '@serafimcloud/agent-chat',
    name: 'Agent Chat',
    section: 'messaging',
    primary: false,
    status: 'implemented',
    implementation: 'MessageComposer + RiskInterstitial',
    note: 'Composer and attachment chip lifted into the shell above. Its per-message error state is the right shape for the risk interstitial and carries a different meaning: the message is not broken, it is suspect, and it stays readable.',
  },
  {
    registry: '@preetsuthar17/messaging-conversation',
    name: 'Messaging Conversation',
    section: 'messaging',
    primary: false,
    status: 'deferred',
    implementation: null,
    note: 'Named as the lightweight read-only alternative for the Q&A view. Deferred: the public Q&A is a searchable accordion of moderated answers, not a transcript, so SearchableAccordion carries it and a second message list would be a second thing to keep accessible.',
  },
  {
    registry: '@cnippet-dev/v-skeleton-9',
    name: 'Chat Thread Skeleton',
    section: 'messaging',
    primary: false,
    status: 'implemented',
    implementation: 'Skeleton (thread loading)',
    note: 'Avatar and bubble shimmer built from the Skeleton primitive, whose animation is already gated on prefers-reduced-motion, rather than a second animated dependency.',
  },

  // §2.6 Scheduling — Phase 3 surface
  {
    registry: '@shadcnspace/calendar-03',
    name: 'Appointment Picker Calendar',
    section: 'scheduling',
    primary: true,
    status: 'implemented',
    implementation: 'SlotPicker',
    note: 'Day tabs plus a scrollable slot list. Times render in the reader’s own zone with the zone named on screen, because a student in Lagos booking a guide in Manchester is the normal case here.',
  },
  {
    registry: '@cnippet-dev/v-calendar-8',
    name: 'Appointment Booking Calendar',
    section: 'scheduling',
    primary: false,
    status: 'implemented',
    implementation: 'SlotPicker (unavailable states)',
    note: 'Its greying of past and fully-booked days is the substantive half: it makes the no-overbooking rule visible instead of an error the student discovers after clicking. Every blocked slot is rendered, disabled, with the reason beside it.',
  },
  {
    registry: '@originui/calendar',
    name: 'Calendar [React Day Picker]',
    section: 'scheduling',
    primary: false,
    status: 'deferred',
    implementation: null,
    note: 'Base primitive for deadline, intake and availability pickers. Still deferred: the guide’s availability editor uses native datetime inputs, which are keyboard- and screen-reader-correct on every platform without a dependency. Worth revisiting if a repeating-availability editor lands.',
  },

  // §2.7 Public / marketing
  {
    registry: '@uniquesonu/hero-section-enterprise-ready-landing-page-hero-with-dual-ctas',
    name: 'HeroSection (dual CTAs)',
    section: 'public',
    primary: true,
    status: 'implemented',
    implementation: 'HeroSection',
    note: 'Institution page hero. Framer Motion entrance gated on prefers-reduced-motion (issue #3 re-theming note).',
  },
  {
    registry: '@meschacirung/hero-section-6',
    name: 'Hero Section 6',
    section: 'public',
    primary: false,
    status: 'deferred',
    implementation: null,
    note: 'Alternative editorial hero. One hero is enough until marketing needs a second.',
  },
  {
    registry: '@ruixen.ui/search-with-category',
    name: 'Search With Category',
    section: 'public',
    primary: false,
    status: 'implemented',
    implementation: 'SearchEntry (apps/web)',
    note: 'Category-scoped landing search — destination, subject, level — feeding the Phase 2 catalogue query.',
  },
  {
    registry: '@cnippet-dev/v-accordion-11',
    name: 'Searchable FAQ Accordion',
    section: 'public',
    primary: true,
    status: 'implemented',
    implementation: 'SearchableAccordion',
    note: 'Live keyword filter. Used for the programme requirement list in Phase 1 and the public guide Q&A in Phase 3.',
  },

  // Phase 2 (#4) archetypes.
  {
    registry: '@ruixen.ui/flexi-filter-table',
    name: 'Flexi Filter Table (rail)',
    section: 'forms',
    primary: false,
    status: 'implemented',
    implementation: 'FilterRail (apps/web) + Checkbox/RangeField',
    note: 'The configurable facet set — country, level, subject, intake, tuition, duration, language — as a persistent rail, with Sheet carrying it on mobile.',
  },
  // Phase 3 (#5) archetypes.
  {
    registry: '@ruixen.ui/flexi-filter-table',
    name: 'Flexi Filter Table (guide directory)',
    section: 'messaging',
    primary: false,
    status: 'implemented',
    implementation: 'GuideCard + directory facets (apps/web)',
    note: 'Named for the guide directory facets — university, campus, programme, language, topic, home country. Rebuilt as cards rather than rows: a person is not a table row, and the verification badge and match reason do not fit in a cell.',
  },
  {
    registry: '@felipemenezes098/card-05',
    name: 'Stat Card (guide dashboard)',
    section: 'data-display',
    primary: false,
    status: 'implemented',
    implementation: 'StatCard (guide dashboard)',
    note: 'Response rate, sessions and reward balance on the guide’s own dashboard, reusing the Phase 0 stat card rather than a second one.',
  },
  {
    registry: '@ddoemonn/task-steps',
    name: 'Task Steps (guide verification)',
    section: 'forms',
    primary: false,
    status: 'implemented',
    implementation: 'TaskSteps (guide verification pipeline)',
    note: 'identity → current-student evidence → institution confirmation → active, with the error state carrying a suspension. Same component as the institution pipeline, which is the point: one verification vocabulary across the platform.',
  },
  {
    registry: '@shadcnspace/progress-02',
    name: 'Onboarding Stepper Progress',
    section: 'forms',
    primary: false,
    status: 'implemented',
    implementation: 'CompletenessMeter',
    note: 'Step counter plus bar. Rebound to a section count rather than a bare percentage, so it cannot read as an admission likelihood.',
  },
  {
    registry: '@ephraimduncan/file-upload-01',
    name: 'File Upload with Preview (scan state)',
    section: 'files',
    primary: false,
    status: 'implemented',
    implementation: 'ScanStatePill',
    note: 'The vendor block ships success and error only; a quarantined file needs a permanently blocked state, which is added here.',
  },
]);

export function blocksByStatus(status: BlockStatus): readonly BlockEntry[] {
  return BLOCK_REGISTRY.filter((entry) => entry.status === status);
}

/**
 * Sections whose surfaces do not exist until a later phase.
 *
 * Empty as of Phase 3: `messaging` and `scheduling` were the last two, and both
 * now have surfaces to theme against. The list stays because the next phase that
 * names blocks before building them will need it — and because an empty list is
 * the strongest possible version of the assertion below.
 */
export const LATER_PHASE_SECTIONS: readonly string[] = Object.freeze([]);

/** Every in-scope primary pick must be implemented — asserted by the package tests. */
export function unimplementedPrimaryBlocks(): readonly BlockEntry[] {
  return BLOCK_REGISTRY.filter(
    (entry) =>
      entry.primary &&
      entry.status !== 'implemented' &&
      !LATER_PHASE_SECTIONS.includes(entry.section),
  );
}
