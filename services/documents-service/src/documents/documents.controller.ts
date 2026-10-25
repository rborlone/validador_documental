import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Readable } from 'node:stream';
import { correlationIdOf } from '../common/correlation';
import { DOCUMENT_TYPES, type DocumentDetail, type DocumentSummary } from './document.types';
import { DocumentsService } from './documents.service';
import { DocumentDetailDto, ListQueryDto, ListResponseDto, UploadResponseDto } from './dto/api.dto';
import { UploadService } from './upload.service';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException('El id debe ser un UUID válido.') });

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly uploads: UploadService,
    private readonly documents: DocumentsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Sube 1..10 documentos y los encola para validación' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        expectedType: { type: 'string', enum: [...DOCUMENT_TYPES] },
      },
    },
  })
  @ApiResponse({ status: 202, type: UploadResponseDto })
  @ApiResponse({ status: 400, description: 'Solicitud inválida (problem+json)' })
  @ApiResponse({ status: 413, description: 'Archivo demasiado grande' })
  @ApiResponse({ status: 415, description: 'Tipo de archivo no soportado' })
  async upload(@Req() req: Request): Promise<{ documents: DocumentSummary[] }> {
    const documents = await this.uploads.upload(req, correlationIdOf(req));
    return { documents };
  }

  @Get()
  @ApiOperation({ summary: 'Lista los documentos más recientes primero' })
  @ApiOkResponse({ type: ListResponseDto })
  async list(@Query() query: ListQueryDto): Promise<{ items: DocumentSummary[] }> {
    return { items: await this.documents.list(query.limit ?? 50) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un documento con su resultado' })
  @ApiOkResponse({ type: DocumentDetailDto })
  @ApiResponse({ status: 404, description: 'No existe' })
  get(@Param('id', uuidPipe) id: string): Promise<DocumentDetail> {
    return this.documents.get(id);
  }

  @Get(':id/content')
  @ApiOperation({ summary: 'Contenido binario del archivo (stream desde Blob)' })
  @ApiProduces('application/pdf', 'image/png', 'image/jpeg', 'image/tiff')
  async content(@Param('id', uuidPipe) id: string): Promise<StreamableFile> {
    const { doc, file } = await this.documents.content(id);
    return new StreamableFile(file.stream as Readable, {
      type: doc.contentType,
      length: file.contentLength,
      disposition: contentDisposition(doc.filename),
    });
  }
}

/** `inline; filename="<ascii>"; filename*=UTF-8''<utf8>` (RFC 6266) para que el navegador muestre el archivo. */
export function contentDisposition(filename: string): string {
  const ascii = filename
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
