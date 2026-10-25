import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import busboy from 'busboy';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Readable } from 'node:stream';
import { AppConfig } from '../config/app-config';
import { cloudEvent } from '../messaging/cloud-event';
import { EXCHANGE_DOCUMENTS, EXCHANGE_NOTIFICATIONS, RK_VALIDATION_REQUESTED, TYPE_STATUS_CHANGED } from '../messaging/topology';
import { outboxRow } from '../outbox/outbox';
import { OutboxRelayService } from '../outbox/outbox-relay.service';
import { PrismaService } from '../prisma/prisma.service';
import { BlobStorageService } from '../storage/blob-storage.service';
import { toStatusChanged, toSummary } from './document.mapper';
import { AllowedContentType, DOCUMENT_TYPES, DocumentSummary } from './document.types';
import { buildBlobName, displayFilename } from './filename';
import { detectMime, SNIFF_BYTES } from './mime';

/** Archivo ya guardado en Blob, a la espera de registrarse en la BD. */
export interface StoredFile {
  index: number;
  id: string;
  filename: string;
  blobName: string;
  contentType: AllowedContentType;
  sizeBytes: number;
}

export interface MultipartRequest extends Readable {
  headers: IncomingHttpHeaders;
}

const FILES_FIELD = 'files';

/**
 * Recibe el multipart en streaming (busboy), detecta el MIME real por magic bytes, sube cada archivo
 * a Blob sin guardarlo en disco y, en una sola transacción, registra los documentos QUEUED y sus
 * mensajes en el outbox. Si algo falla, borra los blobs ya subidos.
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobStorageService,
    private readonly relay: OutboxRelayService,
    private readonly config: AppConfig,
  ) {}

  async upload(req: MultipartRequest, correlationId: string): Promise<DocumentSummary[]> {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      throw new UnsupportedMediaTypeException('Se esperaba multipart/form-data con el campo "files".');
    }

    const { files, fields } = await this.receive(req);

    try {
      if (files.length === 0) {
        throw new BadRequestException('Debes enviar al menos un archivo en el campo "files".');
      }
      const expectedType = this.parseExpectedType(fields.expectedType);
      const summaries = await this.persist(files, expectedType, correlationId);
      this.logger.log({ documentIds: summaries.map((s) => s.id) }, `${summaries.length} documento(s) recibidos y encolados`);
      this.relay.kick();
      return summaries;
    } catch (err) {
      await this.cleanup(files);
      throw err;
    }
  }

  private parseExpectedType(raw: string | undefined): string | null {
    const value = raw?.trim();
    if (!value) return null;
    if (!(DOCUMENT_TYPES as readonly string[]).includes(value)) {
      throw new BadRequestException(`expectedType inválido: "${value}". Valores permitidos: ${DOCUMENT_TYPES.join(', ')}.`);
    }
    return value;
  }

  /** Inserta documentos + outbox en una única transacción. */
  private async persist(files: StoredFile[], expectedType: string | null, correlationId: string): Promise<DocumentSummary[]> {
    const container = this.blob.containerName;
    const created = await this.prisma.$transaction(async (tx) => {
      const docs = [];
      for (const f of files) {
        docs.push(
          await tx.document.create({
            data: {
              id: f.id,
              filename: f.filename,
              contentType: f.contentType,
              sizeBytes: BigInt(f.sizeBytes),
              container,
              blobName: f.blobName,
              status: 'QUEUED',
              expectedType,
              correlationId,
            },
          }),
        );
      }
      const outbox = docs.flatMap((d) => [
        outboxRow(
          cloudEvent(
            RK_VALIDATION_REQUESTED,
            {
              documentId: d.id,
              container,
              blobName: d.blobName,
              contentType: d.contentType,
              filename: d.filename,
              expectedType: d.expectedType,
              attempt: 1,
            },
            correlationId,
          ),
          EXCHANGE_DOCUMENTS,
          RK_VALIDATION_REQUESTED,
        ),
        outboxRow(cloudEvent(TYPE_STATUS_CHANGED, toStatusChanged(d), correlationId), EXCHANGE_NOTIFICATIONS, TYPE_STATUS_CHANGED),
      ]);
      await tx.outboxMessage.createMany({ data: outbox });
      return docs;
    });
    return created.map(toSummary);
  }

  /** Parsea el multipart y sube cada archivo a medida que llega. */
  private receive(req: MultipartRequest): Promise<{ files: StoredFile[]; fields: Record<string, string> }> {
    const maxFiles = this.config.get('MAX_FILES');
    const maxBytes = this.config.maxFileSizeBytes;

    return new Promise((resolve, reject) => {
      let parser: busboy.Busboy;
      try {
        parser = busboy({
          headers: req.headers,
          defParamCharset: 'utf8',
          limits: { files: maxFiles, fileSize: maxBytes, fields: 10, fieldSize: 1024, parts: maxFiles + 10 },
        });
      } catch {
        reject(new BadRequestException('La cabecera multipart es inválida (falta el boundary).'));
        return;
      }

      const stored: StoredFile[] = [];
      const pending: Promise<void>[] = [];
      const fields: Record<string, string> = {};
      let failure: HttpException | Error | null = null;
      let finished = false;
      let index = 0;

      const fail = (err: HttpException | Error): void => {
        if (!failure) failure = err;
      };

      const finish = async (): Promise<void> => {
        if (finished) return;
        finished = true;
        await Promise.allSettled(pending);
        stored.sort((a, b) => a.index - b.index);
        if (failure) {
          await this.cleanup(stored);
          reject(failure);
        } else {
          resolve({ files: stored, fields });
        }
      };

      parser.on('file', (name, stream, info) => {
        if (failure) {
          stream.resume();
          return;
        }
        if (name !== FILES_FIELD) {
          fail(new BadRequestException(`Campo de archivo inesperado "${name}"; usa "${FILES_FIELD}".`));
          stream.resume();
          return;
        }
        const task = this.storeFile(index++, stream, info.filename ?? 'archivo')
          .then((f) => {
            stored.push(f);
          })
          .catch((err: Error) => {
            fail(err);
            stream.resume();
          });
        pending.push(task);
      });

      parser.on('field', (name, value, info) => {
        if (info.valueTruncated) fail(new BadRequestException(`El campo "${name}" es demasiado largo.`));
        fields[name] = value;
      });
      parser.on('filesLimit', () => fail(new BadRequestException(`Se permiten como máximo ${maxFiles} archivos por solicitud.`)));
      parser.on('fieldsLimit', () => fail(new BadRequestException('Demasiados campos en el formulario.')));
      parser.on('partsLimit', () => fail(new BadRequestException('Demasiadas partes en el formulario.')));
      parser.on('error', (err: Error) => {
        fail(new BadRequestException(`El cuerpo multipart está mal formado: ${err.message}`));
        req.unpipe(parser);
        req.resume();
        void finish();
      });
      parser.on('close', () => void finish());
      req.on('aborted', () => {
        fail(new BadRequestException('El cliente canceló la subida.'));
        void finish();
      });

      req.pipe(parser);
    });
  }

  /** Detecta el tipo real y sube el archivo a Blob en streaming. */
  private async storeFile(index: number, stream: Readable & { truncated?: boolean }, originalName: string): Promise<StoredFile> {
    const filename = displayFilename(originalName);
    const head = await readHead(stream, SNIFF_BYTES);
    if (head.length === 0) {
      throw new BadRequestException(`El archivo "${filename}" está vacío.`);
    }
    const contentType = detectMime(head);
    if (!contentType) {
      throw new UnsupportedMediaTypeException(
        `El archivo "${filename}" no es un PDF, PNG, JPEG ni TIFF válido (se verifica el contenido, no la extensión).`,
      );
    }

    const id = randomUUID();
    const blobName = buildBlobName(id, filename);
    const maxBytes = this.config.maxFileSizeBytes;
    let sizeBytes = 0;
    let truncated = false;
    stream.once('limit', () => {
      truncated = true;
    });

    async function* body(): AsyncGenerator<Buffer> {
      sizeBytes += head.length;
      yield head;
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        sizeBytes += chunk.length;
        yield chunk;
      }
      if (truncated || stream.truncated) {
        throw new PayloadTooLargeException(`El archivo "${filename}" supera el máximo de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      }
    }

    try {
      await this.blob.upload(blobName, Readable.from(body()), contentType);
    } catch (err) {
      await this.blob.deleteQuietly(blobName);
      if (err instanceof HttpException) throw err;
      this.logger.error({ err, blobName }, 'Error subiendo el archivo a Blob Storage');
      throw err;
    }
    return { index, id, filename, blobName, contentType, sizeBytes };
  }

  private async cleanup(files: StoredFile[]): Promise<void> {
    await Promise.all(files.map((f) => this.blob.deleteQuietly(f.blobName)));
  }
}

/** Lee al menos `size` bytes (o hasta el final) sin perder datos: el resto queda en el buffer del stream. */
export function readHead(stream: Readable, size: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    const cleanup = (): void => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      length += chunk.length;
      if (length >= size) {
        stream.pause();
        cleanup();
        resolve(Buffer.concat(chunks));
      }
    };
    const onEnd = (): void => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}
