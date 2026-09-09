import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../auth/decorators/access.decorators.js';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: is the process up. Never touches a dependency. */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: can this instance actually serve traffic. A failing dependency
   * takes the instance out of rotation rather than serving errors from it.
   */
  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok' };
    } catch {
      return { status: 'degraded', database: 'unavailable' };
    }
  }
}
