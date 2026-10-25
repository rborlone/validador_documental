import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import { AppConfig } from '../config/app-config';
import { AmqpService, HandlerOutcome, messageIdOf } from '../messaging/amqp.service';
import { assertResultsQueue, QUEUE_RESULTS } from '../messaging/topology';
import { OutboxRelayService } from '../outbox/outbox-relay.service';
import { DocumentStateService } from './document-state.service';
import { InvalidMessageError, parseResultMessage } from './result-event.parser';

/**
 * Consume `documents-service.results` (started / completed / failed).
 * - Mensaje inválido → se descarta (reject sin reencolar) y se registra.
 * - Documento inexistente o evento duplicado/atrasado → ack (idempotente).
 * - Error transitorio (BD) → se reencola con pausa. En RabbitMQ 4 las colas quorum tienen
 *   delivery-limit por defecto, así que un mensaje venenoso no queda en bucle infinito.
 */
@Injectable()
export class ResultsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(ResultsConsumer.name);

  constructor(
    private readonly amqp: AmqpService,
    private readonly state: DocumentStateService,
    private readonly relay: OutboxRelayService,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.amqp.consume('results-consumer', QUEUE_RESULTS, this.config.get('RESULTS_PREFETCH'), assertResultsQueue, (msg) =>
      this.handle(msg),
    );
  }

  async handle(msg: ConsumeMessage): Promise<HandlerOutcome> {
    const rawCorrelation: unknown = msg.properties.correlationId;
    const amqpCorrelation = typeof rawCorrelation === 'string' ? rawCorrelation : undefined;
    let parsed;
    try {
      parsed = parseResultMessage(msg.content, amqpCorrelation);
    } catch (err) {
      if (err instanceof InvalidMessageError) {
        this.logger.error(
          { routingKey: msg.fields.routingKey, messageId: messageIdOf(msg), correlationId: amqpCorrelation, error: err.message },
          'Mensaje de resultado inválido; se descarta',
        );
        return 'reject';
      }
      throw err;
    }

    const { event, correlationId, eventId } = parsed;
    const ctx = { correlationId, eventId, documentId: event.documentId, eventKind: event.kind };
    try {
      const res = await this.state.apply(event, correlationId);
      if (res.outcome === 'applied') {
        this.logger.log({ ...ctx, status: res.document.status }, `Documento actualizado a ${res.document.status}`);
        this.relay.kick();
      } else if (res.outcome === 'ignored') {
        this.logger.log({ ...ctx, status: res.status }, 'Evento duplicado o atrasado; se ignora (el estado no retrocede)');
      } else {
        this.logger.warn(ctx, 'Evento para un documento inexistente; se descarta');
      }
      return 'ack';
    } catch (err) {
      this.logger.error({ ...ctx, err }, 'Error aplicando el evento; se reintentará');
      return 'requeue';
    }
  }
}
