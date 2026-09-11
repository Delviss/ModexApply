import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ApplicationsModule } from '../applications/applications.module.js';
import { OffersModule } from '../offers/offers.module.js';
import { ConnectorCoreModule } from './connector-core.module.js';
import { ConnectorsController } from './connectors.controller.js';
import { InboundStatusService } from './inbound-status.service.js';
import { StatusPollService } from './status-poll.service.js';

/** Inbound traffic from universities: signed webhooks and the poll fallback. */
@Module({
  imports: [AuditModule, ConnectorCoreModule, ApplicationsModule, OffersModule],
  controllers: [ConnectorsController],
  providers: [InboundStatusService, StatusPollService],
  exports: [InboundStatusService, StatusPollService],
})
export class ConnectorsModule {}
