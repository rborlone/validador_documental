"""Paso 9: arma el ValidationResult (contracts/validation-result.schema.json) y decide el veredicto."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from validator.llm.base import LLMCall
from validator.pipeline.models import AuthenticityResult, Check, ClassificationResult, ExtractedField
from validator.pipeline.signature import SignatureResult

Verdict = Literal["VALID", "INVALID", "REVIEW"]


@dataclass(frozen=True)
class VerdictPolicy:
    classifier_threshold: float
    field_min_confidence: float


def decide_verdict(
    *,
    checks: list[Check],
    authenticity: AuthenticityResult,
    classification: ClassificationResult,
    fields: dict[str, ExtractedField],
    required_fields: list[str],
    low_ocr: bool,
    policy: VerdictPolicy,
) -> tuple[Verdict, list[str]]:
    """INVALID si falla un check de severidad error; REVIEW si hay riesgo MEDIUM/HIGH, tipo
    desconocido o baja confianza; si no, VALID. Devuelve también los motivos (para logs)."""
    errors = [c.id for c in checks if not c.passed and c.severity == "error"]
    if errors:
        return "INVALID", errors
    reasons: list[str] = []
    if authenticity.level in ("MEDIUM", "HIGH"):
        reasons.append(f"riesgo de autenticidad {authenticity.level}")
    if classification.value == "desconocido":
        reasons.append("tipo desconocido")
    elif classification.confidence < policy.classifier_threshold:
        reasons.append("baja confianza en el tipo")
    low_fields = [n for n in required_fields if n in fields and fields[n].confidence < policy.field_min_confidence]
    if low_fields:
        reasons.append(f"campos con baja confianza: {', '.join(low_fields)}")
    if low_ocr:
        reasons.append("OCR con baja confianza")
    return ("REVIEW" if reasons else "VALID"), reasons


def build_result(
    *,
    document_id: str,
    classification: ClassificationResult,
    template_version: str | None,
    fields: dict[str, ExtractedField],
    checks: list[Check],
    authenticity: AuthenticityResult,
    signature: SignatureResult,
    verdict: Verdict,
    pages: int,
    text_source: str,
    llm_used: bool,
    processing_ms: int,
    llm_calls: list[LLMCall] | None = None,
) -> dict[str, Any]:
    return {
        "documentId": document_id,
        "documentType": classification.to_json(),
        "templateVersion": template_version,
        "extracted": {name: f.to_json() for name, f in fields.items()},
        "checks": [c.to_json() for c in checks],
        "authenticity": authenticity.to_json(),
        "signature": signature.to_json(),
        "verdict": verdict,
        "pages": max(1, pages),
        "textSource": text_source,
        "llmUsed": llm_used,
        "llmCalls": [c.to_json() for c in llm_calls or []],
        "processingMs": max(0, processing_ms),
    }
