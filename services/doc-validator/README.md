# doc-validator

Worker Python sin estado que valida documentos. Consume `doc.validation.requested` desde RabbitMQ,
descarga el archivo desde Azure Blob Storage, ejecuta el pipeline y publica
`doc.validation.started` / `completed` / `failed` (CloudEvents, ver `contracts/`).

```
ingest → pdf_inspector → ocr → classifier → extractor → rules → authenticity → signature → result
```

| Paso | Qué hace |
|---|---|
| `ingest` | Tamaño máximo y tipo real por magic bytes (PDF, PNG, JPEG, TIFF). |
| `pdf_inspector` | PyMuPDF: capa de texto (solo lo visible), rasterizado a 300 dpi si falta texto, metadatos y hechos forenses. |
| `ocr` | OpenCV (enderezado, mediana, binarización adaptativa) + Tesseract `spa+eng`. |
| `classifier` | Palabras clave del template con puntaje; si la confianza es baja y hay LLM, Claude. |
| `extractor` | Regex/anclas del template; los obligatorios faltantes se piden a Claude con el schema pydantic. |
| `rules` | RUT módulo 11, fechas, vigencia y totales (Σ líneas = neto, IVA 19 % ±1, neto + IVA + exento = total). |
| `authenticity` | Señales heurísticas combinadas en un puntaje 0–1 (`LOW`/`MEDIUM`/`HIGH`). |
| `signature` | Punto de extensión; hoy `NOT_IMPLEMENTED`. |

Sin `ANTHROPIC_API_KEY` o con `LLM_ENABLED=false` todo funciona solo con reglas.

## Desarrollo local

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e . httpx jsonschema pytest pytest-asyncio reportlab ruff   # o: uv sync
.venv/bin/ruff check src tests
.venv/bin/pytest
.venv/bin/python tests/fixtures/generate.py   # regenera los documentos de prueba
```

Los tests de OCR se omiten si Tesseract no tiene el idioma `spa`.

Variables principales: `RABBITMQ_URL`, `AZURE_STORAGE_CONNECTION_STRING` (o `AZURE_STORAGE_ACCOUNT_URL`
con Workload Identity), `BLOB_CONTAINER`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (default `claude-sonnet-5-5`),
`LLM_ENABLED`, `LLM_VISUAL_REVIEW` (`always|on_signals|never`), `MAX_ATTEMPTS`, `PREFETCH`, `MAX_PAGES`,
`OCR_LANG`, `HEALTH_PORT`, `LOG_LEVEL`. Ver `src/validator/config.py`.

Operación: `GET /health/live`, `GET /health/ready` (conexión AMQP y consumidor activos) y `GET /metrics`
en `HEALTH_PORT`. Con `SIGTERM` deja de consumir, termina el mensaje en curso y cierra.

## Agregar un tipo de documento

1. Crear `src/validator/schemas/<tipo>.py` con una clase `Schema` (pydantic) cuyos campos son los datos a
   extraer. Se usa para la salida estructurada de Claude y para validarla.
2. Crear `templates/<tipo>.yaml`:

   ```yaml
   id: boleta_honorarios          # snake_case, único
   version: "1.0.0"               # subir al cambiar reglas o patrones
   name: Boleta de honorarios
   schema: boleta_honorarios      # módulo de validator.schemas
   classification:
     description: Texto que también lee Claude para clasificar.
     keywords:
       - { pattern: 'boleta\s+de\s+honorarios', weight: 5 }
       - { pattern: 'retenci[oó]n', weight: 1 }
   fields:
     - name: rut_emisor
       type: rut                  # string | rut | date | amount | integer | lines
       required: true
       patterns: ['R\.?U\.?T\.?[ \t]*:?[ \t]*(?P<value><<RUT>>)']
   rules:
     - { id: rut.emisor, type: rut, field: rut_emisor }
   ```

   Macros en las regex:
   - `<<RUT>>`: con o sin puntos.
   - `<<DATE>>`: dd-mm-aaaa, "15 de marzo de 2026", "07-AGO-2026", "28 del 08 del 2025"…
   - `<<AMOUNT>>`: $1.234.567, $58,816.00; nunca toma un porcentaje.
   - `<<INT>>`
   - `<<SEP>>`: separador etiqueta-valor; admite el valor en la línea siguiente.

   Se evalúan con `IGNORECASE` y `MULTILINE`, y el valor sale del grupo `value`. Si hay varios patrones,
   se usa el primero que encuentre algo (orden de preferencia); `occurrence: last` toma la última coincidencia. Reglas disponibles: `rut`, `sum_lines`, `line_items`, `iva`,
   `total`, `vigencia`, `date_not_future`, `date_order` (ver `src/validator/templates.py`).
3. Agregar textos de ejemplo y tests en `tests/`.

El template se valida al arrancar (campos que no existen en el schema o regex inválidas detienen el
servicio). No hay que tocar el pipeline. **Ojo:** el tipo también debe agregarse a la lista de tipos de los
demás servicios y de `contracts/` (es un cambio de contrato). La lista de archivos está en el README raíz.

Tipos actuales: `factura_sii`, `orden_compra`, `certificado_vigencia`, `cedula_identidad`, `contrato`,
`certificado_accidentabilidad`, `carpeta_tributaria`, `certificado_f30`.

Los textos de ejemplo en `tests/fixtures/texts/` deben ser **ficticios o anonimizados**: nunca subir documentos
reales de clientes al repo. Para RUTs ficticios válidos: `from validator.chile import rut_dv`.

## Uso de IA

Cada llamada a Claude queda en `result.llmCalls` (`purpose`, `outcome`, `model`, `ms`, `inputTokens`,
`outputTokens`, `fields`). El registro es por documento (`contextvars`), así que no se mezcla entre documentos
procesados en paralelo. Llamadas:

- `classify`: confianza de las reglas < `CLASSIFIER_THRESHOLD` (0,6).
- `extract`: campo **obligatorio** ausente o con confianza < `FIELD_MIN_CONFIDENCE` (0,5).
- `visual_review`: según `LLM_VISUAL_REVIEW` (`on_signals` = solo si hay una señal de riesgo con peso > 0).
