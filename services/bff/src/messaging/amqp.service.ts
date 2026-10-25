import { Injectable, Logger, OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import amqp, { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { AppConfig } from '../config/app-config';

/**
 * Conexión AMQP con reconexión automática (amqp-connection-manager sobre amqplib).
 * Las funciones de setup (topología + consumidor) se re-ejecutan en cada reconexión.
 */
@Injectable()
export class AmqpService implements OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger(AmqpService.name);
  private readonly connection: AmqpConnectionManager;
  private readonly channels: ChannelWrapper[] = [];
  private readonly active = new Map<string, { ch: ConfirmChannel; consumerTag: string }>();

  constructor(config: AppConfig) {
    this.connection = amqp.connect([config.get('RABBITMQ_URL')], {
      heartbeatIntervalInSeconds: 15,
      reconnectTimeInSeconds: 5,
      connectionOptions: { clientProperties: { connection_name: 'bff' } },
    });
    this.connection.on('connect', () => this.logger.log('Conectado a RabbitMQ'));
    this.connection.on('disconnect', ({ err }) => this.logger.warn({ err }, 'Desconectado de RabbitMQ; se reintentará la conexión'));
    this.connection.on('connectFailed', ({ err }) => this.logger.warn({ err }, 'No se pudo conectar a RabbitMQ; se reintentará'));
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  /**
   * Declara la cola con `declare` y consume con `handler`. El handler es síncrono y rápido:
   * el mensaje se confirma siempre (las notificaciones son efímeras; reintentar no aporta).
   */
  consume(
    name: string,
    prefetch: number,
    declare: (ch: ConfirmChannel) => Promise<string>,
    handler: (msg: ConsumeMessage) => void,
  ): void {
    const wrapper = this.connection.createChannel({
      name,
      json: false,
      confirm: false,
      setup: async (ch: ConfirmChannel) => {
        const queue = await declare(ch);
        await ch.prefetch(prefetch);
        const { consumerTag } = await ch.consume(queue, (msg) => {
          if (!msg) return;
          try {
            handler(msg);
          } catch (err) {
            this.logger.error({ err }, 'Error procesando la notificación');
          }
          try {
            ch.ack(msg);
          } catch {
            // Canal cerrado: la cola exclusiva desaparece con él, no hay nada que reentregar.
          }
        });
        this.active.set(name, { ch, consumerTag });
        this.logger.log(`Consumiendo la cola "${queue}"`);
      },
    });
    this.channels.push(wrapper);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map(({ ch, consumerTag }) => ch.cancel(consumerTag)));
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.channels.map((c) => c.close()));
    await this.connection.close();
    this.logger.log('Conexión a RabbitMQ cerrada');
  }
}
