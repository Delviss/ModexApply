import type { ReactNode } from 'react';
import {
  GUIDE_TOPIC_LABELS,
  type PublicGuideProfile,
} from '@modex/contracts';
import { Card } from '../primitives/card.js';
import { Badge } from '../primitives/badge.js';
import { GlobeIcon, ClockIcon } from '../primitives/icons.js';
import { VerificationBadge } from '../signature/verification-badge.js';
import { cn } from '../lib/cn.js';

/**
 * Guide directory card — the archetype from `@ruixen.ui/flexi-filter-table`'s
 * result row, rebuilt as a card because a person is not a table row.
 *
 * Three things the vendor blocks do not ship, and which this phase cannot do
 * without:
 *
 *  1. **`<VerificationBadge>` is composed in**, taking a claim rather than a
 *     boolean, so a guide whose evidence lapsed between the query and the render
 *     cannot show a verified badge.
 *  2. **The avatar ring is `--mx-brand-100` only when verified.** It is
 *     decoration on top of the badge, never instead of it — the state is in the
 *     text either way.
 *  3. **The match reason is printed.** The student sees why this guide is here,
 *     in the same words the ranking used.
 */
export interface GuideCardProps {
  guide: PublicGuideProfile;
  matchReason?: string;
  /** "Message", "Book a session" — the card's own action. */
  action?: ReactNode;
  now?: Date;
  className?: string;
}

export function GuideCard({ guide, matchReason, action, now, className }: GuideCardProps) {
  const initials = guide.displayName
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <Card className={cn('mx-guide-card', className)} padding="md">
      <div className="mx-guide-card__head">
        <span
          className="mx-guide-card__avatar"
          data-verified={guide.state === 'active'}
          aria-hidden="true"
        >
          {initials}
        </span>
        <div className="mx-guide-card__identity">
          <h3 className="mx-guide-card__name">{guide.displayName}</h3>
          <p className="mx-guide-card__meta">
            {[guide.programName, guide.campusName, guide.institutionName]
              .filter((part) => part !== null && part !== undefined)
              .join(' · ')}
          </p>
        </div>
        {/*
          Online is a five-minute window, not a last-seen timestamp: "active 3
          minutes ago" tells a stranger more about somebody's routine than they
          agreed to share.
        */}
        {guide.online ? (
          <span className="mx-guide-card__online">
            <span className="mx-guide-card__dot" aria-hidden="true" />
            Online now
          </span>
        ) : null}
      </div>

      <div className="mx-guide-card__badges">
        <VerificationBadge
          claim={{
            objectType: 'guide',
            objectId: guide.id,
            state: guide.state === 'active' ? 'verified' : 'unverified',
            verifierName: 'Modex Trust',
            verifierType: 'trust_agent',
            verifiedAt: guide.verifiedAt,
            expiresAt: guide.expiresAt,
            evidenceSummary:
              'Current-student evidence checked and rechecked every six months. Evidence itself is never published.',
          }}
          now={now}
        />
        {/*
          Only where the university granted the staff role in its partnership
          scope. Absent this, a guide is a current student and is never
          presented as anything else.
        */}
        {guide.universityEndorsed ? <Badge tone="info">Recognised by the university</Badge> : null}
      </div>

      {matchReason === undefined ? null : (
        <p className="mx-guide-card__reason">
          <span className="mx-guide-card__reason-label">Why you are seeing this guide: </span>
          {matchReason}
        </p>
      )}

      <dl className="mx-guide-card__facts">
        {guide.languages.length > 0 ? (
          <div>
            <dt>
              <GlobeIcon size={14} /> Speaks
            </dt>
            <dd>{guide.languages.join(', ')}</dd>
          </div>
        ) : null}
        {guide.responseTimeHours === null ? null : (
          <div>
            <dt>
              <ClockIcon size={14} /> Usually replies in
            </dt>
            <dd>
              {guide.responseTimeHours < 1
                ? 'under an hour'
                : `about ${Math.round(guide.responseTimeHours)} hours`}
            </dd>
          </div>
        )}
      </dl>

      {guide.topics.length > 0 ? (
        <ul className="mx-guide-card__topics">
          {guide.topics.map((topic) => (
            <li key={topic}>
              <Badge tone="neutral">{GUIDE_TOPIC_LABELS[topic]}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {action === undefined ? null : <div className="mx-guide-card__action">{action}</div>}
    </Card>
  );
}
