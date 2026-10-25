import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { correlationIdOf } from '../common/correlation';
import { AppConfig } from '../config/app-config';
import { DOCUMENT_TYPES } from './document-types';
import { DocumentsClient, UploadResponseLike, UploadTooLargeError } from './documents.client';
import { SizeLimitStream } from './size-limit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(id: string): void {
  if (!UUID.test(id)) throw new BadRequestException('El id debe ser un UUID válido.');
}

/** API pública para la UI (contracts/http.md, sección BFF). */
@Controller()
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    private readonly client: DocumentsClient,
    private readonly config: AppConfig,
  ) {}

  @Get('document-types')
  documentTypes(): { items: ReadonlyArray<{ id: string; label: string }> } {
    return { items: DOCUMENT_TYPES };
  }

  /** Reenvía el multipart en streaming a documents-service (no se parsea ni se guarda). */
  @Post('documents')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async upload(@Req() req: Request, @Res() res: Response): Promise<void> {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      throw new UnsupportedMediaTypeException('Se esperaba multipart/form-data con el campo "files".');
    }
    const max = this.config.maxUploadBytes;
    const rawLength = req.headers['content-length'];
    const contentLength = rawLength !== undefined ? Number(rawLength) : undefined;
    if (contentLength !== undefined && (!Number.isFinite(contentLength) || contentLength > max)) {
      // Se cierra la conexión para no seguir recibiendo un cuerpo que se va a descartar.
      res.setHeader('connection', 'close');
      throw new PayloadTooLargeException(`La subida supera el máximo permitido de ${Math.round(max / 1024 / 1024)} MB.`);
    }

    const correlationId = correlationIdOf(req);
    const limited = req.pipe(new SizeLimitStream(max));
    req.on('error', (err) => limited.destroy(err));

    let upstream: UploadResponseLike;
    try {
      upstream = await this.client.forwardUpload(limited, contentType, contentLength, correlationId);
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        res.setHeader('connection', 'close');
        throw new PayloadTooLargeException(err.message);
      }
      throw err;
    }
    await this.relay(upstream, res);
  }

  @Get('documents')
  async list(@Req() req: Request, @Res() res: Response, @Query('limit') limit?: string): Promise<void> {
    let qs = '';
    if (limit !== undefined) {
      const n = Number(limit);
      if (!Number.isInteger(n) || n < 1 || n > 200) throw new BadRequestException('limit debe ser un entero entre 1 y 200.');
      qs = `?limit=${n}`;
    }
    await this.relay(await this.client.get(`/documents${qs}`, correlationIdOf(req)), res);
  }

  @Get('documents/:id')
  async get(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    assertUuid(id);
    await this.relay(await this.client.get(`/documents/${id}`, correlationIdOf(req)), res);
  }

  /**
   * Contenido del archivo para la vista previa. La UI lo carga en un iframe desde otro origen:
   * en esta ruta (y solo aquí) se quita X-Frame-Options y se permite el embebido a CORS_ORIGIN.
   */
  @Get('documents/:id/content')
  async content(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    assertUuid(id);
    const upstream = await this.client.get(`/documents/${id}/content`, correlationIdOf(req), 60_000);
    if (upstream.status !== 200) {
      await this.relay(upstream, res);
      return;
    }
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${this.config.corsOrigins.join(' ')}`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.status(200);
    res.setHeader('Content-Type', header(upstream.headers['content-type']) ?? 'application/octet-stream');
    const length = header(upstream.headers['content-length']);
    if (length) res.setHeader('Content-Length', length);
    res.setHeader('Content-Disposition', header(upstream.headers['content-disposition']) ?? 'inline');
    res.setHeader('Cache-Control', 'private, max-age=300');
    try {
      await pipeline(upstream.body, res);
    } catch (err) {
      // El cliente cerró la vista previa o se cortó el upstream: no hay nada más que responder.
      this.logger.debug({ err }, 'Stream de contenido interrumpido');
    }
  }

  /** Copia status, content-type y cuerpo de documents-service (incluye errores problem+json). */
  private async relay(upstream: UploadResponseLike, res: Response): Promise<void> {
    const body = Buffer.from(await upstream.body.arrayBuffer());
    res.status(upstream.status);
    res.setHeader('Content-Type', header(upstream.headers['content-type']) ?? 'application/json');
    res.send(body);
  }
}

function header(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
