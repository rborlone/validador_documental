import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ConfirmChannel } from 'amqplib';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { z } from 'zod';
import { AppConfig } from '../config/app-config';
import { AmqpService } from '../messaging/amqp.service';
import { NotificationsHub } from './notifications.hub';

export const EXCHANGE_NOTIFICATIONS = 'notifications';

const statusChanged = z.object({
  type: z.literal('doc.status.changed'),
  id: z.string().optional(),
  correlationid: z.string().optional(),
  data: z
    .object({
      documentId: z.string(),
      filename: z.string(),
      status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']),
      verdict: z.enum(['VALID', 'INVALID', 'REVIEW']).nullable().optional(),
      documentType: z.string().nullable().optional(),
      updatedAt: z.string(),
    })
    .loose(),
});

/**
 * Cada réplica del BFF declara su propia cola exclusiva/auto-delete `bff.notifications.<instancia>`
 * atada al fanout `notifications`, así todas reciben cada cambio de estado y lo empujan por SSE.
 */
@Injectable()
export class NotificationsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsConsumer.name);
  readonly queueName: string;

  constructor(
    private readonly amqp: AmqpService,
    private readonly hub: NotificationsHub,
    config: AppConfig,
  ) {
    const instance = config.get('INSTANCE_ID') ?? `${hostname()}-${randomBytes(3).toString('hex')}`;
    this.queueName = `bff.notifications.${instance}`;
  }

  onApplicationBootstrap(): void {
    this.amqp.consume(
      'notifications',
      100,
      async (ch: ConfirmChannel) => {
        await ch.assertExchange(EXCHANGE_NOTIFICATIONS, 'fanout', { durable: true });
        const q = await ch.assertQueue(this.queueName, { exclusive: true, autoDelete: true, durable: false });
        await ch.bindQueue(q.queue, EXCHANGE_NOTIFICATIONS, '');
        return q.queue;
      },
      (msg) => this.handle(msg.content),
    );
  }

  /** Valida el CloudEvent y reenvía solo su `data` a los clientes SSE. */
  handle(content: Buffer): void {
    let json: unknown;
    try {
      json = JSON.parse(content.toString('utf8'));
    } catch {
      this.logger.warn('Notificación descartada: no es JSON válido');
      return;
    }
    const parsed = statusChanged.safeParse(json);
    if (!parsed.success) {
      this.logger.warn({ error: parsed.error.message }, 'Notificación descartada: no es un doc.status.changed válido');
      return;
    }
    const { data, id, correlationid } = parsed.data;
    this.logger.debug({ correlationId: correlationid, documentId: data.documentId, status: data.status }, 'Reenviando cambio de estado por SSE');
    this.hub.broadcast(data, id);
  }
}
