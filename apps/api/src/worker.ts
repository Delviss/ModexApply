import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

/**
 * Worker entrypoint.
 *
 * The same modules as the API, with no HTTP server. Running workers in their
 * own process is what lets the queue be scaled — or restarted — without taking
 * request traffic with it, and a malware scan that pins a CPU for thirty
 * seconds should not be sharing an event loop with a student's search.
 *
 * `WorkersService.onModuleInit` does the registration, so this file is
 * deliberately thin: the two processes cannot drift apart on which queues they
 * consume.
 */
async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const logger = new Logger('Worker');
  context.useLogger(logger);
  context.enableShutdownHooks();

  logger.log('Worker process started');

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      logger.log(`${signal} received, draining workers`);
      void context.close().then(() => process.exit(0));
    });
  }
}

void bootstrap();
