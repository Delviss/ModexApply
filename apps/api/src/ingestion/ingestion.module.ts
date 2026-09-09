import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller.js';
import { IngestionService } from './ingestion.service.js';
import { FreshnessService } from './freshness.service.js';

@Module({
  controllers: [IngestionController],
  providers: [IngestionService, FreshnessService],
  exports: [IngestionService, FreshnessService],
})
export class IngestionModule {}
