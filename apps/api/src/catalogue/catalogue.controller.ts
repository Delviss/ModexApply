import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  MoneySchema,
  PROGRAM_LEVELS,
  RULE_TYPES,
  RuleJsonSchema,
  type AccessContext,
} from '@modex/contracts';
import { CatalogueService } from './catalogue.service.js';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { Public, RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';

const ProgramSchema = z.object({
  name: z.string().min(2).max(300),
  level: z.enum(PROGRAM_LEVELS),
  field: z.string().min(2).max(200),
  durationMonths: z.number().int().min(1).max(120),
  studyMode: z.enum(['full_time', 'part_time', 'distance', 'hybrid']).optional(),
  description: z.string().max(8000).nullable().optional(),
  campusId: z.string().nullable().optional(),
  sourceRef: z.string().max(500).nullable().optional(),
});

const IntakeSchema = z.object({
  startDate: z.iso.datetime(),
  applicationDeadline: z.iso.datetime(),
  capacity: z.number().int().min(0).nullable().optional(),
  sourceRef: z.string().max(500).nullable().optional(),
});

const RequirementBodySchema = z.object({
  ruleType: z.enum(RULE_TYPES),
  ruleJson: RuleJsonSchema,
  humanSummary: z.string().min(10).max(2000),
  sourceRef: z.string().min(1).max(500),
  intakeId: z.string().nullable().optional(),
});

const FeesSchema = z.object({
  tuition: MoneySchema,
  applicationFee: MoneySchema.nullable().optional(),
  deposit: MoneySchema.nullable().optional(),
  intakeId: z.string().nullable().optional(),
  sourceRef: z.string().max(500).nullable().optional(),
});

const UnpublishSchema = z.object({ reason: z.string().min(5).max(1000) });

@Controller({ version: '1' })
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  /** SSR public programme page. */
  @Public()
  @Get('programmes/:programKey/public')
  async publicProgram(@Param('programKey') programKey: string) {
    return this.catalogue.getPublicProgram(programKey);
  }

  /**
   * Every effective-dated version, oldest first. The history is deliberately
   * readable: a student who applied against version 3 can see version 3.
   */
  @Public()
  @Get('programmes/:programKey/history')
  async history(@Param('programKey') programKey: string) {
    return { data: await this.catalogue.programHistory(programKey) };
  }

  @Post('institutions/:institutionId/programmes')
  @RequirePermissions('program:write')
  async create(
    @Actor() access: AccessContext,
    @Param('institutionId') institutionId: string,
    @Body(new ZodValidationPipe(ProgramSchema)) body: z.infer<typeof ProgramSchema>,
  ) {
    return this.catalogue.createProgram(access, institutionId, body);
  }

  @Post('programmes/:programKey')
  @RequirePermissions('program:write')
  async update(
    @Actor() access: AccessContext,
    @Param('programKey') programKey: string,
    @Body(new ZodValidationPipe(ProgramSchema.partial())) body: Partial<z.infer<typeof ProgramSchema>>,
  ) {
    return this.catalogue.updateProgram(access, programKey, body);
  }

  @Post('programmes/:programKey/publish')
  @RequirePermissions('program:publish')
  async publish(@Actor() access: AccessContext, @Param('programKey') programKey: string) {
    return this.catalogue.publishProgram(access, programKey);
  }

  @Post('programmes/:programKey/unpublish')
  @RequirePermissions('program:publish')
  async unpublish(
    @Actor() access: AccessContext,
    @Param('programKey') programKey: string,
    @Body(new ZodValidationPipe(UnpublishSchema)) body: z.infer<typeof UnpublishSchema>,
  ) {
    return this.catalogue.unpublishProgram(access, programKey, body.reason);
  }

  @Post('programmes/:programKey/intakes')
  @RequirePermissions('intake:write')
  async addIntake(
    @Actor() access: AccessContext,
    @Param('programKey') programKey: string,
    @Body(new ZodValidationPipe(IntakeSchema)) body: z.infer<typeof IntakeSchema>,
  ) {
    return this.catalogue.addIntake(access, programKey, {
      startDate: new Date(body.startDate),
      applicationDeadline: new Date(body.applicationDeadline),
      capacity: body.capacity ?? null,
      sourceRef: body.sourceRef ?? null,
    });
  }

  @Post('programmes/:programKey/requirements')
  @RequirePermissions('requirement:write')
  async addRequirement(
    @Actor() access: AccessContext,
    @Param('programKey') programKey: string,
    @Body(new ZodValidationPipe(RequirementBodySchema)) body: z.infer<typeof RequirementBodySchema>,
  ) {
    return this.catalogue.addRequirement(access, programKey, body);
  }

  @Post('programmes/:programKey/fees')
  @RequirePermissions('program:write')
  async setFees(
    @Actor() access: AccessContext,
    @Param('programKey') programKey: string,
    @Body(new ZodValidationPipe(FeesSchema)) body: z.infer<typeof FeesSchema>,
  ) {
    return this.catalogue.setFees(access, programKey, {
      tuition: body.tuition,
      applicationFee: body.applicationFee ?? null,
      deposit: body.deposit ?? null,
      intakeId: body.intakeId ?? null,
      sourceRef: body.sourceRef ?? null,
    });
  }
}
