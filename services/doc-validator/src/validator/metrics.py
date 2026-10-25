"""Métricas Prometheus del worker."""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

DOCUMENTS_PROCESSED = Counter(
    "doc_validator_documents_processed_total",
    "Documentos procesados con resultado (doc.validation.completed)",
    ["verdict", "document_type"],
)
DOCUMENTS_FAILED = Counter(
    "doc_validator_documents_failed_total",
    "Documentos que terminaron en doc.validation.failed",
    ["code"],
)
RETRIES = Counter("doc_validator_retries_total", "Mensajes reenviados a la cola de reintento", ["code"])
PROCESSING_SECONDS = Histogram(
    "doc_validator_processing_seconds",
    "Duración del procesamiento de un documento (descarga + pipeline)",
    buckets=(0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300),
)
IN_FLIGHT = Gauge("doc_validator_in_flight", "Mensajes en procesamiento")
LLM_CALLS = Counter("doc_validator_llm_calls_total", "Llamadas al LLM", ["purpose", "outcome"])
