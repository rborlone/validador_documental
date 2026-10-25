# Piezas de lego

Cada microservicio es una pieza con **una sola responsabilidad**, un **contrato público** (HTTP o eventos) y **sin dependencias de código** con las demás. Las piezas se conectan solo a través de los contratos de [`contracts/`](../contracts/README.md). Se puede usar una pieza sola, reemplazarla o combinarla de otra forma sin tocar las demás, siempre que se respete el contrato.

```mermaid
flowchart LR
    subgraph UI["Pieza 4 · web"]
        W[React playground]
    end
    subgraph BFF["Pieza 3 · bff"]
        B[API de la UI + SSE]
    end
    subgraph DOC["Pieza 2 · documents-service"]
        D[Dominio documento]
        PG[(Postgres)]
        BL[(Blob)]
    end
    subgraph VAL["Pieza 1 · doc-validator"]
        V[OCR + reglas + Claude]
    end
    MQ{{RabbitMQ}}

    W -- "HTTP /api/*  ·  SSE" --> B
    B -- "HTTP /documents" --> D
    D --- PG
    D --- BL
    D -- "doc.validation.requested" --> MQ
    MQ -- "doc.validation.requested" --> V
    V -- "lee el archivo" --> BL
    V -- "started / completed / failed" --> MQ
    MQ -- "resultados" --> D
    D -- "doc.status.changed (fanout)" --> MQ
    MQ -- "notifications" --> B
```

## Fichas de cada pieza

### Pieza 1 · doc-validator (el core)

| | |
|---|---|
| **Hace** | Recibe la referencia a un archivo, lo valida y devuelve un JSON con tipo, campos, checks, autenticidad, veredicto y uso de IA. |
| **No hace** | No guarda estado ni tiene base de datos ni API de negocio. |
| **Entrada** | Evento `doc.validation.requested` en la cola `doc-validator.requests` ([esquema](../contracts/events/doc.validation.requested.schema.json)) + el archivo en Azure Blob. |
| **Salida** | Eventos `doc.validation.started`, `doc.validation.completed` (con [`ValidationResult`](../contracts/validation-result.schema.json)) y `doc.validation.failed` en el exchange `documents`. |
| **Necesita** | RabbitMQ, Azure Blob (lectura). Opcional: `ANTHROPIC_API_KEY`. |
| **Escala** | Horizontal, con KEDA según el largo de la cola. |
| **Se extiende con** | Templates YAML + schemas pydantic (nuevos tipos de documento), `LLMProvider` (otro proveedor de IA), `SignatureVerifier` (firma, pendiente). |
| **Detalle** | [services/doc-validator/README.md](../services/doc-validator/README.md) |

### Pieza 2 · documents-service (dueño del documento)

| | |
|---|---|
| **Hace** | Recibe archivos, los guarda en Blob, registra el documento en Postgres, pide la validación (outbox), guarda el resultado y avisa cada cambio de estado. |
| **No hace** | No valida documentos ni conoce la UI. |
| **Entrada** | HTTP `POST /documents` (multipart) · eventos `doc.validation.*` en la cola `documents-service.results`. |
| **Salida** | HTTP `GET /documents`, `/documents/:id`, `/documents/:id/content` ([contrato](../contracts/http.md), OpenAPI en `/docs-json`) · eventos `doc.validation.requested` y `doc.status.changed`. |
| **Necesita** | Postgres, RabbitMQ, Azure Blob (lectura y escritura). |
| **Detalle** | [services/documents-service/README.md](../services/documents-service/README.md) |

### Pieza 3 · bff (puente para la UI)

| | |
|---|---|
| **Hace** | Expone la API que necesita la UI, reenvía las subidas en streaming, agrega respuestas y entrega notificaciones en vivo (SSE). |
| **No hace** | No tiene estado ni base de datos ni acceso a Blob. |
| **Entrada** | HTTP `/api/*` desde el navegador · eventos `doc.status.changed` (cola exclusiva por réplica). |
| **Salida** | HTTP hacia documents-service · SSE `document.updated` hacia el navegador. |
| **Necesita** | documents-service, RabbitMQ. |
| **Detalle** | [services/bff/README.md](../services/bff/README.md) |

### Pieza 4 · web (playground)

| | |
|---|---|
| **Hace** | Sube documentos, muestra el estado en vivo y el resultado por documento (campos, checks, autenticidad, uso de IA, JSON). |
| **Entrada / salida** | Solo la API del BFF (`VITE_API_URL`). |
| **Corre sola** | `pnpm dev:mock` levanta una API simulada; no necesita backend. |
| **Detalle** | [apps/web/README.md](../apps/web/README.md) |

## Combinaciones

| Combinación | Piezas | Para qué | Cómo se conecta |
|---|---|---|---|
| **A. Plataforma completa** | 1 + 2 + 3 + 4 | El playground actual. | `docker compose up` |
| **B. Servicio de validación para otro sistema** | 1 + 2 | Otro sistema sube archivos y consulta resultados por HTTP. | `POST /documents` y `GET /documents/:id` de documents-service. Para enterarse de que terminó: consultar el estado o escuchar `doc.status.changed`. Requiere exponerlo con autenticación (ver *Brechas*). |
| **C. Solo el motor** | 1 | Un sistema que ya tiene su almacenamiento y base de datos y solo quiere validar. | Dejar el archivo en Blob, publicar `doc.validation.requested` en el exchange `documents` y consumir `doc.validation.completed`/`failed`. |
| **D. Otra interfaz** | 1 + 2 + 3 + UI propia | Otra UI (móvil, intranet) sobre el mismo backend. | Implementar contra [`contracts/http.md`](../contracts/http.md) (sección BFF). |
| **E. Desarrollo de UI** | 4 | Trabajar en el front sin backend. | `pnpm dev:mock` |

### Ejemplo: combinación C (solo el motor) desde Python

```python
import json, uuid, datetime, pika

doc_id = str(uuid.uuid4())
event = {
    "specversion": "1.0", "id": str(uuid.uuid4()), "source": "/mi-sistema",
    "type": "doc.validation.requested", "time": datetime.datetime.now(datetime.UTC).isoformat(),
    "datacontenttype": "application/json", "correlationid": doc_id,
    "data": {"documentId": doc_id, "container": "documents", "blobName": "2026/10/24/mi-archivo.pdf",
             "contentType": "application/pdf", "filename": "mi-archivo.pdf", "expectedType": None, "attempt": 1},
}
channel = pika.BlockingConnection(pika.URLParameters("amqp://validador:validador@localhost:5672")).channel()
channel.basic_publish(
    exchange="documents", routing_key="doc.validation.requested", body=json.dumps(event),
    properties=pika.BasicProperties(content_type="application/cloudevents+json", delivery_mode=2,
                                    correlation_id=doc_id),
)
# El resultado llega como doc.validation.completed al exchange "documents":
# declarar una cola propia con binding "doc.validation.completed" y "doc.validation.failed".
```

El validador solo acepta el contenedor configurado en `BLOB_CONTAINER`.

## Reglas para que sigan siendo piezas

1. **Nada de código compartido entre servicios.** Lo único compartido son los contratos (JSON Schema y Markdown).
2. **Cada pieza es dueña de sus datos.** Solo documents-service toca Postgres; nadie más lee sus tablas.
3. **Un cambio de contrato es versionado y coordinado.** Agregar campos opcionales es compatible; quitar o renombrar no.
4. **Cada pieza declara la topología que consume** (colas y bindings) de forma idempotente.
5. **Cada pieza se configura solo por variables de entorno**, se despliega con su propio chart y escala por separado.
6. **Toda pieza degrada con elegancia:** el validador funciona sin IA, la UI tiene polling si cae el SSE y el outbox reintenta si RabbitMQ no está.

## Brechas (lo que falta para que sean piezas 100 % intercambiables)

| Brecha | Impacto | Propuesta |
|---|---|---|
| La lista de tipos de documento está repetida en 7 archivos de 5 servicios. | Agregar un tipo obliga a tocar todas las piezas. | El validador publica su catálogo de tipos (evento o endpoint) y las demás piezas lo leen. |
| documents-service no tiene autenticación ni separación por cliente. | No se puede exponer a otros sistemas (combinación B). | Azure API Management + Entra ID (client credentials) + columna de tenant. |
| No hay webhooks. | Un sistema externo debe consultar el estado o conectarse a RabbitMQ. | Registro de URL de callback por cliente; documents-service la llama al terminar. |
| El validador depende de Azure Blob para leer el archivo. | La combinación C exige usar Blob. | Interfaz de almacenamiento con adaptadores (Blob, S3, URL firmada). |
| El texto completo del documento no se guarda. | Reprocesar exige repetir el OCR; no se puede buscar en el contenido. | Guardar un `.md` por documento en Blob (propuesta pendiente de decisión). |
