import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { GuidesController } from './guides.controller.js';
import { GuidesService } from './guides.service.js';
import { ReverificationService } from './reverification.service.js';

@Module({
  // `forwardRef` because sessions needs guides (to resolve the caller's own
  // guide row) and guides needs sessions (to serve availability on a profile).
  // The alternative — a third module holding one method — buys nothing.
  imports: [AuditModule, forwardRef(() => SessionsModule)],
  controllers: [GuidesController],
  providers: [GuidesService, ReverificationService],
  exports: [GuidesService, ReverificationService],
})
export class GuidesModule {}
