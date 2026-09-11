import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { StorageService } from '../storage/storage.service.js';
import { FeatureFlagService } from '../config/feature-flags.js';
import { loadEnv } from '../config/env.js';
import {
  CONNECTOR_ADAPTERS,
  EnvSecretResolver,
  SECRET_RESOLVER,
  type ConnectorPort,
  type SecretResolver,
} from './connector.port.js';
import { ConnectorRegistry } from './connector.registry.js';
import { HttpApiConnector } from './adapters/http-api.connector.js';
import { HandoffConnector } from './adapters/handoff.connector.js';
import { FileExchangeConnector } from './adapters/file-exchange.connector.js';
import { OperatorAssistedConnector } from './adapters/operator-assisted.connector.js';

/**
 * The adapters and the registry, with no dependency on the applications module.
 *
 * Split from `ConnectorsModule` for a boring reason that would otherwise bite:
 * submission needs the registry, and the inbound status pipeline needs the
 * application state machine. Wiring both into one module makes a cycle, and a
 * `forwardRef` would hide a dependency that does not actually exist. Adapters
 * genuinely depend on nothing in the application layer, so they get their own
 * module and the cycle never forms.
 */
@Module({
  imports: [StorageModule],
  providers: [
    { provide: SECRET_RESOLVER, useFactory: (): SecretResolver => new EnvSecretResolver() },
    {
      provide: FeatureFlagService,
      useFactory: () => new FeatureFlagService(loadEnv().FEATURE_FLAGS),
    },
    {
      provide: CONNECTOR_ADAPTERS,
      inject: [SECRET_RESOLVER, StorageService],
      useFactory: (secrets: SecretResolver, storage: StorageService): ConnectorPort[] => [
        new HttpApiConnector(secrets),
        new HandoffConnector('portal_handoff', secrets),
        new HandoffConnector('deep_link', secrets),
        new FileExchangeConnector(storage),
        new OperatorAssistedConnector(),
      ],
    },
    ConnectorRegistry,
  ],
  exports: [ConnectorRegistry, CONNECTOR_ADAPTERS, SECRET_RESOLVER],
})
export class ConnectorCoreModule {}
