import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../auth/decorators/access.decorators.js';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: is the process up. Never touches a dependency. */
  @Public()
  @Get('live')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: can this instance actually serve traffic.
   *
   * A failing dependency must produce a **non-2xx**. Returning 200 with a
   * `degraded` body reads fine to a human and is invisible to a load balancer,
   * which keeps routing to an instance that cannot answer a single query — the
   * exact outcome readiness exists to prevent.
   */
  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      // The error itself is deliberately not echoed: a readiness endpoint is
      // unauthenticated, and a connection string in the body would be a gift.
      throw new ServiceUnavailableException({
        status: 'degraded',
        database: 'unavailable',
      });
    }
    return { status: 'ok', database: 'ok' };
  }
}
