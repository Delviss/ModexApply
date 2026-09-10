import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { PostgresSearchIndex } from '../src/search/postgres-search-index.js';
import { IndexerService } from '../src/search/indexer.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * Rebuilds the search index from the catalogue.
 *
 * Needed after a seed, and useful whenever the index and the catalogue have
 * drifted — which they should not, since every mutation enqueues a reindex, but
 * "should not" is not a reason to have no way to repair it.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const indexer = new IndexerService(
      prisma as unknown as PrismaService,
      new PostgresSearchIndex(prisma as unknown as PrismaService),
    );
    const count = await indexer.reindexAll();
    console.warn(`Reindexed ${count} programme(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
