import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { StorageModule } from '../storage/storage.module';
import { DocumentStateService } from './document-state.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ResultsConsumer } from './results.consumer';
import { UploadService } from './upload.service';

@Module({
  imports: [StorageModule, OutboxModule],
  controllers: [DocumentsController],
  providers: [UploadService, DocumentsService, DocumentStateService, ResultsConsumer],
})
export class DocumentsModule {}
