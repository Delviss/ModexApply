import { structuredLog } from './logger.js';

/**
 * Golden signals per service: request rate, latency, error rate, saturation
 * (Phase 0 §3.6).
 *
 * The collector is a seam rather than a hard dependency on an OpenTelemetry SDK
 * build: `setMetricSink` is what the real exporter registers at boot, and
 * everything in the application records through this interface. That keeps the
 * vendor choice (issue #1 §7, open decision 6 — cloud region and providers) out
 * of the call sites.
 */
export interface MetricSink {
  counter(name: string, value: number, attributes: Record<string, string | number>): void;
  histogram(name: string, value: number, attributes: Record<string, string | number>): void;
  gauge(name: string, value: number, attributes: Record<string, string | number>): void;
}

const noopSink: MetricSink = {
  counter: () => undefined,
  histogram: () => undefined,
  gauge: () => undefined,
};

let sink: MetricSink = noopSink;

export function setMetricSink(next: MetricSink): void {
  sink = next;
}

export const metrics = {
  requestStarted(route: string, method: string): void {
    sink.counter('http.server.requests', 1, { route, method });
  },
  requestFinished(route: string, method: string, status: number, durationMs: number): void {
    sink.counter('http.server.responses', 1, { route, method, status });
    sink.histogram('http.server.duration', durationMs, { route, method, status });
    if (status >= 500) sink.counter('http.server.errors', 1, { route, method, status });
  },
  queueDepth(queue: string, depth: number): void {
    sink.gauge('queue.depth', depth, { queue });
  },
  jobFinished(queue: string, outcome: 'succeeded' | 'failed', durationMs: number): void {
    sink.counter('queue.jobs', 1, { queue, outcome });
    sink.histogram('queue.duration', durationMs, { queue, outcome });
  },
  catalogueRecordsMarkedStale(institutionId: string, count: number): void {
    sink.counter('catalogue.records.stale', count, { institutionId });
    if (count > 0) {
      structuredLog('warn', 'Catalogue records marked stale', { institutionId, count });
    }
  },
  connectorCall(connector: string, outcome: 'accepted' | 'rejected' | 'error', durationMs: number): void {
    sink.counter('connector.calls', 1, { connector, outcome });
    sink.histogram('connector.duration', durationMs, { connector, outcome });
  },

  // -------------------------------------------------------------------------
  // Phase 7 (#9). The signals the alerts in `infra/observability/alerts.yaml`
  // are defined over. Each one exists because there is an alert that needs it;
  // a metric nobody alerts on and nobody charts is a metric that rots.
  // -------------------------------------------------------------------------

  /** Submission failures are the alert TRD §22 names first, and for good reason. */
  submissionOutcome(connector: string, outcome: 'submitted' | 'pending' | 'failed'): void {
    sink.counter('application.submissions', 1, { connector, outcome });
  },

  /** A scan that could not decide is a document stuck out of every application. */
  documentScan(outcome: 'clean' | 'quarantined' | 'failed'): void {
    sink.counter('document.scans', 1, { outcome });
  },

  /** Moderation queue depth: how many people are waiting on a human. */
  moderationQueueDepth(queue: 'trust_cases' | 'guide_verification' | 'offer_review', depth: number): void {
    sink.gauge('moderation.queue.depth', depth, { queue });
  },

  /** Report volume, so an abnormal spike is visible as one (TRD §22). */
  trustReportOpened(type: string, severity: string): void {
    sink.counter('trust.reports', 1, { type, severity });
  },

  /**
   * Authentication anomalies: failed sign-ins, failed second factors, refused
   * step-ups, refresh-token reuse. One counter with a `kind` rather than four,
   * because the alert is on the *shape* of the traffic, not on any one of them.
   */
  authAnomaly(kind: 'login_failed' | 'mfa_failed' | 'step_up_failed' | 'token_reuse'): void {
    sink.counter('auth.anomalies', 1, { kind });
  },

  /** A request refused by a budget. A sustained rise is either an attack or a limit set too low. */
  rateLimited(name: string): void {
    sink.counter('ratelimit.refusals', 1, { limit: name });
  },

  /** Seconds between a catalogue write and the search index reflecting it. */
  searchIndexLag(seconds: number): void {
    sink.histogram('search.index.lag', seconds, {});
  },
};
