# ADR-0003: BFF sin estado y documents-service dueño del documento

- Estado: propuesto
- Fecha: 2026-10-24

## Contexto y problema
El front necesita una API a su medida. ¿El BFF guarda archivos y datos o solo conecta el front con el backend?

## Decisión
El BFF solo conecta: expone la API de la UI, reenvía las subidas en streaming, agrega respuestas, será el punto de autenticación (Entra ID) y entrega las notificaciones SSE. No tiene base de datos ni acceso a Blob.

El **documents-service** es dueño del dominio documento: Blob, Postgres, outbox, consumo de resultados y publicación de cambios de estado. Su API es interna (ClusterIP, NetworkPolicy que solo permite tráfico desde el BFF).

## Consecuencias
- Cada servicio tiene una sola responsabilidad y escala por separado.
- La subida de archivos pasa por dos servicios. Evolución: el documents-service entrega una URL SAS y el navegador sube directo a Blob (patrón valet key).
