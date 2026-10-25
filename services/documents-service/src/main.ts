import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  setupApp(app);
  const port = app.get(AppConfig).get('PORT');
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`documents-service escuchando en el puerto ${port}`);
}

bootstrap().catch((err: unknown) => {
  // El logger de Nest puede no existir todavía (p. ej. configuración inválida).
  console.error(JSON.stringify({ level: 'fatal', message: 'No se pudo iniciar documents-service', error: String(err) }));
  process.exit(1);
});
