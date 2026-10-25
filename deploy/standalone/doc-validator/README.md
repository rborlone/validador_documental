# Solo el motor: RabbitMQ + doc-validator

Combinación C de [docs/piezas-lego.md](../../../docs/piezas-lego.md): el motor de validación sin documents-service, BFF, UI ni Postgres. Sirve para un sistema que ya tiene su propio almacenamiento y base de datos y solo quiere validar documentos.

```
[otro sistema] ──1. sube el archivo──► Blob
      │
      ├──2. publica doc.validation.requested ──► RabbitMQ ──► doc-validator ──► lee el archivo de Blob
      │                                                        │
      └──3. recibe doc.validation.completed / failed ◄─────────┘
```

## Local

```bash
cd deploy/standalone/doc-validator
docker compose --env-file ../../../.env up -d --build      # --env-file para tomar ANTHROPIC_API_KEY (opcional)

mkdir -p docs && cp mi-documento.pdf docs/
docker compose run --rm cliente /docs/mi-documento.pdf               # imprime el ValidationResult
docker compose run --rm cliente /docs/mi-documento.pdf orden_compra  # con tipo esperado
```

| | |
|---|---|
| RabbitMQ | `localhost:5673`, panel en http://localhost:15673 (`motor` / `motor`) |
| doc-validator | http://localhost:8001/health/ready · http://localhost:8001/metrics |
| Azurite | `localhost:10001` |

Usa puertos distintos a los del compose principal, así que pueden correr a la vez. Para apagarlo: `docker compose down` (conserva los datos) o `docker compose down -v` (los borra).

[`enviar.py`](enviar.py) es el ejemplo de integración: unas 100 líneas que solo dependen de los contratos (`contracts/`). Un sistema en otro lenguaje hace lo mismo con su cliente AMQP y su SDK de Azure Blob.

**Probado:** `factura_valida.pdf` da VALID y `factura_total_alterado.pdf` da INVALID (`totals.total`), en menos de 1 s cada una y sin IA.

## En AKS: qué implica

El código **no necesita cambios**. El trabajo es de infraestructura e identidad.

| # | Paso | Cómo | Esfuerzo |
|---|---|---|---|
| 1 | RabbitMQ | Instalar el Cluster Operator (`kubectl apply` de su manifiesto) y aplicar [`deploy/k8s/rabbitmq-cluster.yaml`](../../k8s/rabbitmq-cluster.yaml) (3 nodos, quorum, disco persistente) | Bajo |
| 2 | Storage Account | Cuenta + contenedor `documents`, idealmente con private endpoint | Bajo |
| 3 | Identidad | Identidad administrada federada con el service account `doc-validator` (Workload Identity). Rol **Storage Blob Data Reader** sobre el contenedor. Con eso se usa `AZURE_STORAGE_ACCOUNT_URL` y no hay connection string | Medio (es lo que más se demora la primera vez) |
| 4 | Secretos | En Key Vault: `rabbitmq-url` y `anthropic-api-key`. Permiso de lectura para la identidad del paso 3 | Bajo |
| 5 | KEDA | Add-on de AKS: `az aks update --enable-keda` | Bajo |
| 6 | Desplegar | `helm upgrade --install doc-validator deploy/helm/doc-validator -f values-aks.yaml`, completando ACR, client id, Key Vault y tenant | Bajo |
| 7 | Red de salida | Permitir HTTPS a `api.anthropic.com` (Azure Firewall o NAT) si el clúster restringe la salida | Bajo a medio, según la política de red |

**Estimación:** con un AKS existente y alguien con experiencia en Azure, **medio día a un día**. La mayor parte se va en identidad, permisos y red, no en el validador.

### Ajustes pendientes antes de producción

Ninguno de estos ajustes impide un primer despliegue:

- **Métricas:** la NetworkPolicy del chart bloquea también a Prometheus. Hay que permitir el namespace de monitoreo.
- **Storage con Workload Identity:** usar `AZURE_STORAGE_ACCOUNT_URL` en vez del secreto `storage-connection-string` que trae `values-aks.yaml`.
- **RabbitMQ:**
  - usuario propio para el validador (hoy todos usan el administrador), vhost propio y TLS;
  - plugin de Prometheus y alertas por largo de cola y mensajes en DLQ.
- **Egress:** limitar el tráfico de salida del pod a RabbitMQ, Blob y `api.anthropic.com`.

El chart y el manifiesto de RabbitMQ pasan `helm lint` y `helm template`, pero **no se han probado en un clúster real**.
