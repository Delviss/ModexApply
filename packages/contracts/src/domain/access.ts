import { z } from 'zod';

/**
 * Authorization is RBAC **+** organisation boundary **+** resource permission
 * **+** consent scope (Phase 0 §3.2). All four are checked server-side; a role
 * alone never grants access to a row.
 */
export const ROLES = [
  'student',
  'guide',
  'university_admin',
  'university_staff',
  'trust_agent',
  'ops',
  'finance',
  'superadmin',
] as const;

export type Role = (typeof ROLES)[number];

/** Roles that must clear MFA before any session is issued (Phase 0 §3.2). */
export const MFA_MANDATORY_ROLES: readonly Role[] = Object.freeze([
  'university_admin',
  'university_staff',
  'trust_agent',
  'ops',
  'finance',
  'superadmin',
]);

export function requiresMfa(roles: readonly Role[]): boolean {
  return roles.some((role) => MFA_MANDATORY_ROLES.includes(role));
}

/** Permissions are `<resource>:<action>`; the resource half is the audit object type. */
export const PERMISSIONS = [
  'institution:read',
  'institution:write',
  'institution:verify',
  'partnership:read',
  'partnership:write',
  'partnership:revoke',
  'campus:write',
  'program:read',
  'program:write',
  'program:publish',
  'intake:write',
  'requirement:write',
  'catalogue:import',
  'catalogue:sync',
  'profile:read',
  'profile:write',
  'document:read',
  'document:write',
  'document:delete',
  'guide:read',
  'guide:write',
  'guide:verify',
  'guide:suspend',
  'message:read',
  'message:write',
  'session:book',
  'session:manage',
  'qa:answer',
  'qa:moderate',
  'trust_case:read',
  'trust_case:write',
  'reward:read',
  'reward:approve',
  'application:read',
  'application:write',
  'application:submit',
  'offer:read',
  'offer:write',
  'offer:verify',
  'audit:read',
  'user:impersonate',

  // Phase 6 — the admin consoles (#8). Each of these is an action that exists
  // only inside a console, and each is separated from the permission next to it
  // for a reason: reading a trust case is not reading the evidence behind it,
  // starting a payout is not approving one, and running a connector is not
  // rewriting the notification a student receives when it fails.
  'analytics:read',
  'requirement:review',
  'org_user:manage',
  'evidence:read',
  'sanction:write',
  'connector:read',
  'connector:manage',
  'notification:write',
  'transaction:read',
  'payout:initiate',
  'payout:approve',
  'refund:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The role → permission grant. Note what is *not* here: `university_admin` cannot
 * verify its own institution, and no role outside Trust can. Self-verification is
 * the failure mode this table exists to prevent (Phase 1 §2).
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  student: [
    'institution:read',
    'program:read',
    'profile:read',
    'profile:write',
    'document:read',
    'document:write',
    'document:delete',
    'guide:read',
    'message:read',
    'message:write',
    'session:book',
    'trust_case:write',
    'application:read',
    'application:write',
    // The applicant submits their own application. Phase 0 left this grant with
    // `superadmin` only, which would have made the one route in the product
    // that matters reachable by nobody who needs it.
    'application:submit',
    'offer:read',
  ],
  /**
   * A guide's grant is deliberately small. They read the catalogue, run their
   * own profile and availability, answer questions and message the students who
   * contacted them — and that is all. Nothing here lets a guide see an
   * application, an offer, or another student's profile, because a guide who can
   * see an application is on their way to becoming an agent.
   */
  guide: [
    'institution:read',
    'program:read',
    'guide:read',
    'guide:write',
    'message:read',
    'message:write',
    'session:manage',
    'qa:answer',
    'trust_case:write',
    'reward:read',
  ],
  university_staff: [
    'institution:read',
    'partnership:read',
    'program:read',
    'program:write',
    'intake:write',
    'requirement:write',
    'application:read',
    'offer:read',
    /**
     * Draft an offer, yes. Publish one, no — `offer:verify` is Trust's, and it
     * is the whole reason an unverifiable discount cannot reach a student.
     */
    'offer:write',
    'analytics:read',
    /** Operational review of a machine rule. Not a contract change, not a user change. */
    'requirement:review',
  ],
  university_admin: [
    'institution:read',
    'institution:write',
    'partnership:read',
    'campus:write',
    'program:read',
    'program:write',
    'program:publish',
    'intake:write',
    'requirement:write',
    'catalogue:import',
    'guide:read',
    'application:read',
    'offer:read',
    'offer:write',
    'analytics:read',
    'requirement:review',
    /** The one grant that separates an admin from staff: who else gets an account. */
    'org_user:manage',
  ],
  trust_agent: [
    'institution:read',
    'institution:verify',
    'partnership:read',
    'partnership:write',
    'partnership:revoke',
    'program:read',
    'guide:read',
    'guide:verify',
    'guide:suspend',
    'message:read',
    'qa:moderate',
    'trust_case:read',
    'trust_case:write',
    /**
     * Trust reads every offer, including the drafts a university has not
     * published: verification means looking at the thing before it is visible,
     * not after a student has already priced their year on it.
     */
    'offer:read',
    'offer:verify',
    'audit:read',
    /**
     * Reading the *evidence* is a separate grant from reading the case, and
     * exercising it is itself an audited action (Phase 6 §2). A queue you can
     * triage without opening anybody's passport scan is the normal day.
     */
    'evidence:read',
    'sanction:write',
  ],
  ops: [
    'institution:read',
    'institution:write',
    'partnership:read',
    'partnership:write',
    'campus:write',
    'program:read',
    'program:write',
    'program:publish',
    'intake:write',
    'requirement:write',
    'catalogue:import',
    'catalogue:sync',
    'guide:read',
    'trust_case:read',
    'session:manage',
    'application:read',
    // Operator-assisted submission (Phase 4 §3) — the temporary exception, and
    // the only reason a Modex operator can submit anything. `ApplicationsService`
    // additionally refuses unless the student granted that specific consent, and
    // the application carries a permanent disclosure afterwards.
    'application:submit',
    'offer:read',
    'offer:write',
    'audit:read',
    'analytics:read',
    'connector:read',
    'connector:manage',
    'notification:write',
    /**
     * Impersonation is ops-only, time-boxed, consented and visible to the
     * student. Trust does not hold it: an investigator who can *become* the
     * person they are investigating has contaminated their own evidence.
     */
    'user:impersonate',
  ],
  /**
   * Finance approves and pays rewards. It cannot read a message, cannot see a
   * trust case, and — the point of Phase 3 §5 — has no permission anywhere that
   * would let a payout be conditioned on an application.
   */
  finance: [
    'institution:read',
    'partnership:read',
    'program:read',
    'offer:read',
    'reward:read',
    'reward:approve',
    'audit:read',
    'transaction:read',
    /**
     * Both halves of a payout, deliberately. The rule that stops one person
     * paying themselves is not a missing permission — a finance team of one
     * would then be unable to pay anybody — it is `checkDualApproval`, which
     * compares actor identities server-side.
     */
    'payout:initiate',
    'payout:approve',
    'refund:write',
  ],
  superadmin: PERMISSIONS,
});

export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) granted.add(permission);
  }
  return granted;
}

/**
 * Consent scopes are separate, revocable grants (Phase 0 §3.2). A student
 * consenting to guide contact has not consented to document sharing, and neither
 * implies consent to submit an application to a university.
 */
export const CONSENT_SCOPES = [
  'guide_access',
  'document_share',
  'university_submission',
  'marketing_contact',
  /**
   * Phase 6. Lets a Modex support operator see the account as the student sees
   * it, for a bounded window. Its own scope rather than a flavour of any other:
   * agreeing that a guide may read your profile is not agreeing that a member
   * of staff may sit inside your account, and a support visit nobody agreed to
   * is the thing this scope exists to make impossible.
   */
  'support_access',
] as const;

export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const ConsentGrantSchema = z.object({
  scope: z.enum(CONSENT_SCOPES),
  grantedAt: z.iso.datetime(),
  /** A grant with no expiry is still revocable; `revokedAt` wins over everything. */
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  /** What the consent is scoped to — an institution id, a guide id, a document id. */
  subjectId: z.string().nullable(),
});

export type ConsentGrant = z.infer<typeof ConsentGrantSchema>;

export function isConsentActive(grant: ConsentGrant, now: Date = new Date()): boolean {
  if (grant.revokedAt !== null) return false;
  if (grant.expiresAt !== null && new Date(grant.expiresAt) <= now) return false;
  return new Date(grant.grantedAt) <= now;
}

/** The evaluated authorization context attached to every request. */
export interface AccessContext {
  userId: string;
  /**
   * The session this request arrived on.
   *
   * Carried because step-up elevation is a property of the *session*, not of
   * the user: an operator with two browsers open has stepped up in one of them,
   * and a user-level flag would silently elevate the other.
   */
  sessionId: string;
  /** When this session last cleared a step-up challenge. Null means never. */
  stepUpAt: string | null;
  /**
   * Set when this session is an ops impersonation of the named subject. Null in
   * the ordinary case. Nothing reads it to *grant* anything — it exists so that
   * every audit event written under an impersonation says so.
   */
  impersonatedBy: string | null;
  roles: Role[];
  /** Institution the actor belongs to, if any. Students and ops have none. */
  organisationId: string | null;
  permissions: Set<Permission>;
  mfaSatisfied: boolean;
  consents: ConsentGrant[];
}
