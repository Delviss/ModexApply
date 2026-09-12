import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { GuidesModule } from '../guides/guides.module.js';
import { ApplicationsModule } from '../applications/applications.module.js';
import { ConnectorsModule } from '../connectors/connectors.module.js';
import { OffersModule } from '../offers/offers.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { WorkersService } from './workers.service.js';

@Module({
  imports: [
    SearchModule,
    DocumentsModule,
    GuidesModule,
    ApplicationsModule,
    ConnectorsModule,
    OffersModule,
    AdminModule,
  ],
  providers: [WorkersService],
  exports: [WorkersService],
})
export class WorkersModule {}
