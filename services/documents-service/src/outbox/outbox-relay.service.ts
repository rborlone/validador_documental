import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AsyncResource } from 'node:async_hooks';
import { AppConfig } from '../config/app-config';
import { AmqpService } from '../messaging/amqp.service';
import { EXCHANGE_DOCUMENTS } from '../messaging/topology';
import { PrismaService } from '../prisma/prisma.service';
import { backoffSeconds, PendingOutboxRow } from './outbox';

/**
 * Relay del outbox transaccional.
 * Cada ciclo toma un lote de filas pendientes con `FOR UPDATE SKIP LOCKED` (varias réplicas
 * pueden correr a la vez sin publicar dos veces la misma fila), publica con publisher confirms
 * y marca `published_at`. Las fallas incrementan `attempts` y reprograman con backoff.
 * Garantía: al menos una vez (los consumidores son idempotentes).
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  /**
   * `kick()` se llama desde un request HTTP: el timer se programa fuera de ese contexto
   * (AsyncLocalStorage de pino) para que los logs del relay no hereden el `req` del request.
   */
  private readonly scheduleDetached = AsyncResource.bind((delayMs: number) => this.schedule(delayMs));

  constructor(
    private readonly prisma: PrismaService,
    private readonly amqp: AmqpService,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.stopped = false;
    this.schedule(this.config.get('OUTBOX_INTERVAL_MS'));
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  /** Pide un ciclo inmediato (p. ej. justo después de insertar en el outbox). */
  kick(): void {
    if (this.stopped || this.running) return;
    this.scheduleDetached(0);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.loop(), delayMs);
  }

  private async loop(): Promise<void> {
    if (this.running) return;
    let published = 0;
    this.running = (async () => {
      try {
        published = await this.relayBatch();
      } catch (err) {
        this.logger.error({ err }, 'Error en el ciclo del outbox');
      }
    })();
    await this.running;
    this.running = null;
    // Si el lote vino lleno, probablemente hay más pendientes: seguir sin esperar.
    const full = published >= this.config.get('OUTBOX_BATCH_SIZE');
    this.schedule(full ? 0 : this.config.get('OUTBOX_INTERVAL_MS'));
  }

  /** Procesa un lote. Devuelve cuántos mensajes se publicaron. */
  async relayBatch(): Promise<number> {
    if (!this.amqp.isConnected()) return 0;
    const limit = this.config.get('OUTBOX_BATCH_SIZE');

    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<PendingOutboxRow[]>(Prisma.sql`
          SELECT id, type, exchange, routing_key, payload, correlation_id, attempts
          FROM outbox
          WHERE published_at IS NULL AND next_attempt_at <= now()
          ORDER BY created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED`);
        if (rows.length === 0) return 0;

        const results = await Promise.allSettled(
          rows.map((row) =>
            this.amqp.publish(row.exchange, row.routing_key, row.payload, {
              messageId: row.id,
              correlationId: row.correlation_id,
              type: row.type,
              // En `documents` un mensaje sin cola de destino se reintenta (p. ej. el validador aún no declaró su cola).
              mandatory: row.exchange === EXCHANGE_DOCUMENTS,
            }),
          ),
        );

        const ok = rows.filter((_, i) => results[i].status === 'fulfilled').map((r) => r.id);
        if (ok.length > 0) {
          await tx.outboxMessage.updateMany({
            where: { id: { in: ok } },
            data: { publishedAt: new Date(), attempts: { increment: 1 }, lastError: null },
          });
        }

        for (let i = 0; i < rows.length; i++) {
          const res = results[i];
          if (res.status === 'fulfilled') continue;
          const row = rows[i];
          const message = res.reason instanceof Error ? res.reason.message : String(res.reason);
          const delay = backoffSeconds(row.attempts + 1);
          this.logger.warn(
            { outboxId: row.id, type: row.type, attempts: row.attempts + 1, correlationId: row.correlation_id, error: message },
            `No se pudo publicar el mensaje del outbox; se reintentará en ${delay} s`,
          );
          await tx.outboxMessage.update({
            where: { id: row.id },
            data: { attempts: { increment: 1 }, lastError: message.slice(0, 1000), nextAttemptAt: new Date(Date.now() + delay * 1000) },
          });
        }

        if (ok.length > 0) this.logger.debug(`Outbox: ${ok.length} mensaje(s) publicados`);
        return ok.length;
      },
      { timeout: 30_000, maxWait: 5_000 },
    );
  }
}
