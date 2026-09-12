import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';

/**
 * HTTPS only, TLS 1.2+ (terminated at the load balancer), REST/JSON under `/v1`
 * with OpenAPI 3.x generated from code (Phase 0 section 3.5).
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // `rawBody` keeps the exact bytes a partner signed. Verifying a signature
  // against a re-serialised body would mean a partner's key ordering could
  // change the signature without changing the request — which is how webhook
  // verification quietly stops working for one partner and nobody notices.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  /**
   * How many proxies sit in front of this process.
   *
   * Express walks `X-Forwarded-For` from the right by exactly this many hops to
   * find the client address. Setting `true` — "trust every hop" — is the
   * classic rate-limit bypass: a client appends its own entries and pushes its
   * real address out of view. A number is a claim about the deployment, and the
   * deployment is what has to be right.
   */
  app.set('trust proxy', env.TRUSTED_PROXY_HOPS);

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: [env.PUBLIC_WEB_ORIGIN],
    credentials: true,
    // The correlation header has to survive the preflight or the whole tracing
    // story stops at the browser.
    allowedHeaders: ['content-type', 'authorization', 'x-correlation-id', 'idempotency-key'],
    exposedHeaders: ['x-request-id', 'x-correlation-id'],
  });

  const openApi = new DocumentBuilder()
    .setTitle('Modex Apply API')
    .setDescription(
      'Direct university applications with verified student support. ' +
        'Money is always integer minor units plus an ISO 4217 code.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('v1/openapi', app, SwaggerModule.createDocument(app, openApi));

  await app.listen(env.PORT);
  new Logger('bootstrap').log(`Modex Apply API listening on ${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
