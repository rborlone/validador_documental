# Contratos HTTP

Todas las respuestas son JSON salvo las de contenido de archivo y SSE. Fechas en ISO 8601 UTC. Los errores siguen RFC 9457 (`application/problem+json`: `type`, `title`, `status`, `detail`).
Todos los servicios aceptan y propagan `x-correlation-id`; si no viene, el BFF lo genera.

## Modelos

```ts
type DocumentStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
type Verdict = 'VALID' | 'INVALID' | 'REVIEW';

interface DocumentSummary {
  id: string;               // uuid
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: DocumentStatus;
  expectedType: string | null;
  documentType: string | null; // result.documentType.value cuando existe
  verdict: Verdict | null;     // result.verdict cuando existe
  createdAt: string;
  updatedAt: string;
}

interface DocumentDetail extends DocumentSummary {
  attempts: number;
  result: ValidationResult | null;           // ver validation-result.schema.json
  error: { code: string; message: string } | null;
}
```

## BFF — API pública para la UI (puerto 3000, prefijo `/api`)

| Método | Ruta | Respuesta |
|---|---|---|
| `POST` | `/api/documents` | multipart: campo `files` (1..10 archivos, máx. 20 MB c/u, PDF/PNG/JPEG/TIFF), campo opcional `expectedType`. → `202 { documents: DocumentSummary[] }` |
| `GET` | `/api/documents?limit=50` | `200 { items: DocumentSummary[] }` (más recientes primero) |
| `GET` | `/api/documents/:id` | `200 DocumentDetail` · `404` |
| `GET` | `/api/documents/:id/content` | `200` binario del archivo con su `content-type` (para la vista previa) |
| `GET` | `/api/document-types` | `200 { items: { id: string; label: string }[] }` |
| `GET` | `/api/events` | SSE. Evento `document.updated` con `data` = `doc.status.changed.data`. Comentario `: ping` cada 25 s. |
| `GET` | `/health/live`, `/health/ready` | probes |

## documents-service — API interna (puerto 3100, sin prefijo, solo dentro del clúster)

| Método | Ruta | Respuesta |
|---|---|---|
| `POST` | `/documents` | igual que `POST /api/documents` del BFF (el BFF reenvía el multipart en streaming) |
| `GET` | `/documents?limit=50` | `200 { items: DocumentSummary[] }` |
| `GET` | `/documents/:id` | `200 DocumentDetail` · `404` |
| `GET` | `/documents/:id/content` | stream del blob |
| `GET` | `/health/live`, `/health/ready` | probes (ready verifica Postgres y RabbitMQ) |
