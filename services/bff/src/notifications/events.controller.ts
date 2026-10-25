import { Controller, Get, Logger, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { correlationIdOf } from '../common/correlation';
import { NotificationsHub } from './notifications.hub';

/**
 * SSE `/api/events`. EventSource conecta sin credenciales (CORS con origen explícito, sin cookies).
 * Evento `document.updated` con `data` = `doc.status.changed.data`; comentario `: ping` cada 25 s.
 */
@Controller()
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private readonly hub: NotificationsHub) {}

  @Get('events')
  @SkipThrottle()
  events(@Req() req: Request, @Res() res: Response): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Evita que un proxy (nginx / ingress) acumule el stream.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    req.socket.setKeepAlive(true);
    req.socket.setTimeout(0);
    res.write('retry: 5000\n\n');

    const unsubscribe = this.hub.subscribe(res);
    const correlationId = correlationIdOf(req);
    this.logger.log({ correlationId, clients: this.hub.size }, 'Cliente SSE conectado');

    req.on('close', () => {
      unsubscribe();
      this.logger.log({ correlationId, clients: this.hub.size }, 'Cliente SSE desconectado');
    });
  }
}
