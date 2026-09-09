import { Module } from '@nestjs/common';
import { InstitutionsController } from './institutions.controller.js';
import { InstitutionsService } from './institutions.service.js';
import { DomainVerificationService } from './domain-verification.service.js';

@Module({
  controllers: [InstitutionsController],
  providers: [InstitutionsService, DomainVerificationService],
  exports: [InstitutionsService, DomainVerificationService],
})
export class InstitutionsModule {}
