import type { ConnectorType, SubmissionOutcome } from '@modex/contracts';
import type { ConnectorPort, ConnectorRequest } from '../connector.port.js';

/**
 * Operator-assisted submission — **the temporary exception**.
 *
 * A named member of Modex staff submits on the student's behalf, by hand, into
 * whatever the university actually accepts. This adapter does not submit
 * anything: it records that an operator has been asked to, and returns
 * `queued`. The application sits in `submitted_pending` until that operator
 * comes back with the university's own reference, which arrives through the
 * same inbound-status path every other connector uses.
 *
 * Three properties are deliberate:
 *
 *  1. **It cannot invent a receipt.** There is no path here that produces
 *     `accepted`, so no amount of operator confidence can move an application
 *     to `submitted` without a reference from the university.
 *  2. **The operator is named in the outcome**, which is what
 *     `<DisclosureNotice>` renders permanently on the application afterwards.
 *  3. **It refuses without an operator.** A submission that reaches this
 *     adapter with no identified human is a bug, and failing loudly is better
 *     than an unattributable action on a student's application.
 */
export class OperatorAssistedConnector implements ConnectorPort {
  readonly type: ConnectorType = 'operator_assisted';

  async submit(request: ConnectorRequest): Promise<SubmissionOutcome> {
    if (request.operator === undefined) {
      return {
        status: 'rejected',
        code: 'operator_required',
        message:
          'An operator-assisted submission needs an identified member of Modex staff. Nothing was sent.',
        fieldErrors: [],
      };
    }

    return {
      status: 'queued',
      batchRef: `operator_${request.operator.userId}_${request.attemptNo}`,
      // A working day. The tracker shows the student who is doing this and by
      // when, rather than an indefinite "in progress".
      expectedBy: new Date(Date.now() + 24 * 3600_000).toISOString(),
    };
  }
}
