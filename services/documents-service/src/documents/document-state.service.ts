import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Document } from '@prisma/client';
import { cloudEvent } from '../messaging/cloud-event';
import { EXCHANGE_NOTIFICATIONS, TYPE_STATUS_CHANGED } from '../messaging/topology';
import { outboxRow } from '../outbox/outbox';
import { PrismaService } from '../prisma/prisma.service';
import { toStatusChanged } from './document.mapper';
import type { DocumentStatus } from './document.types';
import { decideTransition, ResultEvent } from './status-transition';

export type ApplyOutcome =
  | { outcome: 'applied'; document: Document }
  | { outcome: 'ignored'; status: DocumentStatus }
  | { outcome: 'not_found' };

/**
 * Aplica eventos de resultado sobre un documento.
 * La fila se bloquea (`FOR UPDATE`) para serializar eventos concurrentes del mismo documento
 * (consumidores en competencia / varias réplicas). La notificación `doc.status.changed` se
 * escribe en el outbox dentro de la misma transacción, así nunca se pierde ni se adelanta.
 */
@Injectable()
export class DocumentStateService {
  constructor(private readonly prisma: PrismaService) {}

  apply(event: ResultEvent, correlationId: string | null): Promise<ApplyOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: DocumentStatus; attempts: number; correlation_id: string | null }[]>(
        Prisma.sql`SELECT status, attempts, correlation_id FROM documents WHERE id = ${event.documentId}::uuid FOR UPDATE`,
      );
      const current = rows[0];
      if (!current) return { outcome: 'not_found' };

      const patch = decideTransition(current, event);
      if (!patch) return { outcome: 'ignored', status: current.status };

      const document = await tx.document.update({
        where: { id: event.documentId },
        data: {
          status: patch.status,
          attempts: patch.attempts,
          result: patch.result === undefined ? undefined : (patch.result as Prisma.InputJsonValue),
          verdict: patch.verdict,
          documentType: patch.documentType,
          error: patch.error === undefined ? undefined : patch.error === null ? Prisma.DbNull : patch.error,
        },
      });

      const corr = correlationId ?? current.correlation_id ?? document.id;
      await tx.outboxMessage.create({
        data: outboxRow(cloudEvent(TYPE_STATUS_CHANGED, toStatusChanged(document), corr), EXCHANGE_NOTIFICATIONS, TYPE_STATUS_CHANGED),
      });
      return { outcome: 'applied', document };
    });
  }
}
