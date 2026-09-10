import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { WorkersService } from './workers.service.js';

@Module({
  imports: [SearchModule, DocumentsModule],
  providers: [WorkersService],
  exports: [WorkersService],
})
export class WorkersModule {}
