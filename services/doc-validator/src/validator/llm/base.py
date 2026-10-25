"""Interfaz del proveedor LLM. El pipeline depende solo de esto, no de un SDK concreto.

Todas las operaciones devuelven None si el LLM no está disponible o falla: el LLM es un
respaldo y nunca debe romper el pipeline.
"""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel


@dataclass(frozen=True)
class LLMClassification:
    type: str
    confidence: float
    reason: str


@dataclass(frozen=True)
class LLMVisualReview:
    suspicious: bool
    confidence: float
    reasons: list[str] = field(default_factory=list)


@dataclass
class LLMCall:
    """Una llamada al LLM durante la validación de un documento (se publica en el resultado)."""

    purpose: str  # classify | extract | visual_review
    outcome: str  # ok, timeout, refusal, schema_mismatch, ...
    model: str
    ms: int
    input_tokens: int = 0  # incluye los tokens leídos o escritos en caché
    output_tokens: int = 0
    fields: list[str] = field(default_factory=list)  # campos pedidos (solo extract)

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"purpose": self.purpose, "outcome": self.outcome, "model": self.model,
                               "ms": self.ms, "inputTokens": self.input_tokens, "outputTokens": self.output_tokens}
        if self.fields:
            out["fields"] = list(self.fields)
        return out


# Llamadas del documento en curso. Es una variable de contexto porque el worker valida varios
# documentos a la vez con el mismo cliente.
_CALLS: ContextVar[list[LLMCall] | None] = ContextVar("llm_calls", default=None)


def start_recording() -> Any:
    """Empieza a registrar las llamadas del documento actual. Devuelve el token para `stop_recording`."""
    return _CALLS.set([])


def stop_recording(token: Any) -> None:
    _CALLS.reset(token)


def current_calls() -> list[LLMCall]:
    return list(_CALLS.get() or [])


def record_call(call: LLMCall) -> None:
    calls = _CALLS.get()
    if calls is not None:
        calls.append(call)


def amend_last_call(purpose: str, outcome: str) -> None:
    """Corrige el resultado de la última llamada (p. ej. respuesta válida que no cumple el schema)."""
    calls = _CALLS.get()
    for call in reversed(calls or []):
        if call.purpose == purpose:
            call.outcome = outcome
            return


@runtime_checkable
class LLMProvider(Protocol):
    name: str

    @property
    def enabled(self) -> bool: ...

    async def classify(self, *, text: str, image_png: bytes | None) -> LLMClassification | None: ...

    async def extract(
        self, *, doc_type: str, schema: type[BaseModel], fields: list[str], text: str, image_png: bytes | None
    ) -> dict[str, Any] | None: ...

    async def visual_review(self, *, doc_type: str, image_png: bytes) -> LLMVisualReview | None: ...

    async def aclose(self) -> None: ...


class DisabledLLM:
    """Proveedor nulo: el pipeline funciona solo con reglas."""

    name = "disabled"

    @property
    def enabled(self) -> bool:
        return False

    async def classify(self, *, text: str, image_png: bytes | None) -> LLMClassification | None:
        return None

    async def extract(
        self, *, doc_type: str, schema: type[BaseModel], fields: list[str], text: str, image_png: bytes | None
    ) -> dict[str, Any] | None:
        return None

    async def visual_review(self, *, doc_type: str, image_png: bytes) -> LLMVisualReview | None:
        return None

    async def aclose(self) -> None:
        return None
