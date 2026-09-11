'use client';

import { useState } from 'react';
import { formatDate } from '../lib/format.js';
import { Button } from '../primitives/button.js';
import { Badge } from '../primitives/badge.js';
import { CheckIcon, CopyIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * `<ReceiptCard>` — the evidence a student keeps.
 *
 * The reference and the timestamp are the things a student will be asked for by
 * the university months later, so they are the two largest pieces of text on
 * the card and the reference is one click from the clipboard.
 *
 * `payloadHash` and `verified` are shown deliberately, even though most people
 * will never check them. The product's claim is a reproducible, auditable
 * record of exactly what was sent; a claim nobody can inspect is a claim the
 * user has to take on trust, which is the thing Modex exists to stop asking
 * for.
 */
export interface ReceiptCardProps {
  institutionName: string;
  externalRef: string | null;
  confirmedAt: string | Date | null;
  submissionNo: number;
  payloadHash: string | null;
  /** Whether the stored hash still describes the stored payload. */
  verified: boolean | null;
  documentCount: number;
  /** Link to the downloadable submission summary, when one can be built. */
  summaryHref?: string;
  className?: string;
}

export function ReceiptCard({
  institutionName,
  externalRef,
  confirmedAt,
  submissionNo,
  payloadHash,
  verified,
  documentCount,
  summaryHref,
  className,
}: ReceiptCardProps) {
  const [copied, setCopied] = useState(false);

  const copyReference = async () => {
    if (externalRef === null) return;
    try {
      await navigator.clipboard.writeText(externalRef);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused, and a failed copy must not look like a
      // successful one. The reference stays selectable either way.
      setCopied(false);
    }
  };

  return (
    <article className={cn('mx-receipt', className)}>
      <header className="mx-receipt__header">
        <h3 className="mx-receipt__title">Submission {submissionNo}</h3>
        {verified === null ? null : (
          <Badge tone={verified ? 'success' : 'danger'} icon={<CheckIcon size={12} />}>
            {verified ? 'Record verified' : 'Record does not verify'}
          </Badge>
        )}
      </header>

      <dl className="mx-receipt__grid">
        <div>
          <dt>{institutionName}&rsquo;s reference</dt>
          <dd className="mx-receipt__ref">
            {externalRef ?? <span className="mx-receipt__pending">Not issued yet</span>}
            {externalRef === null ? null : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copyReference()}
                aria-label={`Copy ${institutionName}'s reference`}
              >
                <CopyIcon size={14} />
                {copied ? 'Copied' : 'Copy'}
              </Button>
            )}
          </dd>
        </div>
        <div>
          <dt>Confirmed</dt>
          <dd>{confirmedAt === null ? 'Not yet confirmed' : formatDate(confirmedAt)}</dd>
        </div>
        <div>
          <dt>Documents sent</dt>
          <dd>{documentCount}</dd>
        </div>
        <div>
          <dt>Record fingerprint</dt>
          {/* Truncated for the eye; the full value is in the summary download. */}
          <dd className="mx-receipt__hash">{payloadHash?.slice(0, 16) ?? '—'}</dd>
        </div>
      </dl>

      {summaryHref === undefined ? null : (
        <a className="mx-receipt__download" href={summaryHref}>
          Download the submission summary
        </a>
      )}
    </article>
  );
}
