/**
 * The platform's own rules, as used by this build.
 *
 * Nothing here is reimplemented. The anti-scam scanner, the guide matching
 * weights, the eligibility evaluators, the application transition table and the
 * canonical-JSON snapshot function are the same modules the API runs, imported
 * from `packages/contracts` and `apps/api/src/eligibility/rules.ts` and bundled
 * by `apps/site/build.mjs`.
 *
 * That is the whole point of this file existing as a single narrow seam: if
 * somebody loosens the rule that a suspended guide cannot send a message, this
 * site stops enforcing it too, in the same commit, and the change is visible.
 */
export {
  // Phase 3 §4 — anti-scam.
  scanMessage,
  flagSummary,
  actionFor,
  normaliseForScanning,
  highestSeverity,
  exceedsMessageRate,
  GUIDE_MESSAGE_RATE_PER_HOUR,
  // Phase 3 §1–2 — guides.
  canGuideSendMessages,
  isGuideDiscoverable,
  guideBlockReason,
  guideExpiryUrgency,
  guideLifecycleDecision,
  daysUntil,
  GUIDE_TOPIC_LABELS,
  GUIDE_STAGE_LABELS,
  GUIDE_EVIDENCE_LABELS,
  GUIDE_EXPIRY_WARNING_DAYS,
  GUIDE_EXPIRY_URGENT_DAYS,
  matchGuides,
  TRUST_SCORE_TIEBREAK,
  // Phase 2 §4 — eligibility roll-up.
  rollUpVerdict,
  // Phase 4 — applications.
  canonicalJson,
  canTransition,
  humanState,
  isTerminalState,
  submissionDisplayState,
  submissionHeadline,
  SUBMISSION_CONSENTS,
  SUBMISSION_CONSENT_NOTICE_VERSION,
} from '@modex/contracts';

export { evaluateRequirement } from '../../api/src/eligibility/rules.js';

/**
 * A submission reference the way the connector layer produces one, minus the
 * connector: `sha256` over the canonical payload, which is what makes
 * "reproducible from an immutable snapshot" checkable rather than asserted.
 */
export async function checksum(canonical) {
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
