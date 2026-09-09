export * from './tokens/index.js';
export * from './registry.js';

export { cn } from './lib/cn.js';
export { usePrefersReducedMotion } from './lib/motion.js';
export { formatDate, formatRelative } from './lib/format.js';

// Primitives
export * from './primitives/icons.js';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './primitives/button.js';
export { Badge, type BadgeProps, type BadgeTone } from './primitives/badge.js';
export { Card, CardHeader, type CardProps } from './primitives/card.js';
export { Field, Input, Select, Textarea, type FieldProps } from './primitives/field.js';
export { Alert, type AlertProps, type AlertTone } from './primitives/alert.js';
export { Progress, Skeleton, type ProgressProps } from './primitives/feedback.js';

// Blocks — 21st.dev archetypes, re-themed. See registry.ts for provenance.
export { AppShell, type AppShellProps, type NavGroup, type NavItem } from './blocks/app-shell.js';
export { CommandPalette, type CommandPaletteProps, type PaletteAction } from './blocks/command-palette.js';
export { DataTable, type BulkAction, type Column, type DataTableProps } from './blocks/data-table.js';
export { Pagination, type PaginationProps } from './blocks/pagination.js';
export { EmptyState, type EmptyStateProps } from './blocks/empty-state.js';
export { StatCard, type StatCardProps } from './blocks/stat-card.js';
export {
  ComparisonTable,
  type CompareColumn,
  type CompareGroup,
  type CompareRow,
  type ComparisonTableProps,
} from './blocks/comparison-table.js';
export { WizardSteps, type WizardStep, type WizardStepsProps } from './blocks/wizard-steps.js';
export { TaskSteps, type TaskStep, type TaskStepsProps } from './blocks/task-steps.js';
export { Dropzone, type DropzoneProps, type UploadedFile } from './blocks/dropzone.js';
export {
  SearchableAccordion,
  type AccordionItem,
  type SearchableAccordionProps,
} from './blocks/searchable-accordion.js';
export { HeroSection, type HeroAction, type HeroSectionProps } from './blocks/hero-section.js';

// Signature components — Modex-specific, built rather than sourced (§2.9).
export {
  VerificationBadge,
  unverifiedClaim,
  type VerificationBadgeProps,
} from './signature/verification-badge.js';
export { ProvenanceStamp, type ProvenanceStampProps } from './signature/provenance-stamp.js';
export {
  EligibilityExplanation,
  type EligibilityExplanationProps,
} from './signature/eligibility-explanation.js';
export {
  DisclosureNotice,
  type DisclosureKind,
  type DisclosureNoticeProps,
} from './signature/disclosure-notice.js';
