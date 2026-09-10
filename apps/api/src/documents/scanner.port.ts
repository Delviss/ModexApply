/**
 * Malware scanning seam (Phase 2 §2, FR-003).
 *
 * The vendor choice stays out of the call sites, the same way `MetricSink`
 * keeps the telemetry vendor out of them. What does *not* vary by vendor is the
 * state machine: a version is `pending` until a scanner says otherwise, and
 * only `clean` reaches a university connector.
 *
 * The default when nothing is configured is `NoScanner`, which reports
 * `pending` forever. That is deliberately the **fail-closed** answer: an
 * unconfigured deployment cannot send documents, rather than sending unscanned
 * ones. An environment that wants documents to flow has to choose a scanner.
 */
export type ScanVerdict =
  | { state: 'clean'; detail: null }
  | { state: 'quarantined'; detail: string }
  /** The scanner ran and could not decide, or could not be reached. */
  | { state: 'failed'; detail: string }
  /** No scanner is configured. Not an error; just not an answer. */
  | { state: 'pending'; detail: string };

export interface MalwareScanner {
  readonly name: string;
  scan(bytes: Buffer, hint: { key: string; contentType: string | null }): Promise<ScanVerdict>;
}

export const MALWARE_SCANNER = Symbol('MALWARE_SCANNER');

/**
 * The fail-closed default.
 *
 * Returns `pending`, never `clean`. A deployment with no scanner configured
 * therefore holds every document short of the connector boundary instead of
 * quietly waving them through, and the reason is visible to the student rather
 * than silent.
 */
export class NoScanner implements MalwareScanner {
  readonly name = 'none';

  async scan(): Promise<ScanVerdict> {
    return {
      state: 'pending',
      detail:
        'No malware scanner is configured in this environment, so this file has not been checked and cannot be used in an application.',
    };
  }
}
