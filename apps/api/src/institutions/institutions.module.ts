import { Module } from '@nestjs/common';
import { InstitutionsController } from './institutions.controller.js';
import { InstitutionsService } from './institutions.service.js';
import { Resolver } from 'node:dns/promises';
import { DNS_LOOKUP, DomainVerificationService } from './domain-verification.service.js';

@Module({
  controllers: [InstitutionsController],
  providers: [
    InstitutionsService,
    DomainVerificationService,
    { provide: DNS_LOOKUP, useFactory: () => new Resolver() },
  ],
  exports: [InstitutionsService, DomainVerificationService],
})
export class InstitutionsModule {}
