import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env';

/** Acceso tipado a la configuración validada. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  /** Orígenes permitidos (CORS y frame-ancestors). */
  get corsOrigins(): string[] {
    return this.get('CORS_ORIGIN')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  /** Tope del cuerpo de una subida: archivos × tamaño máximo + 1 MB de margen para el multipart. */
  get maxUploadBytes(): number {
    return Math.floor(this.get('MAX_FILES') * this.get('MAX_FILE_SIZE_MB') * 1024 * 1024 + 1024 * 1024);
  }
}
