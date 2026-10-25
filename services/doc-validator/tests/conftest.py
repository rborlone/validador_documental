from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from validator.config import Settings
from validator.llm.base import LLMClassification, LLMVisualReview
from validator.pipeline import ocr
from validator.templates import TemplateRegistry

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
TEXTS = FIXTURES / "texts"
CONTRACTS = ROOT.parent.parent / "contracts"
TODAY = date(2026, 10, 24)

requires_ocr = pytest.mark.skipif(
    "spa" not in ocr.available_languages(),
    reason="Tesseract sin el idioma 'spa' (instalar tesseract-ocr-spa); se omiten los tests de OCR",
)
requires_contracts = pytest.mark.skipif(
    not CONTRACTS.exists(), reason="no se encuentra el directorio contracts/ del monorepo"
)


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(_env_file=None, llm_enabled=False, anthropic_api_key=None, templates_dir=ROOT / "templates")


@pytest.fixture(scope="session")
def registry(settings: Settings) -> TemplateRegistry:
    return TemplateRegistry.load(settings.templates_dir)


def read_text(name: str) -> str:
    return (TEXTS / name).read_text(encoding="utf-8")


class FakeLLM:
    """Proveedor LLM de prueba: respuestas fijas y registro de llamadas."""

    name = "fake"

    def __init__(
        self,
        classification: LLMClassification | None = None,
        extraction: dict[str, Any] | None = None,
        review: LLMVisualReview | None = None,
    ):
        self.classification = classification
        self.extraction = extraction
        self.review = review
        self.calls: list[str] = []

    @property
    def enabled(self) -> bool:
        return True

    async def classify(self, *, text: str, image_png: bytes | None) -> LLMClassification | None:
        self.calls.append("classify")
        return self.classification

    async def extract(self, *, doc_type: str, schema: type[BaseModel], fields: list[str], text: str,
                      image_png: bytes | None) -> dict[str, Any] | None:
        self.calls.append("extract")
        return self.extraction

    async def visual_review(self, *, doc_type: str, image_png: bytes) -> LLMVisualReview | None:
        self.calls.append("visual_review")
        return self.review

    async def aclose(self) -> None:
        return None
