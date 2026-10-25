"""Estructuras que fluyen entre los pasos del pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

import numpy as np

TextSource = Literal["text", "ocr"]
Severity = Literal["error", "warning"]


@dataclass
class PageContent:
    index: int
    text: str = ""
    source: TextSource = "text"
    confidence: float = 1.0  # 1.0 para capa de texto; promedio de Tesseract (0-1) para OCR
    image: np.ndarray | None = None  # escala de grises; render a OCR_DPI o la imagen original
    needs_ocr: bool = False


@dataclass
class PdfForensics:
    """Hechos crudos del PDF; authenticity los convierte en señales."""

    metadata: dict[str, str] = field(default_factory=dict)
    creation_date: datetime | None = None
    mod_date: datetime | None = None
    xmp: str = ""
    eof_count: int = 1
    startxref_count: int = 1
    linearized: bool = False
    repeated_copies: int = 1  # el archivo es N copias idénticas concatenadas (no es una edición)
    digits_over_scan: int = 0  # cifras de texto visible escrito sobre una página escaneada
    amount_zone_fonts: list[str] = field(default_factory=list)  # familias de fuente de los montos
    hidden_digit_chars: int = 0  # texto invisible con dígitos en páginas con texto visible
    covered_text_spans: int = 0  # texto tapado por rectángulos blancos dibujados encima
    page1_text_layer: str = ""  # para comparar con el OCR del render

    @property
    def incremental_updates(self) -> int:
        expected = 2 if self.linearized else 1
        return max(0, max(self.eof_count, self.startxref_count) - expected)


@dataclass
class DocumentContent:
    mime: str
    pages: list[PageContent]
    pdf: PdfForensics | None = None
    preview_png: bytes | None = None  # 1ª página reducida, para el LLM
    jpeg_samples: list[bytes] = field(default_factory=list)  # para Error Level Analysis
    image_software: str | None = None  # EXIF Software de imágenes subidas

    @property
    def page_count(self) -> int:
        return len(self.pages)

    @property
    def full_text(self) -> str:
        return "\n\f\n".join(p.text for p in self.pages)

    @property
    def text_source(self) -> Literal["text", "ocr", "mixed"]:
        sources = {p.source for p in self.pages}
        if sources == {"text"}:
            return "text"
        if sources == {"ocr"}:
            return "ocr"
        return "mixed"

    @property
    def mean_ocr_confidence(self) -> float | None:
        values = [p.confidence for p in self.pages if p.source == "ocr" and p.text.strip()]
        return sum(values) / len(values) if values else None


@dataclass
class ExtractedField:
    value: Any
    source: Literal["text", "ocr", "llm"]
    confidence: float

    def to_json(self) -> dict[str, Any]:
        return {"value": self.value, "source": self.source, "confidence": round(self.confidence, 3)}


@dataclass
class Check:
    id: str
    passed: bool
    severity: Severity
    detail: str

    def to_json(self) -> dict[str, Any]:
        return {"id": self.id, "passed": self.passed, "severity": self.severity, "detail": self.detail}


@dataclass
class Signal:
    id: str
    weight: float
    detail: str

    def to_json(self) -> dict[str, Any]:
        return {"id": self.id, "weight": round(self.weight, 3), "detail": self.detail}


@dataclass
class ClassificationResult:
    value: str
    confidence: float
    method: Literal["rules", "llm", "expected"]
    reason: str | None = None
    scores: dict[str, float] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "confidence": round(min(1.0, max(0.0, self.confidence)), 3),
            "method": self.method,
            "reason": self.reason,
        }


@dataclass
class AuthenticityResult:
    score: float
    level: Literal["LOW", "MEDIUM", "HIGH"]
    signals: list[Signal]

    def to_json(self) -> dict[str, Any]:
        return {
            "score": round(self.score, 3),
            "level": self.level,
            "signals": [s.to_json() for s in self.signals],
        }
