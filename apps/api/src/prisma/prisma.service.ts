import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/index.js';

/**
 * Prisma client lifecycle.
 *
 * Note what is *not* here: no `auditEvent.update` or `auditEvent.delete` helper.
 * The append-only guarantee is enforced by the database (revoked grants plus a
 * trigger, in the `audit_append_only` migration), because an application-level
 * convention is one careless service away from being untrue.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
