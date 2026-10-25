import json
import uuid

import pytest

from tests.conftest import requires_contracts
from tests.contracts_helper import assert_valid
from validator.errors import InvalidMessageError
from validator.messaging import cloudevents as ce

DOC_ID = str(uuid.uuid4())


def requested(**data_overrides) -> dict:
    data = {"documentId": DOC_ID, "container": "documents", "blobName": f"{DOC_ID}/factura.pdf",
            "contentType": "application/pdf", "filename": "factura.pdf", "expectedType": None, "attempt": 1}
    data.update(data_overrides)
    return {"specversion": "1.0", "id": str(uuid.uuid4()), "source": "/documents-service",
            "type": "doc.validation.requested", "time": "2026-10-24T12:00:00.000Z",
            "datacontenttype": "application/json", "correlationid": "corr-1", "data": data}


@requires_contracts
def test_requested_de_ejemplo_cumple_contrato() -> None:
    assert_valid(requested())


def test_parse_requested() -> None:
    event = ce.parse_requested(json.dumps(requested(expectedType="factura_sii")).encode())
    assert str(event.data.documentId) == DOC_ID
    assert event.data.expectedType == "factura_sii"


@pytest.mark.parametrize(
    "body",
    [b"no es json", json.dumps({"hola": 1}).encode(), json.dumps(requested(contentType="text/plain")).encode(),
     json.dumps(requested(attempt=0)).encode()],
)
def test_parse_requested_invalido(body: bytes) -> None:
    with pytest.raises(InvalidMessageError):
        ce.parse_requested(body)


@requires_contracts
def test_eventos_publicados_cumplen_contrato() -> None:
    kw = {"source": "/doc-validator", "correlation_id": "corr-1", "document_id": DOC_ID, "attempt": 2}
    assert_valid(ce.started_event(**kw))
    assert_valid(ce.failed_event(**kw, code="BLOB_NOT_FOUND", message="no existe"))


def test_ids_deterministas_por_intento() -> None:
    a = ce.started_event(source="/x", correlation_id="c", document_id=DOC_ID, attempt=1)
    b = ce.started_event(source="/x", correlation_id="c", document_id=DOC_ID, attempt=1)
    c = ce.started_event(source="/x", correlation_id="c", document_id=DOC_ID, attempt=2)
    assert a["id"] == b["id"] != c["id"]
    uuid.UUID(a["id"])
