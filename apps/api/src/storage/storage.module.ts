import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';
import { loadEnv } from '../config/env.js';

@Global()
@Module({
  providers: [{ provide: StorageService, useFactory: () => new StorageService(loadEnv()) }],
  exports: [StorageService],
})
export class StorageModule {}
