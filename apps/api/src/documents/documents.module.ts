import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { MALWARE_SCANNER, NoScanner, type MalwareScanner } from './scanner.port.js';
import { ClamAvScanner } from './clamav.scanner.js';
import { loadEnv } from '../config/env.js';

/**
 * The vault, and the scanner behind it.
 *
 * The scanner is selected by configuration, and the default is `NoScanner`,
 * which never returns `clean`. An unconfigured environment therefore holds
 * every document short of the connector boundary rather than waving unscanned
 * files through — fail-closed is the default state, not an option somebody has
 * to remember to switch on.
 */
@Module({
  imports: [AuditModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    {
      provide: MALWARE_SCANNER,
      useFactory: (): MalwareScanner => {
        const env = loadEnv();
        return env.MALWARE_SCANNER === 'clamav'
          ? new ClamAvScanner(env.CLAMAV_HOST, env.CLAMAV_PORT)
          : new NoScanner();
      },
    },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
