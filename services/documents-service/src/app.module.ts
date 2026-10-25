import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';
import { loggerParams } from './logger';
import { MessagingModule } from './messaging/messaging.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot(loggerParams(process.env.LOG_LEVEL ?? 'info', 'documents-service')),
    PrismaModule,
    MessagingModule,
    DocumentsModule,
    HealthModule,
  ],
})
export class AppModule {}
