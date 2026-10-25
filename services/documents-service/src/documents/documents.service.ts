import { Injectable, NotFoundException } from '@nestjs/common';
import type { Document } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BlobDownload, BlobStorageService } from '../storage/blob-storage.service';
import { toDetail, toSummary } from './document.mapper';
import type { DocumentDetail, DocumentSummary } from './document.types';

/** Consultas de lectura sobre documentos. */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobStorageService,
  ) {}

  async list(limit: number): Promise<DocumentSummary[]> {
    const rows = await this.prisma.document.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      // No se lee la columna `result` (puede ser grande): el listado usa las columnas desnormalizadas.
      omit: { result: true, error: true },
    });
    return rows.map(toSummary);
  }

  async get(id: string): Promise<DocumentDetail> {
    return toDetail(await this.findOrThrow(id));
  }

  async content(id: string): Promise<{ doc: Document; file: BlobDownload }> {
    const doc = await this.findOrThrow(id);
    const file = await this.blob.download(doc.blobName);
    if (!file) throw new NotFoundException(`El archivo del documento ${id} no existe en el almacenamiento.`);
    return { doc, file };
  }

  private async findOrThrow(id: string): Promise<Document> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`No existe el documento ${id}.`);
    return doc;
  }
}
