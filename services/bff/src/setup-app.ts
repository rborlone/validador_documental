import { INestApplication, RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { CORRELATION_HEADER } from './common/correlation';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { AppConfig } from './config/app-config';

/** Configuración HTTP común a main.ts y a las pruebas. */
export function setupApp(app: INestApplication): void {
  const config = app.get(AppConfig);
  const express = app as NestExpressApplication;
  if (config.get('TRUST_PROXY')) express.set('trust proxy', 1);

  app.use(helmet());
  // EventSource y fetch se usan sin credenciales: no se habilita Access-Control-Allow-Credentials.
  app.enableCors({
    origin: config.corsOrigins,
    credentials: false,
    exposedHeaders: [CORRELATION_HEADER],
    allowedHeaders: ['content-type', CORRELATION_HEADER, 'authorization'],
    maxAge: 600,
  });
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
}
