# Validador Documental

Plataforma para subir documentos (PDF con texto, PDF escaneado o imágenes) y validarlos de forma asíncrona:
- identifica el tipo de documento según un template y extrae sus datos a JSON;
- verifica vigencia y totales (facturas y órdenes de compra);
- estima el riesgo de falsificación.

El usuario sigue trabajando y recibe una notificación en vivo cuando cada documento termina.

Está armada como **piezas de lego**: cuatro microservicios independientes que solo se conocen a través de contratos, y que se pueden usar solos, reemplazar o combinar de otra forma. Ver [docs/piezas-lego.md](docs/piezas-lego.md).

```
[web React] --HTTP/SSE--> [bff NestJS] --HTTP stream--> [documents-service NestJS] --outbox--> RabbitMQ --> [doc-validator Python]
                               ^                              Postgres + Blob        ^                       Tesseract + reglas + Claude
                               +---- fanout notifications ----+                      +---- resultados -------+
```

| Pieza | Responsabilidad | Puerto local | Docs |
|---|---|---|---|
| `apps/web` | Playground: subir, estado en vivo, resultado por documento | 5173 | [README](apps/web/README.md) |
| `services/bff` | API de la UI y notificaciones SSE. Sin estado | 3000 | [README](services/bff/README.md) |
| `services/documents-service` | Dueño del documento: Blob, Postgres (JSONB), outbox, resultados | 3100 (interno) | [README](services/documents-service/README.md) |
| `services/doc-validator` | Core: OCR, clasificación y extracción por template, reglas, autenticidad; Claude como respaldo | 8000 (health/metrics) | [README](services/doc-validator/README.md) |

## Documentación

| Documento | Contenido |
|---|---|
| [docs/piezas-lego.md](docs/piezas-lego.md) | Ficha de cada pieza (entradas, salidas, dependencias), combinaciones posibles, reglas para mantenerlas independientes y brechas |
| [docs/arquitectura.md](docs/arquitectura.md) | Flujo completo, pipeline del validador, señales de autenticidad, tipos, datos, mensajería, IA y despliegue |
| [docs/operacion.md](docs/operacion.md) | Levantar, tareas habituales, consultas, observabilidad, diagnóstico de problemas conocidos y despliegue en AKS |
| [docs/historial.md](docs/historial.md) | Qué se construyó, decisiones, hallazgos con documentos reales y pendientes |
| [contracts/](contracts/README.md) | Contratos entre piezas: eventos (CloudEvents + JSON Schema), topología RabbitMQ y API HTTP |
| [docs/adr/](docs/adr/) | Decisiones de arquitectura (Postgres + JSONB, RabbitMQ + outbox, BFF sin estado, SSE, OCR primero e IA de respaldo) |

## Levantar

```bash
cp .env.example .env          # pegar ANTHROPIC_API_KEY en .env (opcional; nunca en .env.example)
docker compose up -d --build
open http://localhost:5173
```

Sin `ANTHROPIC_API_KEY`, todo funciona solo con reglas. Documentos de ejemplo en `services/doc-validator/tests/fixtures/`. Más comandos en [docs/operacion.md](docs/operacion.md).

## Tipos de documento

| Tipo | Qué valida |
|---|---|
| `factura_sii` | RUTs, neto + IVA 19 % = total, suma de líneas |
| `orden_compra` | RUTs, neto + IVA = total, suma de líneas |
| `certificado_vigencia` | Vigencia por fecha de vencimiento o días de validez |
| `cedula_identidad` | RUN y fecha de vencimiento |
| `contrato` | RUTs de las partes y vigencia si tiene fecha de término |
| `certificado_accidentabilidad` | Identificación y extracción (Mutual de Seguridad, ACHS, IST, ISL) |
| `carpeta_tributaria` | Identificación y extracción (SII) |
| `certificado_f30` | Identificación y extracción (F30 / F30-1). Patrones aún sin probar con documentos reales |

### Agregar un tipo

1. **Template y schema:** crear `services/doc-validator/templates/<tipo>.yaml` y `services/doc-validator/src/validator/schemas/<tipo>.py`. Agregar un texto de ejemplo **anonimizado** en `tests/fixtures/texts/` con su test. Ver el [README del validador](services/doc-validator/README.md).
2. **Lista de tipos en los demás servicios:**
   - `contracts/`: enums de `validation-result` y `doc.validation.requested`
   - `doc-validator/src/validator/messaging/cloudevents.py`
   - `documents-service/src/documents/document.types.ts`
   - `bff/src/documents/document-types.ts` (con su etiqueta)
   - `apps/web/src/api/types.ts` y `src/lib/format.ts`

El paso 2 es una brecha conocida (ver [piezas-lego.md](docs/piezas-lego.md#brechas-lo-que-falta-para-que-sean-piezas-100--intercambiables)).

## Resultado

Cada documento termina con un veredicto:
- `VALID`: pasó todas las reglas y no hay señales de riesgo.
- `INVALID`: falló una regla de severidad error (totales, vigencia, RUT, campo obligatorio).
- `REVIEW`: requiere revisión humana (riesgo de falsificación medio o alto, tipo desconocido u OCR de baja confianza).

Cada campo extraído indica su origen (`text`, `ocr` o `llm`) y su confianza. `llmCalls` lista cada llamada a Claude con su propósito, tokens y tiempo.

| Claude se llama solo para… | Cuándo |
|---|---|
| Clasificar | Las reglas reconocen el tipo con menos de 60 % de confianza |
| Completar campos | Falta un campo obligatorio o se leyó con poca confianza |
| Revisión visual | Ya hay una señal de riesgo de falsificación con peso |

La detección de falsificación es una **estimación de riesgo por señales**, no una prueba. La validación de firma aún no está implementada (`NOT_IMPLEMENTED`).

## Tests

```bash
cd services/doc-validator && uv sync && uv run pytest         # o .venv + pytest; los de OCR requieren tesseract spa
cd services/documents-service && pnpm test && pnpm test:e2e   # e2e con Testcontainers (Docker)
cd services/bff && pnpm test
cd apps/web && pnpm test
for c in web bff documents-service doc-validator; do helm lint deploy/helm/$c; done
```
