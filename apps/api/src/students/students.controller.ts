import { Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';
import {
  AcademicRecordSchema,
  LanguageTestSchema,
  MoneySchema,
  PROGRAM_LEVELS,
  type AccessContext,
} from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { StudentsService } from './students.service.js';

/**
 * Every field is optional: this is an autosave target, and a partial save is
 * the normal case rather than the exception.
 */
const ProfilePatchSchema = z.object({
  dateOfBirth: z.iso.date().nullable().optional(),
  nationality: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  countryOfResidence: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  intendedLevel: z.enum(PROGRAM_LEVELS).nullable().optional(),
  intendedField: z.string().max(200).nullable().optional(),
  preferredCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).optional(),
  budgetPerYear: MoneySchema.nullable().optional(),
  targetIntake: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().optional(),
  workExperienceMonths: z.number().int().min(0).nullable().optional(),
  academicRecords: z.array(AcademicRecordSchema).optional(),
  languageTests: z.array(LanguageTestSchema).optional(),
});

@Controller({ path: 'me', version: '1' })
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get('profile')
  @RequirePermissions('profile:read')
  async profile(@Actor() access: AccessContext) {
    const profile = await this.students.getOrCreate(access);
    return { profile, completeness: await this.students.completeness(access) };
  }

  @Patch('profile')
  @RequirePermissions('profile:write')
  async patch(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(ProfilePatchSchema)) body: z.infer<typeof ProfilePatchSchema>,
  ) {
    const profile = await this.students.patch(access, body);
    return { profile, completeness: await this.students.completeness(access) };
  }
}
