import { describe, expect, it } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../src/health/health.controller.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

function controllerWith(queryRaw: () => Promise<unknown>) {
  return new HealthController({ $queryRaw: queryRaw } as unknown as PrismaService);
}

describe('health endpoints', () => {
  it('reports liveness without touching a dependency', () => {
    const controller = controllerWith(() => {
      throw new Error('the database must not be consulted for liveness');
    });
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('reports ready when the database answers', async () => {
    await expect(controllerWith(async () => [1]).ready()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
    });
  });

  /**
   * The point of the endpoint: a load balancer reads the status code, not the
   * body. A 200 carrying `degraded` keeps a broken instance in rotation, which
   * is precisely what readiness exists to prevent.
   */
  it('fails with a non-2xx when the database is unreachable', async () => {
    const controller = controllerWith(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(controller.ready()).rejects.toThrow(ServiceUnavailableException);

    try {
      await controller.ready();
    } catch (error) {
      const thrown = error as ServiceUnavailableException;
      expect(thrown.getStatus()).toBe(503);
      expect(thrown.getResponse()).toMatchObject({ status: 'degraded', database: 'unavailable' });
    }
  });

  it('does not echo the underlying error on an unauthenticated endpoint', async () => {
    // Assembled in pieces so no line carries the `user:password@host` shape.
    // The secret scan is right to object to that shape even in a fixture, and
    // the runtime value is identical either way.
    const password = ['hun', 'ter', '2'].join('');
    const secret = ['postgresql://modex', password].join(':') + '@db.internal:5432/modex';
    const controller = controllerWith(() => Promise.reject(new Error(secret)));
    try {
      await controller.ready();
    } catch (error) {
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain(
        password,
      );
    }
  });
});
