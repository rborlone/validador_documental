# ADR-0004: Notificaciones al navegador con SSE y exchange fanout

- Estado: propuesto
- Fecha: 2026-10-24

## Contexto y problema
La UI debe enterarse cuando un documento cambia de estado. El BFF corre con varias réplicas y cada navegador está conectado a una sola.

## Opciones consideradas
1. Server-Sent Events + exchange fanout en RabbitMQ.
2. WebSockets (Socket.IO) con adaptador Redis.
3. Polling.

## Decisión
Opción 1. El flujo es solo servidor → cliente, y SSE funciona sobre HTTP normal con reconexión automática del navegador. El documents-service publica `doc.status.changed` en el exchange fanout `notifications`. Cada réplica del BFF tiene su propia cola exclusiva, así todas reciben todos los eventos y cada una los envía a sus clientes conectados. No hace falta Redis.

## Consecuencias
- El ingress debe desactivar el buffering y permitir conexiones largas (anotaciones en `values-aks.yaml` del BFF).
- Cuando exista autenticación, cada réplica filtrará los eventos por usuario o tenant antes de enviarlos.
- La UI mantiene polling de respaldo si el SSE cae.
