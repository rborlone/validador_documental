# documents-service

Dueño del dominio **documento**: guarda el archivo en Azure Blob, registra el documento en Postgres, pide la validación por RabbitMQ (outbox transaccional), guarda el resultado y publica cada cambio de estado. Su API es interna: en AKS solo el BFF puede llamarlo (NetworkPolicy).

Pieza 2 de [docs/piezas-lego.md](../../docs/piezas-lego.md).

## Contrato

| Método | Ruta | Respuesta |
|---|---|---|
| `POST` | `/documents` | multipart: `files` (1..`MAX_FILES`, máx `MAX_FILE_SIZE_MB` c/u, PDF/PNG/JPEG/TIFF por magic bytes) y `expectedType` opcional → `202 { documents: DocumentSummary[] }` |
| `GET` | `/documents?limit=50` | `{ items: DocumentSummary[] }`, más recientes primero |
| `GET` | `/documents/:id` | `DocumentDetail` (incluye `result`) · `404` · `400` si el id no es UUID |
| `GET` | `/documents/:id/content` | stream del archivo |
| `GET` | `/health/live`, `/health/ready` | ready verifica Postgres y RabbitMQ |
| `GET` | `/docs`, `/docs-json` | Swagger UI y OpenAPI |

- **Errores:** RFC 9457 (`application/problem+json`).
- **Correlación:** acepta y propaga `x-correlation-id`.
- **Modelos:** en [contracts/http.md](../../contracts/http.md).

**Eventos:**
- **Publica** (vía outbox): `doc.validation.requested` en el exchange `documents`, y `doc.status.changed` en el fanout `notifications`.
- **Consume:** `doc.validation.started`, `completed` y `failed` desde la cola quorum `documents-service.results`.
- **Consumidor idempotente:**
  - Los estados nunca retroceden.
  - Los duplicados se ignoran.
  - Un mensaje inválido se descarta sin reencolar.
  - Ante un error de base de datos, el mensaje se reencola tras 1 s.

## Datos

Prisma 6 (`prisma/schema.prisma`). Las migraciones están en `prisma/migrations/` y se aplican al arrancar con `prisma migrate deploy`, que usa un advisory lock y es seguro con varias réplicas. En AKS se puede pasar a un Job con `RUN_MIGRATIONS=false`.

- `documents`: archivo (`container`, `blob_name`, `size_bytes`, `content_type`), `status`, `expected_type`, `document_type` y `verdict` desnormalizados, `result` y `error` (JSONB), `attempts` y `correlation_id`.
- `outbox`: `exchange`, `routing_key`, `payload`, `next_attempt_at`, `published_at`, `attempts` y `last_error`. El relay publica con `FOR UPDATE SKIP LOCKED`, publisher confirms y `mandatory` (si no hay cola de destino, reintenta con backoff hasta 30 s).

## Variables de entorno

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | — | obligatoria |
| `RABBITMQ_URL` | — | obligatoria |
| `AZURE_STORAGE_CONNECTION_STRING` | — | obligatoria |
| `BLOB_CONTAINER` | `documents` | se crea si no existe |
| `PORT` | `3100` | |
| `MAX_FILE_SIZE_MB` / `MAX_FILES` | `20` / `10` | |
| `RESULTS_PREFETCH` | `10` | |
| `OUTBOX_INTERVAL_MS` / `OUTBOX_BATCH_SIZE` | `500` / `50` | |
| `PUBLISH_TIMEOUT_MS` | `5000` | |
| `LOG_LEVEL` | `info` | logs JSON (pino) con `correlationId` |
| `RUN_MIGRATIONS` | `true` | entrypoint del contenedor |

Se validan con zod al arrancar (`src/config/env.ts`).

## Desarrollo

```bash
pnpm install
pnpm build && pnpm lint && pnpm test   # unit (Jest)
pnpm test:e2e                          # Testcontainers: Postgres + RabbitMQ + Azurite (requiere Docker)
```

Para usarlo solo (sin BFF ni UI): `docker compose up -d postgres rabbitmq azurite documents-service` y llamar a `http://localhost:3100`.
