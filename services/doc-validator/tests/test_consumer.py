import asyncio
import json
import uuid
from dataclasses import dataclass, field
from typing import Any

import pytest

from tests.conftest import requires_contracts
from tests.contracts_helper import assert_valid
from tests.test_cloudevents import requested
from validator.errors import BlobNotFoundError, ProcessingError
from validator.messaging import consumer as consumer_mod
from validator.messaging import topology as topo
from validator.messaging.consumer import Worker

RESULT = {
    "documentId": None, "documentType": {"value": "factura_sii", "confidence": 1.0, "method": "rules", "reason": None},
    "templateVersion": "1.0.0", "extracted": {}, "checks": [],
    "authenticity": {"score": 0.0, "level": "LOW", "signals": []}, "signature": {"status": "NOT_IMPLEMENTED"},
    "verdict": "VALID", "pages": 1, "textSource": "text", "llmUsed": False, "processingMs": 10,
}


class FakeExchange:
    def __init__(self, fail: bool = False):
        self.published: list[tuple[str, Any]] = []
        self.fail = fail

    async def publish(self, message, routing_key: str):
        if self.fail:
            raise ConnectionError("canal cerrado")
        self.published.append((routing_key, message))

    def bodies(self, key: str) -> list[dict]:
        return [json.loads(m.body) for k, m in self.published if k == key]


@dataclass
class FakeChannel:
    default_exchange: FakeExchange = field(default_factory=FakeExchange)


@dataclass
class FakeMessage:
    body: bytes
    correlation_id: str | None = "corr-1"
    message_id: str | None = "m-1"
    headers: dict = field(default_factory=dict)
    content_type: str = "application/cloudevents+json"
    redelivered: bool = False
    acked: bool = False
    nacked: bool = False

    async def ack(self):
        self.acked = True

    async def nack(self, requeue: bool = True):
        self.nacked = True


class FakeBlobs:
    def __init__(self, error: Exception | None = None):
        self.error = error

    async def download(self, container: str, blob_name: str) -> bytes:
        if self.error:
            raise self.error
        return b"%PDF-1.7"

    async def close(self):
        return None


class FakePipeline:
    def __init__(self, delay: float = 0):
        self.calls = 0
        self.delay = delay

    async def run(self, *, document_id: str, **_: Any) -> dict:
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        return {**RESULT, "documentId": document_id}


def make_worker(settings, *, blobs=None, pipeline=None, exchange=None, **overrides):
    s = settings.model_copy(update=overrides)
    worker = Worker(settings=s, pipeline=pipeline or FakePipeline(), blobs=blobs or FakeBlobs())
    worker._channel = FakeChannel()
    worker._topology = topo.Topology(exchange=exchange or FakeExchange(), requests=None, retry=None, dlq=None)
    return worker


def message(**data) -> FakeMessage:
    return FakeMessage(body=json.dumps(requested(**data)).encode())


@requires_contracts
async def test_exito_publica_started_y_completed_y_hace_ack(settings) -> None:
    worker = make_worker(settings)
    msg = message()
    await worker._on_message(msg)
    ex = worker._topology.exchange
    assert [k for k, _ in ex.published] == [topo.STARTED_KEY, topo.COMPLETED_KEY]
    for _, m in ex.published:
        assert m.content_type == "application/cloudevents+json"
        assert m.correlation_id == "corr-1"
        assert m.delivery_mode.value == 2
        assert_valid(json.loads(m.body))
    assert msg.acked and not msg.nacked


async def test_duplicado_se_descarta(settings) -> None:
    pipeline = FakePipeline()
    worker = make_worker(settings, pipeline=pipeline)
    first, second = message(), message()
    second.body = first.body
    await worker._on_message(first)
    await worker._on_message(second)
    assert pipeline.calls == 1 and second.acked


async def test_error_reintentable_va_a_retry_con_attempt_mas_uno(settings) -> None:
    worker = make_worker(settings, blobs=FakeBlobs(ProcessingError("red caída", code="STORAGE_ERROR")))
    msg = message(attempt=1)
    await worker._on_message(msg)
    retry = worker._channel.default_exchange.bodies(topo.RETRY_QUEUE)
    assert len(retry) == 1 and retry[0]["data"]["attempt"] == 2
    assert worker._topology.exchange.bodies(topo.FAILED_KEY) == []
    assert msg.acked


@requires_contracts
async def test_agota_reintentos_va_a_dlq_y_publica_failed(settings) -> None:
    worker = make_worker(settings, blobs=FakeBlobs(ProcessingError("red caída", code="STORAGE_ERROR")),
                         max_attempts=3)
    msg = message(attempt=3)
    await worker._on_message(msg)
    dlq = worker._channel.default_exchange.published
    assert [k for k, _ in dlq] == [topo.DLQ]
    assert dlq[0][1].body == msg.body  # mensaje original
    assert dlq[0][1].headers["x-error-code"] == "STORAGE_ERROR"
    [failed] = worker._topology.exchange.bodies(topo.FAILED_KEY)
    assert failed["data"]["attempt"] == 3 and failed["data"]["error"]["code"] == "STORAGE_ERROR"
    assert_valid(failed)
    assert msg.acked


async def test_error_no_reintentable_falla_de_inmediato(settings) -> None:
    worker = make_worker(settings, blobs=FakeBlobs(BlobNotFoundError("no existe")))
    msg = message(attempt=1)
    await worker._on_message(msg)
    assert [k for k, _ in worker._channel.default_exchange.published] == [topo.DLQ]
    [failed] = worker._topology.exchange.bodies(topo.FAILED_KEY)
    assert failed["data"]["error"]["code"] == "BLOB_NOT_FOUND"


async def test_mensaje_invalido_va_a_dlq(settings) -> None:
    worker = make_worker(settings)
    msg = FakeMessage(body=b"{basura")
    await worker._on_message(msg)
    assert [k for k, _ in worker._channel.default_exchange.published] == [topo.DLQ]
    assert worker._topology.exchange.published == []
    assert msg.acked


async def test_mensaje_invalido_con_document_id_publica_failed(settings) -> None:
    worker = make_worker(settings)
    doc_id = str(uuid.uuid4())
    body = requested(documentId=doc_id, contentType="text/html")
    msg = FakeMessage(body=json.dumps(body).encode())
    await worker._on_message(msg)
    [failed] = worker._topology.exchange.bodies(topo.FAILED_KEY)
    assert failed["data"]["documentId"] == doc_id
    assert failed["data"]["error"]["code"] == "INVALID_MESSAGE"


async def test_timeout_es_reintentable(settings) -> None:
    worker = make_worker(settings, pipeline=FakePipeline(delay=1), processing_timeout_s=0.05)
    msg = message(attempt=1)
    await worker._on_message(msg)
    [retry] = worker._channel.default_exchange.bodies(topo.RETRY_QUEUE)
    assert retry["data"]["attempt"] == 2


async def test_fallo_al_publicar_devuelve_el_mensaje(settings, monkeypatch) -> None:
    monkeypatch.setattr(consumer_mod, "REQUEUE_DELAY_S", 0)
    worker = make_worker(settings, exchange=FakeExchange(fail=True))
    msg = message()
    await worker._on_message(msg)
    assert msg.nacked and not msg.acked
    assert worker._in_flight == 0


async def test_stop_espera_el_mensaje_en_curso(settings) -> None:
    worker = make_worker(settings, pipeline=FakePipeline(delay=0.2))
    msg = message()
    task = asyncio.create_task(worker._on_message(msg))
    await asyncio.sleep(0.05)
    await worker.stop()
    assert msg.acked  # terminó antes de cerrar
    await task
    assert not worker.ready


@pytest.mark.parametrize("ttl", [10_000])
def test_argumentos_de_la_cola_retry(ttl: int) -> None:
    assert topo.retry_arguments(ttl) == {
        "x-queue-type": "quorum",
        "x-message-ttl": 10_000,
        "x-dead-letter-exchange": "documents",
        "x-dead-letter-routing-key": "doc.validation.requested",
    }
