import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { StorageModule } from './storage/storage.module.js';
import { QueueModule } from './queue/queue.module.js';
import { InstitutionsModule } from './institutions/institutions.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { IngestionModule } from './ingestion/ingestion.module.js';
import { SearchModule } from './search/search.module.js';
import { EligibilityModule } from './eligibility/eligibility.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { StudentsModule } from './students/students.module.js';
import { GuidesModule } from './guides/guides.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { TrustModule } from './trust/trust.module.js';
import { QaModule } from './qa/qa.module.js';
import { ApplicationsModule } from './applications/applications.module.js';
import { ConnectorsModule } from './connectors/connectors.module.js';
import { OffersModule } from './offers/offers.module.js';
import { WorkersModule } from './workers/workers.module.js';
import { HealthModule } from './health/health.module.js';
import { AdminModule } from './admin/admin.module.js';
import { PrivacyModule } from './privacy/privacy.module.js';
import { AllExceptionsFilter } from './common/errors/exception.filter.js';
import { CorrelationMiddleware } from './common/http/correlation.middleware.js';
import { MetricsInterceptor } from './common/http/metrics.interceptor.js';
import { AuthGuard } from './auth/guards/auth.guard.js';
import { PermissionsGuard } from './auth/guards/permissions.guard.js';
import { StepUpGuard } from './auth/guards/step-up.guard.js';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard.js';
import { RateLimitModule } from './common/rate-limit/rate-limit.module.js';
import { ConsentGuard } from './auth/guards/consent.guard.js';
import { IdempotencyService } from './common/idempotency/idempotency.service.js';
import { FeatureFlagService } from './config/feature-flags.js';
import { loadEnv } from './config/env.js';

@Module({
  imports: [
    RateLimitModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    StorageModule,
    QueueModule,
    InstitutionsModule,
    CatalogueModule,
    IngestionModule,
    SearchModule,
    EligibilityModule,
    DocumentsModule,
    StudentsModule,
    GuidesModule,
    MessagingModule,
    SessionsModule,
    TrustModule,
    QaModule,
    ApplicationsModule,
    ConnectorsModule,
    OffersModule,
    AdminModule,
    PrivacyModule,
    WorkersModule,
    HealthModule,
  ],
  providers: [
    IdempotencyService,
    { provide: FeatureFlagService, useFactory: () => new FeatureFlagService(loadEnv().FEATURE_FLAGS) },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    // Guard order matters: rate-limit, authenticate, check RBAC, check the
    // elevated window, then check consent. Registering them globally makes
    // "denied unless marked public" the default.
    //
    // Rate limiting runs *first*, before authentication: the routes most worth
    // limiting are the ones nobody has authenticated to yet, and a limiter that
    // only protects authenticated traffic protects the wrong half.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
    { provide: APP_GUARD, useClass: ConsentGuard },
  ],
  exports: [IdempotencyService, FeatureFlagService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
