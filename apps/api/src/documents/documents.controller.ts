import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { DOCUMENT_TYPES, type AccessContext } from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { DocumentsService } from './documents.service.js';

const CreateVersionSchema = z.object({
  documentId: z.string().nullable().optional(),
  type: z.enum(DOCUMENT_TYPES),
  displayName: z.string().min(1).max(200),
  contentType: z.string().max(200).nullable().default(null),
  sizeBytes: z.number().int().min(0).nullable().default(null),
  expiryAt: z.iso.datetime().nullable().optional(),
});

const FinaliseSchema = z.object({
  /** Lowercase hex SHA-256, computed by the client over the bytes it sent. */
  checksum: z.string().regex(/^[a-f0-9]{64}$/, 'Checksum must be a hex SHA-256 digest'),
  sizeBytes: z.number().int().min(0),
});

/**
 * The document vault (Phase 2 §2, FR-003).
 *
 * Every route is owner-scoped and re-authorised in the service against the
 * loaded row. There is no `@Public()` here and there never should be.
 */
@Controller({ path: 'documents', version: '1' })
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermissions('document:read')
  async list(@Actor() access: AccessContext) {
    return { data: await this.documents.list(access) };
  }

  @Post('versions')
  @RequirePermissions('document:write')
  async createVersion(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(CreateVersionSchema)) body: z.infer<typeof CreateVersionSchema>,
  ) {
    return this.documents.createVersion(access, {
      documentId: body.documentId ?? null,
      type: body.type,
      displayName: body.displayName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      expiryAt: body.expiryAt == null ? null : new Date(body.expiryAt),
    });
  }

  @Post('versions/:versionId/finalise')
  @RequirePermissions('document:write')
  async finalise(
    @Actor() access: AccessContext,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(FinaliseSchema)) body: z.infer<typeof FinaliseSchema>,
  ) {
    return this.documents.finalise(access, versionId, body);
  }

  @Post('versions/:versionId/download-url')
  @RequirePermissions('document:read')
  async downloadUrl(@Actor() access: AccessContext, @Param('versionId') versionId: string) {
    return this.documents.signDownload(access, versionId);
  }

  @Delete(':documentId')
  @RequirePermissions('document:delete')
  async remove(@Actor() access: AccessContext, @Param('documentId') documentId: string) {
    return this.documents.remove(access, documentId);
  }
}
