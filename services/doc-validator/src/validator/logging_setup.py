"""Logs JSON con correlationId y documentId tomados del contexto.

Regla: nunca se registra contenido del documento (texto, campos extraídos, imágenes).
Solo identificadores, tamaños, tiempos y códigos.
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
from datetime import UTC, datetime

correlation_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("correlation_id", default=None)
document_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("document_id", default=None)

_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if (cid := correlation_id_var.get()) is not None:
            payload["correlationId"] = cid
        if (did := document_id_var.get()) is not None:
            payload["documentId"] = did
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # Librerías ruidosas: el SDK de Azure registra cabeceras HTTP en INFO.
    for noisy in ("azure", "aiormq", "aio_pika", "httpx", "httpx2", "anthropic", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
