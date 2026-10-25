import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/** Cuerpo de error según RFC 9457 (application/problem+json). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  correlationId?: string;
  [key: string]: unknown;
}

const TITLES: Record<number, string> = {
  400: 'Solicitud inválida',
  401: 'No autenticado',
  403: 'Prohibido',
  404: 'No encontrado',
  405: 'Método no permitido',
  413: 'Contenido demasiado grande',
  415: 'Tipo de contenido no soportado',
  429: 'Demasiadas solicitudes',
  500: 'Error interno',
  502: 'Error en un servicio dependiente',
  503: 'Servicio no disponible',
  504: 'Tiempo de espera agotado',
};

/** Convierte cualquier excepción en un Problem Details. Los errores 5xx no exponen detalles internos. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: unknown }>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    let detail = 'Ocurrió un error inesperado.';
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        detail = body;
      } else if (body && typeof body === 'object') {
        const { message, ...rest } = body as Record<string, unknown>;
        delete rest.error;
        delete rest.statusCode;
        detail = Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : exception.message;
        extra = rest;
      }
    }

    if (status >= 500) {
      this.logger.error({ err: exception, correlationId: req.id }, 'Error no controlado procesando la solicitud');
      if (!(exception instanceof HttpException)) detail = 'Ocurrió un error inesperado.';
    }

    const problem: ProblemDetails = {
      type: 'about:blank',
      title: TITLES[status] ?? 'Error',
      status,
      detail,
      instance: req.originalUrl ?? req.url,
      correlationId: typeof req.id === 'string' ? req.id : undefined,
      ...extra,
    };

    if (res.headersSent) {
      // El stream ya empezó (p. ej. descarga de contenido): solo se puede cortar la conexión.
      res.destroy();
      return;
    }
    res.status(status).type('application/problem+json').send(JSON.stringify(problem));
  }
}
