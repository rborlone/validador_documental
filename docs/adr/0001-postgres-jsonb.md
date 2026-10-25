# ADR-0001: PostgreSQL con JSONB para documentos y resultados

- Estado: propuesto
- Fecha: 2026-10-24

## Contexto y problema
Hay que guardar el estado de cada documento, su historial de intentos, el outbox de eventos y el resultado de la validación, cuya forma cambia según el tipo de documento (factura, OC, certificado, cédula, contrato). ¿Base relacional o NoSQL?

## Opciones consideradas
1. PostgreSQL con columna `JSONB` para el resultado.
2. Base documental (MongoDB / Cosmos DB) para todo.
3. PostgreSQL para el estado y una base documental para los resultados.

## Decisión
Opción 1. El estado del documento y el outbox necesitan transacciones: el documento y su evento se escriben juntos o no se escriben. `JSONB` (con índice GIN) da la flexibilidad de esquema que tiene una base documental para el resultado, sin operar una segunda base. En Azure se usa Azure Database for PostgreSQL Flexible Server. Los archivos van a Azure Blob Storage, nunca a la base.

## Consecuencias
- Positivas: una sola base, transacciones para el outbox, consultas por campos del resultado (`result->'documentType'->>'value'`).
- Negativas: si el volumen de resultados crece mucho, habrá que particionar por fecha o mover resultados antiguos a almacenamiento frío.
- La opción 3 queda como evolución si los resultados se vuelven el principal patrón de consulta.
