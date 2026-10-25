# bff

Backend for Frontend del playground. **No tiene estado**: no tiene base de datos ni accede a Blob. Expone la API que necesita la UI, reenvía las subidas en streaming a documents-service y entrega las notificaciones en vivo por SSE.

Pieza 3 de [docs/piezas-lego.md](../../docs/piezas-lego.md). Otros sistemas no deberían integrarse a través del BFF: su API está pensada para la UI. Para integraciones, usar documents-service (combinación B) o el validador (combinación C).

## Contrato (prefijo `/api`)

| Método | Ruta | |
|---|---|---|
| `POST` | `/api/documents` | Reenvía el multipart en streaming a documents-service (no lo parsea ni lo guarda) |
| `GET` | `/api/documents`, `/api/documents/:id` | Reenvía con timeout y reintentos (solo GET) |
| `GET` | `/api/documents/:id/content` | Stream del archivo. Única ruta que permite iframe (`frame-ancestors` = `CORS_ORIGIN`) |
| `GET` | `/api/document-types` | Lista de tipos con su etiqueta en español (`src/documents/document-types.ts`) |
| `GET` | `/api/events` | SSE: evento `document.updated` con `doc.status.changed.data` y `: ping` cada `SSE_PING_MS` |
| `GET` | `/health/live`, `/health/ready` | ready verifica solo RabbitMQ (para no caer en cascada si documents-service falla) |

**Notificaciones con varias réplicas:** cada réplica declara una cola exclusiva auto-delete atada al fanout `notifications` y reenvía a sus clientes conectados.

**Seguridad:** helmet, CORS (`CORS_ORIGIN`), rate limit (`RATE_LIMIT_PER_MINUTE`) y límite de tamaño por `content-length`. Hay un guard de autenticación preparado pero deshabilitado (`AUTH_ENABLED=false`), que se conectará a Entra ID más adelante.

## Variables de entorno

| Variable | Default | |
|---|---|---|
| `DOCUMENTS_SERVICE_URL` | — | obligatoria |
| `RABBITMQ_URL` | — | obligatoria |
| `CORS_ORIGIN` | — | obligatoria, lista separada por comas |
| `PORT` | `3000` | |
| `MAX_FILE_SIZE_MB` / `MAX_FILES` | `20` / `10` | |
| `UPSTREAM_TIMEOUT_MS` / `UPLOAD_TIMEOUT_MS` | `5000` / `120000` | |
| `UPSTREAM_RETRIES` | `2` | solo GET |
| `RATE_LIMIT_PER_MINUTE` | `300` | |
| `SSE_PING_MS` | `25000` | |
| `AUTH_ENABLED` / `TRUST_PROXY` | `false` | |
| `INSTANCE_ID` | hostname + sufijo aleatorio | nombre de la cola de notificaciones |

## Desarrollo

```bash
pnpm install
pnpm build && pnpm lint && pnpm test
```
