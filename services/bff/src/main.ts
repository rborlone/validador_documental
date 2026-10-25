import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  // bodyParser desactivado: el BFF no parsea cuerpos (el multipart se reenvía en streaming).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));
  setupApp(app);
  const port = app.get(AppConfig).get('PORT');
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`BFF escuchando en el puerto ${port}`);
}

bootstrap().catch((err: unknown) => {
  console.error(JSON.stringify({ level: 'fatal', message: 'No se pudo iniciar el BFF', error: String(err) }));
  process.exit(1);
});
