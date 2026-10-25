"""Topología RabbitMQ del doc-validator, exactamente como en contracts/README.md."""

from __future__ import annotations

from dataclasses import dataclass

import aio_pika
from aio_pika.abc import AbstractChannel, AbstractExchange, AbstractQueue

EXCHANGE = "documents"
REQUESTED_KEY = "doc.validation.requested"
STARTED_KEY = "doc.validation.started"
COMPLETED_KEY = "doc.validation.completed"
FAILED_KEY = "doc.validation.failed"

REQUESTS_QUEUE = "doc-validator.requests"
RETRY_QUEUE = "doc-validator.requests.retry"
DLQ = "doc-validator.requests.dlq"

QUORUM = {"x-queue-type": "quorum"}


def retry_arguments(ttl_ms: int) -> dict[str, object]:
    return {
        **QUORUM,
        "x-message-ttl": ttl_ms,
        "x-dead-letter-exchange": EXCHANGE,
        "x-dead-letter-routing-key": REQUESTED_KEY,
    }


@dataclass
class Topology:
    exchange: AbstractExchange
    requests: AbstractQueue
    retry: AbstractQueue
    dlq: AbstractQueue


async def declare(channel: AbstractChannel, *, retry_ttl_ms: int = 10_000) -> Topology:
    exchange = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True)
    requests = await channel.declare_queue(REQUESTS_QUEUE, durable=True, arguments=QUORUM)
    await requests.bind(exchange, routing_key=REQUESTED_KEY)
    # La cola de reintento no se enlaza al exchange: se publica directo (exchange por defecto) y,
    # al vencer el TTL, RabbitMQ la devuelve a `documents` con la clave doc.validation.requested.
    retry = await channel.declare_queue(RETRY_QUEUE, durable=True, arguments=retry_arguments(retry_ttl_ms))
    dlq = await channel.declare_queue(DLQ, durable=True, arguments=QUORUM)
    return Topology(exchange=exchange, requests=requests, retry=retry, dlq=dlq)
