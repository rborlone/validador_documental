# Operación

## Local con docker-compose

```bash
cp .env.example .env        # y pegar ANTHROPIC_API_KEY en .env (nunca en .env.example, que se sube al repo)
docker compose up -d --build
open http://localhost:5173
```

| Servicio | URL local |
|---|---|
| Playground | http://localhost:5173 |
| BFF | http://localhost:3000/api/documents |
| documents-service | http://localhost:3100/docs (Swagger) |
| doc-validator | http://localhost:8000/health/ready · http://localhost:8000/metrics |
| RabbitMQ | http://localhost:15672 (`validador` / `validador`) |
| Postgres | `localhost:5432` (`documents` / `documents`, base `documents`) |
| Azurite (Blob) | `localhost:10000` |

### Tareas habituales

| Tarea | Comando |
|---|---|
| Aplicar un cambio de código en un servicio | `docker compose up -d --build doc-validator` (o el servicio que cambió) |
| Recargar `.env` (p. ej. la API key) | `docker compose up -d doc-validator` (recrea el contenedor; `restart` no relee el `.env`) |
| Borrar **todos** los datos (documentos, archivos, colas) | `docker compose down -v && docker compose up -d` |
| Ver logs del validador | `docker compose logs -f doc-validator` |
| Ver qué documentos usaron IA | ver la consulta de abajo |
| Apagar todo | `docker compose down` (conserva los datos) |

```sql
-- docker compose exec postgres psql -U documents -d documents
select filename, verdict, document_type,
       jsonb_array_length(coalesce(result->'llmCalls', '[]')) as llamadas_ia,
       (select sum((c->>'inputTokens')::int + (c->>'outputTokens')::int)
          from jsonb_array_elements(result->'llmCalls') c) as tokens
from documents order by created_at desc;
```

### Probar un documento sin pasar por la UI

```bash
curl -s -X POST localhost:3000/api/documents -F files=@mi-documento.pdf -F expectedType=orden_compra
curl -s localhost:3000/api/documents/<id> | jq '.result'
```

Para probar el pipeline dentro del contenedor (sin guardar nada en la base):

```bash
docker compose cp mi-documento.pdf doc-validator:/tmp/doc.pdf
docker compose exec doc-validator python -c "
import asyncio, uuid, json
from datetime import date
from validator.config import Settings
from validator.templates import TemplateRegistry
from validator.llm.base import DisabledLLM
from validator.pipeline.runner import Pipeline
s = Settings(); reg = TemplateRegistry.load(s.templates_dir)
p = Pipeline(settings=s, registry=reg, llm=DisabledLLM(), today=date.today)
r = asyncio.run(p.run(document_id=str(uuid.uuid4()), data=open('/tmp/doc.pdf','rb').read(), declared_type='application/pdf'))
print(json.dumps(r, ensure_ascii=False, indent=2))"
```

## Observabilidad

- **Logs:** JSON en todos los servicios, con `correlationId` (nace en el BFF con `x-correlation-id` y viaja en los eventos).
- **Métricas del validador** (`/metrics`):
  - `doc_validator_*`: documentos procesados y fallidos, duración.
  - `doc_validator_llm_calls_total{purpose,outcome}`: llamadas a Claude por propósito y resultado.
- **Por documento:** `result.llmCalls` (uso de IA) y `result.processingMs`.

## Problemas conocidos y diagnóstico

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Todos los campos de un formato nuevo salen vacíos o con valores raros | Diseño distinto al del template: valor en la línea siguiente, montos `58,816.00`, palabras pegadas | Ver el texto que recibe el pipeline (`inspect_pdf(...).pages[i].text`) y agregar patrones al template; agregar un test con un texto **anonimizado** |
| Riesgo alto por `pdf.incremental_updates` en documentos legítimos | PDFs firmados o editados después de generarse | Revisar a mano. Si el archivo es el mismo PDF concatenado, ahora sale como `pdf.repeated_copies` (peso 0) |
| Los archivos traen 2 o 4 copias del mismo PDF | El sistema que los exporta los concatena (visto en descargas con nombre UUID) | No es un bug del validador; reportarlo al sistema de origen |
| Escaneo con algo de texto encima no se lee | Antes no se aplicaba OCR si había más de 40 caracteres de texto | Corregido: una página casi toda imagen pasa por OCR y las cifras escritas encima generan `pdf.text_over_scan` |
| La IA no se usa aunque hay key | La key está en `.env.example` o el contenedor no se recreó | Poner la key en `.env` y correr `docker compose up -d doc-validator` |
| Los tests de OCR se omiten en local | Tesseract local sin el idioma `spa` | `brew install tesseract-lang`, o correr los tests en la imagen |
| El documento queda en `QUEUED` | El validador está caído o la cola no existe | El outbox reintenta; al levantar el validador se procesa |

## AKS

1. Namespace con Pod Security `restricted`: `kubectl apply -f deploy/k8s/namespace.yaml`.
2. RabbitMQ con Cluster Operator: `deploy/k8s/rabbitmq-cluster.yaml`.
3. Postgres Flexible Server y Storage Account administrados.
4. Secretos en Key Vault: `rabbitmq-url`, `documents-database-url`, `storage-connection-string` y `anthropic-api-key`.
5. Identidad administrada federada con los service accounts (Workload Identity).
6. KEDA instalado en el clúster.
7. Desplegar cada pieza con su chart:

```bash
for s in documents-service doc-validator bff web; do
  helm dependency update deploy/helm/$s
  helm upgrade --install $s deploy/helm/$s -n validador -f deploy/helm/$s/values-aks.yaml
done
```

Completar los `<...>` de cada `values-aks.yaml` (ACR, client id, Key Vault, tenant, host). Los charts **no se han probado en un clúster real**.
