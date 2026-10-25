"""Consumidor de doc.validation.requested.

Flujo por mensaje: started → descarga → pipeline → completed → ack.
- Ack solo al terminar (después de que el broker confirma la publicación del resultado).
- Error reintentable: se incrementa data.attempt y se republica en la cola retry (TTL → vuelve).
- Con attempt >= MAX_ATTEMPTS o error no reintentable: mensaje original a la DLQ + failed.
- Idempotencia: ids de evento deterministas (documentId + attempt + tipo) y una caché LRU de
  intentos ya completados en esta réplica para ignorar redeliveries duplicados.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import OrderedDict
from typing import Any

import aio_pika
from aio_pika.abc import AbstractChannel, AbstractIncomingMessage, AbstractRobustConnection

from validator.config import Settings
from validator.errors import InvalidMessageError, ProcessingError
from validator.logging_setup import correlation_id_var, document_id_var
from validator.messaging import cloudevents as ce
from validator.messaging import topology as topo
from validator.metrics import DOCUMENTS_FAILED, DOCUMENTS_PROCESSED, IN_FLIGHT, PROCESSING_SECONDS, RETRIES
from validator.pipeline.runner import Pipeline
from validator.storage import BlobReader

log = logging.getLogger(__name__)

REQUEUE_DELAY_S = 5.0  # pausa antes de devolver un mensaje cuando falla la publicación (evita bucles calientes)


class _Lru:
    def __init__(self, size: int = 10_000):
        self._items: OrderedDict[tuple[str, int], None] = OrderedDict()
        self._size = size

    def __contains__(self, key: tuple[str, int]) -> bool:
        return key in self._items

    def add(self, key: tuple[str, int]) -> None:
        self._items[key] = None
        self._items.move_to_end(key)
        while len(self._items) > self._size:
            self._items.popitem(last=False)


class Worker:
    def __init__(self, *, settings: Settings, pipeline: Pipeline, blobs: BlobReader):
        self.settings = settings
        self.pipeline = pipeline
        self.blobs = blobs
        self._connection: AbstractRobustConnection | None = None
        self._channel: AbstractChannel | None = None
        self._topology: topo.Topology | None = None
        self._consumer_tag: str | None = None
        self._stopping = False
        self._in_flight = 0
        self._idle = asyncio.Event()
        self._idle.set()
        self._done = _Lru()

    # ------------------------------------------------------------ ciclo de vida

    async def start(self) -> None:
        self._connection = await aio_pika.connect_robust(
            self.settings.rabbitmq_url, client_properties={"connection_name": "doc-validator"}
        )
        self._channel = await self._connection.channel(publisher_confirms=True)
        await self._channel.set_qos(prefetch_count=self.settings.prefetch)
        self._topology = await topo.declare(self._channel, retry_ttl_ms=self.settings.retry_delay_ms)
        self._consumer_tag = await self._topology.requests.consume(self._on_message)
        log.info("consumiendo", extra={"queue": topo.REQUESTS_QUEUE, "prefetch": self.settings.prefetch})

    async def stop(self) -> None:
        """Deja de consumir, espera el mensaje en curso y cierra la conexión."""
        self._stopping = True
        if self._topology and self._consumer_tag:
            try:
                await self._topology.requests.cancel(self._consumer_tag)
            except Exception:
                log.warning("no se pudo cancelar el consumidor", exc_info=True)
            self._consumer_tag = None
        if self._in_flight:
            log.info("esperando mensajes en curso", extra={"in_flight": self._in_flight})
            try:
                await asyncio.wait_for(self._idle.wait(), timeout=self.settings.shutdown_grace_s)
            except TimeoutError:
                log.warning("se agotó la espera; los mensajes sin ack vuelven a la cola")
        if self._connection and not self._connection.is_closed:
            await self._connection.close()
        log.info("consumidor detenido")

    @property
    def ready(self) -> bool:
        return bool(
            not self._stopping
            and self._connection is not None
            and not self._connection.is_closed
            and self._channel is not None
            and not self._channel.is_closed
            and self._consumer_tag
        )

    # ------------------------------------------------------------ publicación

    async def _publish(self, event: dict[str, Any], routing_key: str) -> None:
        assert self._topology is not None
        message = aio_pika.Message(
            body=json.dumps(event, ensure_ascii=False).encode(),
            content_type=ce.CONTENT_TYPE,
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            correlation_id=event["correlationid"],
            message_id=event["id"],
            type=event["type"],
        )
        await self._topology.exchange.publish(message, routing_key=routing_key)

    async def _publish_raw_to_queue(self, queue: str, body: bytes, original: AbstractIncomingMessage,
                                    headers: dict[str, Any]) -> None:
        assert self._channel is not None
        message = aio_pika.Message(
            body=body,
            content_type=original.content_type or ce.CONTENT_TYPE,
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            correlation_id=original.correlation_id,
            message_id=original.message_id,
            headers={**(original.headers or {}), **headers},
        )
        await self._channel.default_exchange.publish(message, routing_key=queue)

    # ------------------------------------------------------------ procesamiento

    async def _on_message(self, message: AbstractIncomingMessage) -> None:
        self._in_flight += 1
        self._idle.clear()
        IN_FLIGHT.inc()
        try:
            await self._handle(message)
        except Exception:
            # Falló la publicación o el ack (p. ej. se cayó la conexión). No se hace ack: el broker
            # reentrega el mensaje. La pausa evita un bucle caliente si el problema persiste.
            log.exception("no se pudo completar el manejo del mensaje; se devolverá a la cola")
            await asyncio.sleep(REQUEUE_DELAY_S)
            try:
                await message.nack(requeue=True)
            except Exception:  # noqa: BLE001
                log.warning("no se pudo hacer nack (el broker reentregará al cerrar el canal)")
        finally:
            IN_FLIGHT.dec()
            self._in_flight -= 1
            if self._in_flight == 0:
                self._idle.set()
            correlation_id_var.set(None)
            document_id_var.set(None)

    async def _handle(self, message: AbstractIncomingMessage) -> None:
        source = self.settings.event_source
        try:
            event = ce.parse_requested(message.body)
        except InvalidMessageError as exc:
            await self._reject_invalid(message, exc)
            return

        data = event.data
        document_id, attempt = str(data.documentId), data.attempt
        correlation_id = event.correlationid or message.correlation_id or event.id
        correlation_id_var.set(correlation_id)
        document_id_var.set(document_id)

        if (document_id, attempt) in self._done:
            log.info("intento ya procesado; se descarta el duplicado", extra={"attempt": attempt})
            await message.ack()
            return

        log.info("procesando documento", extra={"attempt": attempt, "redelivered": message.redelivered})
        await self._publish(ce.started_event(source=source, correlation_id=correlation_id,
                                             document_id=document_id, attempt=attempt), topo.STARTED_KEY)

        started = time.perf_counter()
        error: ProcessingError | None = None
        result: dict[str, Any] | None = None
        try:
            async with asyncio.timeout(self.settings.processing_timeout_s):
                content = await self.blobs.download(data.container, data.blobName)
                result = await self.pipeline.run(
                    document_id=document_id, data=content, declared_type=data.contentType,
                    expected_type=data.expectedType, started=started,
                )
        except ProcessingError as exc:
            error = exc
        except TimeoutError:
            error = ProcessingError("se superó el tiempo máximo de procesamiento", code="TIMEOUT")
        except Exception as exc:
            log.exception("error inesperado en el pipeline")
            error = ProcessingError(f"error inesperado ({type(exc).__name__})")
        finally:
            PROCESSING_SECONDS.observe(time.perf_counter() - started)

        if error is None and result is not None:
            await self._publish(ce.completed_event(source=source, correlation_id=correlation_id,
                                                   document_id=document_id, attempt=attempt, result=result),
                                topo.COMPLETED_KEY)
            DOCUMENTS_PROCESSED.labels(result["verdict"], result["documentType"]["value"]).inc()
            self._done.add((document_id, attempt))
            await message.ack()
            return

        assert error is not None
        if error.retryable and attempt < self.settings.max_attempts:
            retry = json.loads(message.body)
            retry["data"]["attempt"] = attempt + 1
            await self._publish_raw_to_queue(
                topo.RETRY_QUEUE, json.dumps(retry, ensure_ascii=False).encode(), message,
                {"x-last-error": error.code},
            )
            RETRIES.labels(error.code).inc()
            log.warning("error reintentable; se reprograma",
                        extra={"code": error.code, "attempt": attempt, "next_attempt": attempt + 1})
            await message.ack()
            return

        await self._fail(message, document_id=document_id, attempt=attempt, correlation_id=correlation_id,
                         error=error)

    async def _fail(self, message: AbstractIncomingMessage, *, document_id: str, attempt: int,
                    correlation_id: str, error: ProcessingError) -> None:
        await self._publish_raw_to_queue(
            topo.DLQ, message.body, message,
            {"x-error-code": error.code, "x-error-message": error.message[:500], "x-attempt": attempt},
        )
        await self._publish(ce.failed_event(source=self.settings.event_source, correlation_id=correlation_id,
                                            document_id=document_id, attempt=attempt, code=error.code,
                                            message=error.message), topo.FAILED_KEY)
        DOCUMENTS_FAILED.labels(error.code).inc()
        self._done.add((document_id, attempt))
        log.error("documento fallido", extra={"code": error.code, "attempt": attempt,
                                               "retryable": error.retryable})
        await message.ack()

    async def _reject_invalid(self, message: AbstractIncomingMessage, exc: InvalidMessageError) -> None:
        document_id = ce.try_document_id(message.body)
        correlation_id = message.correlation_id or "desconocido"
        correlation_id_var.set(correlation_id)
        document_id_var.set(document_id)
        log.error("mensaje inválido; se envía a la DLQ", extra={"code": exc.code})
        if document_id is None:
            await self._publish_raw_to_queue(topo.DLQ, message.body, message,
                                             {"x-error-code": exc.code, "x-error-message": exc.message[:500]})
            DOCUMENTS_FAILED.labels(exc.code).inc()
            await message.ack()
            return
        attempt = 1
        try:
            attempt = max(1, int(json.loads(message.body)["data"]["attempt"]))
        except Exception:  # noqa: BLE001
            attempt = 1
        await self._fail(message, document_id=document_id, attempt=attempt, correlation_id=correlation_id,
                         error=exc)
