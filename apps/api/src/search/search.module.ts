import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';
import { PostgresSearchIndex } from './postgres-search-index.js';
import { IndexerService } from './indexer.service.js';

/**
 * Search, and the indexer that feeds it.
 *
 * `PostgresSearchIndex` is provided directly rather than behind the
 * `SEARCH_INDEX` token today, because there is one adapter. The port exists so
 * that swapping it for OpenSearch is a provider change here and nothing else —
 * `search-index-contract.ts` is the suite the replacement has to pass.
 */
@Module({
  imports: [AuditModule],
  controllers: [SearchController],
  providers: [SearchService, PostgresSearchIndex, IndexerService],
  exports: [IndexerService, SearchService],
})
export class SearchModule {}
