import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ProblemDetailsFilter } from './common/problem-details.filter';

/** Configuración HTTP común a main.ts y a las pruebas e2e. */
export function setupApp(app: INestApplication): void {
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('documents-service')
    .setDescription('API interna del dominio documento (solo dentro del clúster).')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, swagger));
}
