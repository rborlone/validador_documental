import { Module } from '@nestjs/common';
import { DocumentsClient } from './documents.client';
import { DocumentsController } from './documents.controller';

@Module({ controllers: [DocumentsController], providers: [DocumentsClient] })
export class DocumentsModule {}
