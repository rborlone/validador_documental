# ADR-0002: Procesamiento asíncrono con RabbitMQ y outbox transaccional

- Estado: propuesto
- Fecha: 2026-10-24

## Contexto y problema
Validar un documento (OCR, reglas, IA) toma segundos o minutos. El usuario debe poder seguir trabajando y recibir aviso al terminar. El sistema corre en AKS y el worker debe escalar según la carga.

## Opciones consideradas
1. RabbitMQ con colas quorum y outbox transaccional.
2. Azure Service Bus.
3. Llamada HTTP síncrona con timeout largo.

## Decisión
Opción 1. RabbitMQ lo pidió el equipo, corre igual en local y en AKS (Cluster Operator, 3 nodos) y KEDA escala el worker según el largo de la cola. Las colas quorum dan durabilidad con replicación. El documents-service escribe el evento en una tabla outbox en la misma transacción que el documento, y un relay lo publica con publisher confirms. Así no se pierde ni se publica un evento de un documento que no se guardó.

Reintentos: cola `retry` con TTL que devuelve el mensaje al exchange. Después de `MAX_ATTEMPTS` el mensaje va a la DLQ y el documento queda `FAILED`.

## Consecuencias
- Entrega al menos una vez: los consumidores son idempotentes y los estados no retroceden.
- Hay que operar RabbitMQ. Service Bus (opción 2) es la alternativa administrada si el equipo prefiere no operarlo; el código aísla la mensajería en un módulo para facilitar el cambio.
