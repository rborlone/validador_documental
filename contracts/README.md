# Contratos

Fuente de verdad de la comunicación entre servicios. Cualquier cambio aquí es un cambio de contrato: se versiona y se coordina entre los servicios afectados.

## Estados del documento

`QUEUED` → `PROCESSING` → `COMPLETED` | `FAILED`

Un estado nunca retrocede: un evento `started` que llega después de `completed` se ignora.

## Topología RabbitMQ

| Recurso | Tipo | Declarado por | Notas |
|---|---|---|---|
| `documents` | exchange topic, durable | todos los que publican/consumen en él | eventos de dominio |
| `notifications` | exchange fanout, durable | documents-service y bff | cambios de estado para la UI |
| `doc-validator.requests` | cola quorum | doc-validator | binding `documents` / `doc.validation.requested` |
| `doc-validator.requests.retry` | cola quorum, `x-message-ttl=10000`, `x-dead-letter-exchange=documents`, `x-dead-letter-routing-key=doc.validation.requested` | doc-validator | espera antes de reintentar |
| `doc-validator.requests.dlq` | cola quorum | doc-validator | mensajes que agotaron los reintentos |
| `documents-service.results` | cola quorum | documents-service | bindings `doc.validation.started`, `doc.validation.completed`, `doc.validation.failed` |
| `bff.notifications.<instancia>` | cola exclusiva, auto-delete | bff (cada réplica) | binding a `notifications` |

Todos los mensajes son JSON en **CloudEvents 1.0 (modo estructurado)**, `content_type=application/cloudevents+json`, `delivery_mode=2` (persistente). La propiedad AMQP `correlation_id` y el atributo `correlationid` llevan el mismo valor, que se origina en el request HTTP (`x-correlation-id`).

Reintentos: el doc-validator incrementa `data.attempt` y republica en la cola `retry`. Con `attempt >= MAX_ATTEMPTS` (por defecto 3) envía el mensaje original a la DLQ y publica `doc.validation.failed`.

## Eventos

| `type` | Productor | Esquema |
|---|---|---|
| `doc.validation.requested` | documents-service (vía outbox) | [events/doc.validation.requested.schema.json](events/doc.validation.requested.schema.json) |
| `doc.validation.started` | doc-validator | [events/doc.validation.started.schema.json](events/doc.validation.started.schema.json) |
| `doc.validation.completed` | doc-validator | [events/doc.validation.completed.schema.json](events/doc.validation.completed.schema.json) |
| `doc.validation.failed` | doc-validator | [events/doc.validation.failed.schema.json](events/doc.validation.failed.schema.json) |
| `doc.status.changed` | documents-service | [events/doc.status.changed.schema.json](events/doc.status.changed.schema.json) |

El resultado de la validación tiene su propio esquema: [validation-result.schema.json](validation-result.schema.json).

## Tipos de documento

`factura_sii`, `orden_compra`, `certificado_vigencia`, `cedula_identidad`, `contrato`, `certificado_accidentabilidad`, `carpeta_tributaria`, `certificado_f30`, `desconocido`.

Agregar un tipo requiere: template YAML + schema en doc-validator y ampliar esta lista en todos los servicios (ver la sección "Agregar un tipo" del README raíz).
