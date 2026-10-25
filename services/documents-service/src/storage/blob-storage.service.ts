import { BlobServiceClient, ContainerClient, RestError } from '@azure/storage-blob';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { AppConfig } from '../config/app-config';

export interface BlobDownload {
  stream: NodeJS.ReadableStream;
  contentLength?: number;
  contentType?: string;
}

/**
 * Acceso a Azure Blob Storage (Azurite en local).
 * En AKS se podría reemplazar la connection string por Workload Identity (DefaultAzureCredential).
 */
@Injectable()
export class BlobStorageService implements OnModuleInit {
  private readonly logger = new Logger(BlobStorageService.name);
  private readonly container: ContainerClient;

  constructor(config: AppConfig) {
    const service = BlobServiceClient.fromConnectionString(config.get('AZURE_STORAGE_CONNECTION_STRING'));
    this.container = service.getContainerClient(config.get('BLOB_CONTAINER'));
  }

  get containerName(): string {
    return this.container.containerName;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureContainer();
  }

  /** Crea el container si no existe (idempotente). */
  async ensureContainer(): Promise<void> {
    const res = await this.container.createIfNotExists();
    if (res.succeeded) this.logger.log(`Container de Blob "${this.containerName}" creado`);
  }

  /** Sube un stream como block blob y devuelve la cantidad de bytes escritos. */
  async upload(blobName: string, body: Readable, contentType: string): Promise<void> {
    const client = this.container.getBlockBlobClient(blobName);
    await client.uploadStream(body, 4 * 1024 * 1024, 2, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
  }

  async download(blobName: string): Promise<BlobDownload | null> {
    try {
      const res = await this.container.getBlobClient(blobName).download();
      if (!res.readableStreamBody) return null;
      return { stream: res.readableStreamBody, contentLength: res.contentLength, contentType: res.contentType };
    } catch (err) {
      if (err instanceof RestError && err.statusCode === 404) return null;
      throw err;
    }
  }

  /** Borra un blob; se usa para limpiar subidas de una solicitud que falló. No lanza errores. */
  async deleteQuietly(blobName: string): Promise<void> {
    try {
      await this.container.getBlobClient(blobName).deleteIfExists();
    } catch (err) {
      this.logger.warn({ err, blobName }, 'No se pudo borrar el blob huérfano');
    }
  }
}
