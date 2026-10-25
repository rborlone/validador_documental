"""Cliente de ejemplo para usar solo el motor (doc-validator) desde otro sistema.

1. Sube el archivo a Blob.
2. Declara una cola propia para recibir los resultados (binding a completed y failed).
3. Publica doc.validation.requested (CloudEvent) en el exchange "documents".
4. Espera el resultado de ese documento e imprime el JSON.

No depende de ningún otro servicio del proyecto: solo de los contratos (contracts/).
"""

from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import aio_pika
from azure.storage.blob.aio import BlobServiceClient

EXCHANGE = "documents"
TIMEOUT_S = 180


def cloud_event(document_id: str, blob_name: str, content_type: str, filename: str, expected: str | None) -> dict:
    return {
        "specversion": "1.0",
        "id": str(uuid.uuid4()),
        "source": "/cliente-ejemplo",
        "type": "doc.validation.requested",
        "time": datetime.now(UTC).isoformat(),
        "datacontenttype": "application/json",
        "correlationid": document_id,
        "data": {
            "documentId": document_id, "container": os.environ["BLOB_CONTAINER"], "blobName": blob_name,
            "contentType": content_type, "filename": filename, "expectedType": expected, "attempt": 1,
        },
    }


async def upload(path: Path, blob_name: str) -> None:
    async with BlobServiceClient.from_connection_string(os.environ["AZURE_STORAGE_CONNECTION_STRING"]) as svc:
        container = svc.get_container_client(os.environ["BLOB_CONTAINER"])
        if not await container.exists():
            await container.create_container()
        await container.upload_blob(blob_name, path.read_bytes(), overwrite=True)


async def main(path: Path, expected: str | None) -> int:
    content_type = mimetypes.guess_type(path.name)[0] or "application/pdf"
    document_id = str(uuid.uuid4())
    blob_name = f"cliente-ejemplo/{document_id}/{path.name}"
    await upload(path, blob_name)
    print(f"→ subido a Blob: {blob_name}", file=sys.stderr)

    connection = await aio_pika.connect_robust(os.environ["RABBITMQ_URL"])
    async with connection:
        channel = await connection.channel(publisher_confirms=True)
        exchange = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True)
        # Cola temporal propia: un sistema real usaría una cola durable con su nombre.
        queue = await channel.declare_queue(exclusive=True, auto_delete=True)
        for key in ("doc.validation.started", "doc.validation.completed", "doc.validation.failed"):
            await queue.bind(exchange, key)

        event = cloud_event(document_id, blob_name, content_type, path.name, expected)
        await exchange.publish(
            aio_pika.Message(json.dumps(event).encode(), content_type="application/cloudevents+json",
                             delivery_mode=aio_pika.DeliveryMode.PERSISTENT, correlation_id=document_id),
            routing_key="doc.validation.requested",
            mandatory=True,  # falla si el validador aún no declaró su cola
        )
        print(f"→ publicado doc.validation.requested ({document_id})", file=sys.stderr)

        async with queue.iterator(timeout=TIMEOUT_S) as messages:
            async for message in messages:
                async with message.process():
                    body = json.loads(message.body)
                    if body["data"].get("documentId") != document_id:
                        continue  # resultado de otro documento
                    print(f"← {body['type']}", file=sys.stderr)
                    if body["type"] == "doc.validation.completed":
                        print(json.dumps(body["data"]["result"], ensure_ascii=False, indent=2))
                        return 0
                    if body["type"] == "doc.validation.failed":
                        print(json.dumps(body["data"]["error"], ensure_ascii=False, indent=2))
                        return 1
    return 2


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("uso: enviar.py <archivo> [tipo_esperado]")
    sys.exit(asyncio.run(main(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else None)))
