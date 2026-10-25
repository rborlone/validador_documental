import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../config/app-config';

/** Lo mínimo que el hub necesita de una respuesta HTTP abierta. */
export interface SseClient {
  write(chunk: string): boolean;
  end(): void;
  readonly writableLength: number;
}

export const SSE_EVENT = 'document.updated';
/** Si un cliente acumula más que esto sin leer, se le desconecta (cliente lento). */
const MAX_BUFFERED_BYTES = 1024 * 1024;

/**
 * Registro de clientes SSE conectados a ESTA réplica. Cada réplica recibe todas las
 * notificaciones (cola exclusiva atada al fanout) y las reenvía a sus propios clientes.
 */
@Injectable()
export class NotificationsHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsHub.name);
  private readonly clients = new Set<SseClient>();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: AppConfig) {}

  onModuleInit(): void {
    this.pingTimer = setInterval(() => this.ping(), this.config.get('SSE_PING_MS'));
    this.pingTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    // Cerrar las conexiones abiertas permite que el servidor HTTP termine el apagado.
    for (const c of this.clients) c.end();
    this.clients.clear();
  }

  get size(): number {
    return this.clients.size;
  }

  /** Registra un cliente; devuelve la función para darlo de baja. */
  subscribe(client: SseClient): () => void {
    this.clients.add(client);
    return () => {
      this.clients.delete(client);
    };
  }

  /** Envía `data` como evento `document.updated` a todos los clientes. */
  broadcast(data: unknown, id?: string): void {
    const frame = `${id ? `id: ${id}\n` : ''}event: ${SSE_EVENT}\ndata: ${JSON.stringify(data)}\n\n`;
    this.send(frame);
  }

  ping(): void {
    this.send(': ping\n\n');
  }

  private send(frame: string): void {
    for (const c of this.clients) {
      if (c.writableLength > MAX_BUFFERED_BYTES) {
        this.logger.warn('Cliente SSE demasiado lento; se desconecta');
        this.clients.delete(c);
        c.end();
        continue;
      }
      c.write(frame);
    }
  }
}
