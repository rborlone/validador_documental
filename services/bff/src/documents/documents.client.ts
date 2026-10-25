import { BadGatewayException, GatewayTimeoutException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import { Agent, Dispatcher, errors, request } from 'undici';
import { CORRELATION_HEADER } from '../common/correlation';
import { AppConfig } from '../config/app-config';

export interface UpstreamResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Dispatcher.ResponseData['body'];
}

export type UploadResponseLike = UpstreamResponse;

const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * Cliente HTTP hacia documents-service (undici).
 * - Propaga `x-correlation-id`.
 * - Timeouts de conexión/cabeceras/cuerpo.
 * - Reintentos con backoff SOLO en GET (idempotentes) ante errores de red o 502/503/504.
 */
@Injectable()
export class DocumentsClient implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentsClient.name);
  private readonly agent: Agent;
  private readonly baseUrl: string;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = config.get('DOCUMENTS_SERVICE_URL').replace(/\/+$/, '');
    this.agent = new Agent({ connect: { timeout: 3000 }, keepAliveTimeout: 10_000, connections: 128 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.agent.close();
  }

  /** GET con reintentos. El cuerpo se devuelve como stream (el llamador lo consume o lo reenvía). */
  async get(path: string, correlationId: string, bodyTimeoutMs?: number): Promise<UpstreamResponse> {
    const retries = this.config.get('UPSTREAM_RETRIES');
    const timeout = this.config.get('UPSTREAM_TIMEOUT_MS');
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(150 * 2 ** (attempt - 1));
      try {
        const res = await request(`${this.baseUrl}${path}`, {
          method: 'GET',
          dispatcher: this.agent,
          headers: { [CORRELATION_HEADER]: correlationId, accept: 'application/json, */*' },
          headersTimeout: timeout,
          bodyTimeout: bodyTimeoutMs ?? timeout,
        });
        if (RETRYABLE_STATUS.has(res.statusCode) && attempt < retries) {
          await res.body.dump();
          this.logger.warn({ correlationId, path, status: res.statusCode, attempt: attempt + 1 }, 'documents-service respondió con error transitorio; se reintenta');
          continue;
        }
        return { status: res.statusCode, headers: res.headers, body: res.body };
      } catch (err) {
        lastError = err;
        this.logger.warn({ correlationId, path, attempt: attempt + 1, error: (err as Error).message }, 'Fallo de red hacia documents-service');
      }
    }
    throw toGatewayError(lastError);
  }

  /**
   * Reenvía un multipart en streaming: el cuerpo del request entrante se pasa tal cual (sin parsear
   * ni guardarlo) junto con su content-type (que trae el boundary). Nunca se reintenta.
   */
  async forwardUpload(body: Readable, contentType: string, contentLength: number | undefined, correlationId: string): Promise<UpstreamResponse> {
    const headers: Record<string, string> = { 'content-type': contentType, [CORRELATION_HEADER]: correlationId, accept: 'application/json' };
    if (contentLength !== undefined) headers['content-length'] = String(contentLength);
    try {
      const res = await request(`${this.baseUrl}/documents`, {
        method: 'POST',
        dispatcher: this.agent,
        headers,
        body,
        headersTimeout: this.config.get('UPLOAD_TIMEOUT_MS'),
        bodyTimeout: this.config.get('UPSTREAM_TIMEOUT_MS'),
      });
      return { status: res.statusCode, headers: res.headers, body: res.body };
    } catch (err) {
      const tooLarge = findUploadTooLarge(err);
      if (tooLarge) throw tooLarge;
      throw toGatewayError(err);
    }
  }
}

export class UploadTooLargeError extends Error {}

function toGatewayError(err: unknown): Error {
  if (err instanceof errors.HeadersTimeoutError || err instanceof errors.BodyTimeoutError || err instanceof errors.ConnectTimeoutError) {
    return new GatewayTimeoutException('documents-service no respondió a tiempo.');
  }
  return new BadGatewayException('No se pudo contactar a documents-service.');
}

/** undici puede envolver el error del stream del cuerpo: se busca en la cadena de causas. */
function findUploadTooLarge(err: unknown): UploadTooLargeError | null {
  let current: unknown = err;
  for (let i = 0; i < 5 && current instanceof Error; i++) {
    if (current instanceof UploadTooLargeError) return current;
    current = current.cause;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
