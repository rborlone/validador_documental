"""Orquestador del pipeline: ingest → inspector → OCR → clasificador → extractor → reglas →
autenticidad → firma → resultado.

Los pasos de CPU (PyMuPDF, OpenCV, Tesseract) corren en hilos para no bloquear el event loop
(heartbeats de AMQP, health checks). Las llamadas al LLM son asíncronas.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from validator.config import Settings
from validator.llm.base import LLMProvider, current_calls, start_recording, stop_recording
from validator.pipeline import authenticity, classifier, extractor, ingest, ocr, pdf_inspector, rules
from validator.pipeline.models import Check, DocumentContent
from validator.pipeline.result import VerdictPolicy, build_result, decide_verdict
from validator.pipeline.signature import NotImplementedSignatureVerifier, SignatureVerifier
from validator.templates import TemplateRegistry

log = logging.getLogger(__name__)


class Pipeline:
    def __init__(
        self,
        *,
        settings: Settings,
        registry: TemplateRegistry,
        llm: LLMProvider,
        signature_verifier: SignatureVerifier | None = None,
        today: Callable[[], date] | None = None,
    ):
        self.settings = settings
        self.registry = registry
        self.llm = llm
        self.signature_verifier = signature_verifier or NotImplementedSignatureVerifier()
        self._today = today or (lambda: datetime.now(ZoneInfo(settings.timezone)).date())
        self.policy = VerdictPolicy(settings.classifier_threshold, settings.field_min_confidence)

    async def _ocr_pages(self, doc: DocumentContent, checks: list[Check]) -> tuple[str, float] | None:
        """OCR de las páginas sin texto. Devuelve además el OCR de la 1ª página renderizada cuando
        tiene capa de texto (para comparar texto embebido vs lo que se ve)."""
        lang = ocr.resolve_lang(self.settings.ocr_lang)
        needs = [p for p in doc.pages if p.needs_ocr]
        if lang is None:
            if needs:
                checks.append(Check("ocr.disponible", False, "warning",
                                    "OCR no disponible: no se pudo leer el texto de las páginas escaneadas"))
            return None
        for page in needs:
            if page.image is None:
                continue
            res = await asyncio.to_thread(ocr.run_ocr, page.image, lang)
            page.text, page.confidence, page.source = res.text, res.confidence, "ocr"
        page1_ocr = None
        first = doc.pages[0] if doc.pages else None
        if doc.pdf is not None and first is not None and not first.needs_ocr and first.image is not None:
            res = await asyncio.to_thread(ocr.run_ocr, first.image, lang)
            page1_ocr = (res.text, res.confidence)
        for page in doc.pages:  # las imágenes a 300 dpi pesan; no se necesitan más
            page.image = None
        return page1_ocr

    async def run(
        self,
        *,
        document_id: str,
        data: bytes,
        declared_type: str,
        expected_type: str | None = None,
        started: float | None = None,
    ) -> dict[str, Any]:
        token = start_recording()
        try:
            return await self._run(document_id=document_id, data=data, declared_type=declared_type,
                                   expected_type=expected_type, started=started)
        finally:
            stop_recording(token)

    async def _run(
        self, *, document_id: str, data: bytes, declared_type: str, expected_type: str | None, started: float | None,
    ) -> dict[str, Any]:
        started = started if started is not None else time.perf_counter()
        s = self.settings
        checks: list[Check] = []

        mime = ingest.ingest(data, declared_type, max_bytes=s.max_file_bytes)
        if mime != declared_type:
            checks.append(Check("file.declared_type", False, "warning",
                                f"se declaró {declared_type} pero el contenido es {mime}"))

        doc = await asyncio.to_thread(
            pdf_inspector.inspect, data, mime, max_pages=s.max_pages, dpi=s.ocr_dpi,
            min_text_chars=s.min_text_chars_per_page,
        )
        page1_ocr = await self._ocr_pages(doc, checks)
        low_ocr = False
        if (mean := doc.mean_ocr_confidence) is not None and mean < s.ocr_min_confidence:
            low_ocr = True
            checks.append(Check("ocr.confidence", False, "warning", f"confianza promedio del OCR {mean:.0%}"))

        text = doc.full_text
        cls = await classifier.classify(
            registry=self.registry, text=text, preview_png=doc.preview_png, expected_type=expected_type,
            llm=self.llm, threshold=s.classifier_threshold, floor=s.classifier_floor,
        )
        checks.extend(cls.checks)
        llm_used = cls.llm_used

        template = self.registry.get(cls.result.value)
        fields: dict = {}
        required: list[str] = []
        if template is not None:
            ext = await extractor.extract(template=template, doc=doc, llm=self.llm, min_conf=s.field_min_confidence)
            fields = ext.fields
            llm_used = llm_used or ext.llm_used
            checks.extend(rules.evaluate(template, fields, self._today()))
            required = [f.name for f in template.fields if f.required]

        auth, auth_llm = await authenticity.assess(
            doc=doc, doc_type=cls.result.value, llm=self.llm, visual_review=s.llm_visual_review, page1_ocr=page1_ocr,
        )
        llm_used = llm_used or auth_llm
        signature = self.signature_verifier.verify(doc, data)

        verdict, reasons = decide_verdict(
            checks=checks, authenticity=auth, classification=cls.result, fields=fields,
            required_fields=required, low_ocr=low_ocr, policy=self.policy,
        )
        processing_ms = round((time.perf_counter() - started) * 1000)
        log.info(
            "documento validado",
            extra={
                "documentType": cls.result.value, "method": cls.result.method, "verdict": verdict,
                "reasons": reasons, "pages": doc.page_count, "textSource": doc.text_source,
                "authenticity": auth.level, "llmUsed": llm_used, "processingMs": processing_ms,
            },
        )
        return build_result(
            document_id=document_id,
            classification=cls.result,
            template_version=template.version if template else None,
            fields=fields,
            checks=checks,
            authenticity=auth,
            signature=signature,
            verdict=verdict,
            pages=doc.page_count,
            text_source=doc.text_source,
            llm_used=llm_used,
            processing_ms=processing_ms,
            llm_calls=current_calls(),
        )
