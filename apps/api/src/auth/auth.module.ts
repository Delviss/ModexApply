import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionResolver } from './session-resolver.js';
import { TokenService } from './token.service.js';
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
    AuthService,
    SessionResolver,
  ],
  exports: [AuthService, SessionResolver, TokenService],
})
export class AuthModule {}
