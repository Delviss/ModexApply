import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionResolver } from './session-resolver.js';
import { TokenService } from './token.service.js';
import { MfaService } from './mfa.service.js';
import { loadEnv } from '../config/env.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: TokenService,
      useFactory: () => {
        const env = loadEnv();
        return new TokenService(
          env.JWT_SIGNING_KEY,
          env.ACCESS_TOKEN_TTL_SECONDS,
          env.REFRESH_TOKEN_TTL_SECONDS,
        );
      },
    },
    {
      provide: MfaService,
      useFactory: () => new MfaService(loadEnv().MFA_SECRET_KEY),
    },
    AuthService,
    SessionResolver,
  ],
  exports: [AuthService, SessionResolver, TokenService, MfaService],
})
export class AuthModule {}
