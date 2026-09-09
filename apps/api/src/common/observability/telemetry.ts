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
};
