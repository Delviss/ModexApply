import {
  OFFER_BASE_LABELS,
  OFFER_DURATION_LABELS,
  formatMoney,
  type PriceBreakdown as Breakdown,
} from '@modex/contracts';
import { Alert } from '../primitives/alert.js';
import { InfoIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * `<PriceBreakdown>` — tuition → applicable offers → net price (Phase 5 §3).
 *
 * **This is where Red Velvet is most dangerous.** A discount UI wants to look
 * like a sale, and this one must not: no countdown urgency, no strikethrough-
 * and-shout, no "limited time!". The net price is presented as a calm, sourced
 * calculation that a student could check line by line with the university.
 *
 * The colour rule is specific and it is the one thing not to get creative with:
 * the **net price is `--mx-ink-900`** at the largest size, the original sits
 * above it in `--mx-ink-600`, struck through, at body size, and the **saving is
 * `--mx-success`, never brand red**. Red is for actions; green is for money
 * saved. And the saving is never communicated by colour alone — every saving
 * line is labelled "saving" in text and carries a minus sign.
 *
 * Every line names the offer version and source that produced it, because "a
 * displayed net price is reproducible" is an acceptance criterion, not a nice
 * property.
 */

export interface PriceBreakdownProps {
  breakdown: Breakdown;
  locale?: string;
  /** Rendered under the net price — the apply button, usually. */
  children?: React.ReactNode;
  className?: string;
}

export function PriceBreakdown({
  breakdown,
  locale = 'en-GB',
  children,
  className,
}: PriceBreakdownProps) {
  const savings = breakdown.lines.filter((line) => line.kind === 'saving');
  const costs = breakdown.lines.filter((line) => line.kind === 'cost');
  const hasSaving = breakdown.totalSaving.amountMinor > 0;

  return (
    <div className={cn('mx-price', className)}>
      <table className="mx-price__table">
        <caption className="mx-visually-hidden">
          How this price is calculated: the university&rsquo;s published costs, then each offer you
          qualify for, then what you would pay.
        </caption>
        <tbody>
          {costs.map((line) => (
            <tr key={`cost-${line.base}`} className="mx-price__row" data-kind="cost">
              <th scope="row" className="mx-price__label">
                {line.label}
              </th>
              <td className="mx-price__amount">{formatMoney(line.amount, locale)}</td>
            </tr>
          ))}

          {savings.map((line) => (
            <tr key={`saving-${line.offerKey}`} className="mx-price__row" data-kind="saving">
              <th scope="row" className="mx-price__label">
                {line.label}
                <span className="mx-price__meta">
                  {OFFER_BASE_LABELS[line.base]}
                  {line.duration === null ? '' : ` · ${OFFER_DURATION_LABELS[line.duration]}`}
                  {line.offerVersion === null ? '' : ` · version ${line.offerVersion}`}
                  {line.sourceRef === null ? null : (
                    <>
                      {' · '}
                      <a href={line.sourceRef} rel="nofollow noopener">
                        source
                      </a>
                    </>
                  )}
                </span>
              </th>
              <td className="mx-price__amount" data-kind="saving">
                {/* Never colour alone: the minus sign and the word are in the text. */}
                <span aria-hidden="true">&minus;{formatMoney(line.amount, locale)}</span>
                <span className="mx-visually-hidden">
                  saving of {formatMoney(line.amount, locale)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mx-price__net">
        {hasSaving ? (
          <p className="mx-price__was">
            <span className="mx-visually-hidden">Without offers: </span>
            <s>{formatMoney(breakdown.grossTotal, locale)}</s>
          </p>
        ) : null}

        <p className="mx-price__value">{formatMoney(breakdown.netPrice, locale)}</p>
        <p className="mx-price__caption">
          {hasSaving ? (
            <>
              You save <strong className="mx-price__saving">{formatMoney(breakdown.totalSaving, locale)}</strong>{' '}
              on the first year, from {savings.length} verified offer{savings.length === 1 ? '' : 's'}.
            </>
          ) : (
            <>
              First-year cost as published by the university. No offer you currently qualify for
              reduces it.
            </>
          )}
        </p>
      </div>

      {breakdown.suppressed.length > 0 ? (
        <div className="mx-price__note">
          <h4 className="mx-price__note-title">
            <InfoIcon size={14} /> Offers that could not be combined
          </h4>
          <ul className="mx-price__list">
            {breakdown.suppressed.map((offer) => (
              <li key={offer.offerKey}>
                <strong>{offer.name}</strong> — {offer.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {breakdown.unpriceable.length > 0 ? (
        <Alert tone="warning" title="One offer could not be priced against this fee">
          <ul className="mx-price__list">
            {breakdown.unpriceable.map((offer) => (
              <li key={offer.offerKey}>
                <strong>{offer.name}</strong> — {offer.reason}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <p className="mx-price__stamp">
        Calculated {new Date(breakdown.computedAt).toISOString().slice(0, 10)} from the
        university&rsquo;s published fees and the offer versions listed above. Modex adds nothing to
        this price.
      </p>

      {children}
    </div>
  );
}
