import { randomUUID } from 'node:crypto';

export const CLOUDEVENTS_CONTENT_TYPE = 'application/cloudevents+json';
export const EVENT_SOURCE = '/documents-service';

/** CloudEvents 1.0 en modo estructurado (ver contracts/events). */
export interface CloudEvent<T> {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  time: string;
  datacontenttype: 'application/json';
  correlationid: string;
  data: T;
}

export function cloudEvent<T>(type: string, data: T, correlationId: string): CloudEvent<T> {
  return {
    specversion: '1.0',
    id: randomUUID(),
    source: EVENT_SOURCE,
    type,
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    correlationid: correlationId,
    data,
  };
}
