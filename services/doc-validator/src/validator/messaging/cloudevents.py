"""CloudEvents 1.0 (modo estructurado) según contracts/events/*.schema.json."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from validator.errors import InvalidMessageError

CONTENT_TYPE = "application/cloudevents+json"
DATA_CONTENT_TYPE = "application/json"

# Espacio de nombres para ids deterministas: el mismo intento produce el mismo id de evento,
# así documents-service puede deduplicar si un mensaje se reprocesa tras una caída.
_NAMESPACE = uuid.UUID("6f1c2d5e-8a3b-4c7d-9e0f-1a2b3c4d5e6f")

DocumentType = Literal[
    "factura_sii", "orden_compra", "certificado_vigencia", "cedula_identidad", "contrato",
    "certificado_accidentabilidad", "carpeta_tributaria", "certificado_f30", "desconocido",
]


class RequestedData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    documentId: uuid.UUID  # noqa: N815 - nombre del contrato
    container: str
    blobName: str  # noqa: N815
    contentType: Literal["application/pdf", "image/png", "image/jpeg", "image/tiff"]  # noqa: N815
    filename: str
    expectedType: DocumentType | None = None  # noqa: N815
    attempt: int = Field(ge=1)


class RequestedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    specversion: Literal["1.0"]
    id: str
    source: str
    type: Literal["doc.validation.requested"]
    time: str
    datacontenttype: Literal["application/json"]
    correlationid: str
    data: RequestedData


def parse_requested(body: bytes) -> RequestedEvent:
    try:
        return RequestedEvent.model_validate(json.loads(body))
    except (ValueError, ValidationError) as exc:
        raise InvalidMessageError(f"mensaje inválido: {type(exc).__name__}") from exc


def try_document_id(body: bytes) -> str | None:
    """Intenta rescatar documentId de un mensaje inválido (para publicar failed)."""
    try:
        doc_id = json.loads(body)["data"]["documentId"]
        return str(uuid.UUID(str(doc_id)))
    except Exception:  # noqa: BLE001
        return None


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def event_id(document_id: str, attempt: int, event_type: str) -> str:
    return str(uuid.uuid5(_NAMESPACE, f"{document_id}:{attempt}:{event_type}"))


def build_event(
    *, event_type: str, source: str, correlation_id: str, data: dict[str, Any], document_id: str, attempt: int
) -> dict[str, Any]:
    return {
        "specversion": "1.0",
        "id": event_id(document_id, attempt, event_type),
        "source": source,
        "type": event_type,
        "time": now_iso(),
        "datacontenttype": DATA_CONTENT_TYPE,
        "correlationid": correlation_id,
        "data": data,
    }


def started_event(*, source: str, correlation_id: str, document_id: str, attempt: int) -> dict[str, Any]:
    return build_event(event_type="doc.validation.started", source=source, correlation_id=correlation_id,
                       data={"documentId": document_id, "attempt": attempt},
                       document_id=document_id, attempt=attempt)


def completed_event(
    *, source: str, correlation_id: str, document_id: str, attempt: int, result: dict[str, Any]
) -> dict[str, Any]:
    return build_event(event_type="doc.validation.completed", source=source, correlation_id=correlation_id,
                       data={"documentId": document_id, "result": result},
                       document_id=document_id, attempt=attempt)


def failed_event(
    *, source: str, correlation_id: str, document_id: str, attempt: int, code: str, message: str
) -> dict[str, Any]:
    return build_event(event_type="doc.validation.failed", source=source, correlation_id=correlation_id,
                       data={"documentId": document_id, "attempt": attempt,
                             "error": {"code": code, "message": message}},
                       document_id=document_id, attempt=attempt)
