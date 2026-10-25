import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfig } from '../config/app-config';
import { IS_PUBLIC } from './public.decorator';

/**
 * Guard de autenticación preparado pero DESHABILITADO (AUTH_ENABLED=false por defecto).
 * TODO(Entra ID): validar el bearer token (JWT) de Microsoft Entra ID contra el JWKS del tenant
 * (issuer, audience = app registration del BFF, scopes/roles) y dejar el usuario en `req.user`.
 * Para SSE, EventSource no permite cabeceras: habrá que usar cookie de sesión o un token de corta duración.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
  ) {
    if (!config.get('AUTH_ENABLED')) this.logger.warn('Autenticación deshabilitada (AUTH_ENABLED=false): solo para entornos de prueba');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.get('AUTH_ENABLED')) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    throw new UnauthorizedException('La autenticación con Entra ID aún no está implementada.');
  }
}
