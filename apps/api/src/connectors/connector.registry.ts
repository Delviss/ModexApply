import { Inject, Injectable } from '@nestjs/common';
import type { ConnectorType } from '@modex/contracts';
import { FeatureFlagService, type FeatureFlag } from '../config/feature-flags.js';
import { AppError } from '../common/errors/app-error.js';
import { CONNECTOR_ADAPTERS, type ConnectorPort } from './connector.port.js';

/**
 * Picks the adapter for a connector type, and refuses when the partner's flag
 * is off.
 *
 * "Every connector ships behind a feature flag and is rolled out per partner"
 * is enforced here rather than at each call site, and the subject of the flag
 * check is the *institution*: `connector.direct_application@25` puts a stable
 * quarter of partners on the new route, and a given university does not flap
 * between requests.
 *
 * Note what this class does not do: it has no knowledge of any specific
 * university. A partner is a `ConnectorConfig` row; if this file ever needs to
 * know a university's name, the adapter boundary has failed.
 */
@Injectable()
export class ConnectorRegistry {
  private readonly adapters: Map<ConnectorType, ConnectorPort>;

  constructor(
    @Inject(CONNECTOR_ADAPTERS) adapters: readonly ConnectorPort[],
    private readonly flags: FeatureFlagService,
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.type, adapter]));
  }

  adapterFor(type: ConnectorType): ConnectorPort {
    const adapter = this.adapters.get(type);
    if (adapter === undefined) {
      throw new AppError(
        'dependency_unavailable',
        'This university is not reachable from this deployment.',
        { details: { connectorType: type } },
      );
    }
    return adapter;
  }

  /**
   * Whether a configured connector may actually be used right now.
   *
   * Two independent switches, because they fail for different reasons and
   * should be distinguishable in an incident: `enabled` is the partner's own
   * state (contract signed, endpoint live), and the flag is ours (rollout).
   */
  isAvailable(config: {
    enabled: boolean;
    featureFlag: string;
    institutionId: string;
  }): { available: boolean; reason: string | null } {
    if (!config.enabled) {
      return { available: false, reason: 'This university is not yet accepting applications through Modex Apply.' };
    }
    if (!this.flags.isEnabled(config.featureFlag as FeatureFlag, config.institutionId)) {
      return {
        available: false,
        reason: 'Direct submission to this university is not switched on yet. We will tell you when it is.',
      };
    }
    return { available: true, reason: null };
  }
}
