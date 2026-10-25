import { Injectable, Logger, OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import amqp, { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { AppConfig } from '../config/app-config';
import { CLOUDEVENTS_CONTENT_TYPE } from './cloud-event';
import { assertExchanges } from './topology';

export type HandlerOutcome = 'ack' | 'reject' | 'requeue';
export type MessageHandler = (msg: ConsumeMessage) => Promise<HandlerOutcome>;

export interface PublishOptions {
  messageId: string;
  correlationId?: string | null;
  type: string;
  /** Si es true, un mensaje sin cola de destino se considera fallido (vuelve a intentarse desde el outbox). */
  mandatory?: boolean;
}

export class UnroutableMessageError extends Error {
  constructor(exchange: string, routingKey: string) {
    super(`Mensaje sin cola de destino en el exchange "${exchange}" con routing key "${routingKey}"`);
  }
}

const REQUEUE_DELAY_MS = 1000;

/** messageId tipado (amqplib lo declara como any). */
export function messageIdOf(msg: ConsumeMessage): string | undefined {
  const id: unknown = msg.properties.messageId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Conexión AMQP con reconexión automática (amqp-connection-manager sobre amqplib).
 * - El canal de publicación usa publisher confirms.
 * - Las funciones `setup` declaran la topología de forma idempotente y se re-ejecutan al reconectar.
 */
@Injectable()
export class AmqpService implements OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger(AmqpService.name);
  private readonly connection: AmqpConnectionManager;
  private readonly publisher: ChannelWrapper;
  private readonly consumers: ChannelWrapper[] = [];
  /** messageIds devueltos por el broker (basic.return) en el canal de publicación actual. */
  private readonly returned = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  /** Consumidores activos en el canal subyacente actual (se reemplazan al reconectar). */
  private readonly activeConsumers = new Map<string, { ch: ConfirmChannel; consumerTag: string }>();
  private stopping = false;

  constructor(private readonly config: AppConfig) {
    this.connection = amqp.connect([config.get('RABBITMQ_URL')], {
      heartbeatIntervalInSeconds: 15,
      reconnectTimeInSeconds: 5,
      connectionOptions: { clientProperties: { connection_name: 'documents-service' } },
    });
    this.connection.on('connect', () => this.logger.log('Conectado a RabbitMQ'));
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn({ err }, 'Desconectado de RabbitMQ; se reintentará la conexión'),
    );
    this.connection.on('connectFailed', ({ err }) =>
      this.logger.warn({ err }, 'No se pudo conectar a RabbitMQ; se reintentará'),
    );

    this.publisher = this.connection.createChannel({
      name: 'publisher',
      confirm: true,
      json: false,
      publishTimeout: config.get('PUBLISH_TIMEOUT_MS'),
      setup: async (ch: ConfirmChannel) => {
        ch.on('return', (msg: ConsumeMessage) => {
          const id = messageIdOf(msg);
          if (id) this.returned.add(id);
        });
        await assertExchanges(ch);
      },
    });
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  /** Publica un CloudEvent JSON persistente y espera la confirmación del broker. */
  async publish(exchange: string, routingKey: string, payload: unknown, opts: PublishOptions): Promise<void> {
    const body = Buffer.from(JSON.stringify(payload));
    await this.publisher.publish(exchange, routingKey, body, {
      persistent: true,
      contentType: CLOUDEVENTS_CONTENT_TYPE,
      messageId: opts.messageId,
      correlationId: opts.correlationId ?? undefined,
      type: opts.type,
      appId: 'documents-service',
      timestamp: Math.floor(Date.now() / 1000),
      mandatory: opts.mandatory ?? false,
    });
    // El broker envía basic.return antes que el ack del confirm, así que aquí ya sabemos si se enrutó.
    if (this.returned.delete(opts.messageId)) {
      throw new UnroutableMessageError(exchange, routingKey);
    }
  }

  /**
   * Registra un consumidor. `setupQueue` declara la cola y sus bindings (idempotente).
   * El handler decide el ack: 'ack', 'reject' (descartar) o 'requeue' (reintentar con pausa).
   */
  consume(name: string, queue: string, prefetch: number, setupQueue: (ch: ConfirmChannel) => Promise<void>, handler: MessageHandler): void {
    const wrapper = this.connection.createChannel({
      name,
      json: false,
      setup: async (ch: ConfirmChannel) => {
        await setupQueue(ch);
        await ch.prefetch(prefetch);
        const { consumerTag } = await ch.consume(queue, (msg) => {
          if (!msg) {
            this.logger.warn(`El broker canceló el consumidor de "${queue}"`);
            return;
          }
          const task = this.dispatch(ch, msg, handler);
          this.inFlight.add(task);
          void task.finally(() => this.inFlight.delete(task));
        });
        this.activeConsumers.set(name, { ch, consumerTag });
        this.logger.log(`Consumiendo la cola "${queue}" (prefetch ${prefetch})`);
      },
    });
    this.consumers.push(wrapper);
  }

  private async dispatch(ch: ConfirmChannel, msg: ConsumeMessage, handler: MessageHandler): Promise<void> {
    let outcome: HandlerOutcome;
    try {
      outcome = await handler(msg);
    } catch (err) {
      this.logger.error({ err, messageId: messageIdOf(msg) }, 'Error inesperado en el consumidor; se reencola');
      outcome = 'requeue';
    }
    try {
      // Se confirma en el mismo canal que entregó el mensaje: si se cerró, el broker lo reentrega.
      if (outcome === 'ack') ch.ack(msg);
      else if (outcome === 'reject') ch.nack(msg, false, false);
      else {
        // Pausa breve para no entrar en un bucle caliente si la falla es transitoria (BD caída).
        if (!this.stopping) await new Promise((r) => setTimeout(r, REQUEUE_DELAY_MS));
        ch.nack(msg, false, true);
      }
    } catch (err) {
      // El canal se cerró: el broker reentregará el mensaje.
      this.logger.warn({ err }, 'No se pudo confirmar el mensaje (canal cerrado)');
    }
  }

  /** Deja de recibir mensajes y espera a que terminen los que están en curso. */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled([...this.activeConsumers.values()].map(({ ch, consumerTag }) => ch.cancel(consumerTag)));
    await Promise.allSettled([...this.inFlight]);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.consumers.map((c) => c.close()), this.publisher.close()]);
    await this.connection.close();
    this.logger.log('Conexión a RabbitMQ cerrada');
  }
}
