"""Paso 8: verificación de firma electrónica (fuera del MVP).

Punto de extensión: una implementación real verificaría firmas PAdES/CMS embebidas en el PDF o
el timbre electrónico (TED) del SII contra el CAF. Hoy siempre devuelve NOT_IMPLEMENTED.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from validator.pipeline.models import DocumentContent

SignatureStatus = Literal["NOT_IMPLEMENTED"]


@dataclass(frozen=True)
class SignatureResult:
    status: SignatureStatus

    def to_json(self) -> dict[str, str]:
        return {"status": self.status}


class SignatureVerifier(Protocol):
    def verify(self, doc: DocumentContent, data: bytes) -> SignatureResult: ...


class NotImplementedSignatureVerifier:
    def verify(self, doc: DocumentContent, data: bytes) -> SignatureResult:
        return SignatureResult(status="NOT_IMPLEMENTED")
