"""Paso 7: riesgo de falsificación (heurístico).

Combina señales independientes con un "OR ruidoso": score = 1 - Π(1 - peso_i).
Ninguna señal prueba una falsificación por sí sola; un puntaje alto significa "revisar a mano".

Señales:
- pdf.mod_date_differs: ModDate distinto de CreationDate.
- pdf.editor_producer: el productor/creador/XMP corresponde a un editor de PDF o de imágenes.
- pdf.incremental_updates: el archivo tiene actualizaciones incrementales (varios %%EOF/startxref).
- pdf.repeated_copies: el archivo es el mismo PDF concatenado varias veces (informativa, peso 0).
- pdf.text_over_scan: cifras escritas como texto encima de una página escaneada.
- pdf.amount_font_mix: las cifras en zonas de montos usan más de una familia de fuente.
- pdf.hidden_text: texto invisible con cifras en una página que también tiene texto visible.
- pdf.covered_text: texto tapado por rectángulos blancos dibujados encima.
- pdf.text_vs_render: las cifras del texto embebido no coinciden con el OCR de la página renderizada.
- image.editor_software: EXIF de la imagen indica un editor.
- image.ela: Error Level Analysis detecta una zona con nivel de compresión distinto.
- llm.visual_review: Claude ve indicios visuales (peso acotado: no es decisiva sola).
"""

from __future__ import annotations

import io
import logging
import re

import numpy as np
from PIL import Image

from validator.llm.base import LLMProvider
from validator.pipeline.models import AuthenticityResult, DocumentContent, Signal
from validator.pipeline.pdf_inspector import font_mix

log = logging.getLogger(__name__)

EDITORS = re.compile(
    r"acrobat(?!\s*distiller)(?:\s+pro|\s+standard|\s+dc)?|ilovepdf|smallpdf|sejda|pdfescape|pdf[-\s]?xchange"
    r"|foxit\s*(?:phantom|pdf\s*editor|editor)|nitro|pdfelement|wondershare|pdffiller|soda\s*pdf|pdf\s*candy"
    r"|photoshop|gimp|inkscape|canva|libreoffice\s*draw|master\s*pdf\s*editor|pdf\s*expert",
    re.IGNORECASE,
)

MEDIUM_THRESHOLD = 0.3
HIGH_THRESHOLD = 0.6
LLM_MAX_WEIGHT = 0.25
ELA_RATIO_THRESHOLD = 3.0
_NUMBER = re.compile(r"\d[\d.,]*\d|\d")


def combine(signals: list[Signal]) -> AuthenticityResult:
    remaining = 1.0
    for s in signals:
        remaining *= 1 - max(0.0, min(1.0, s.weight))
    score = round(1 - remaining, 4)
    level = "HIGH" if score >= HIGH_THRESHOLD else "MEDIUM" if score >= MEDIUM_THRESHOLD else "LOW"
    return AuthenticityResult(score=score, level=level, signals=signals)


def _numbers(text: str) -> set[str]:
    out = set()
    for token in _NUMBER.findall(text):
        digits = re.sub(r"\D", "", token)
        if len(digits) >= 3:
            out.add(digits)
    return out


def pdf_signals(doc: DocumentContent, page1_ocr: tuple[str, float] | None) -> list[Signal]:
    facts = doc.pdf
    if facts is None:
        return []
    signals: list[Signal] = []

    if facts.creation_date and facts.mod_date:
        delta = abs((facts.mod_date - facts.creation_date).total_seconds())
        if delta > 120:
            signals.append(Signal("pdf.mod_date_differs", 0.25,
                                  f"modificado {facts.mod_date.isoformat()} después de creado "
                                  f"{facts.creation_date.isoformat()}"))

    tools = " | ".join(v for k, v in facts.metadata.items() if k in ("producer", "creator"))
    hit = EDITORS.search(tools) or EDITORS.search(facts.xmp)
    if hit:
        signals.append(Signal("pdf.editor_producer", 0.35, f"generado o modificado con un editor: {hit.group(0)}"))

    if facts.repeated_copies > 1:
        signals.append(Signal("pdf.repeated_copies", 0.0,
                              f"el archivo contiene {facts.repeated_copies} copias idénticas del mismo PDF "
                              "concatenadas; no es una edición (revisar el sistema que lo exportó)"))

    if facts.digits_over_scan:
        signals.append(Signal("pdf.text_over_scan", 0.3,
                              f"{facts.digits_over_scan} cifras escritas como texto encima de una página escaneada "
                              "(puede ser un formulario completado o una alteración)"))

    if facts.incremental_updates:
        n = facts.incremental_updates
        signals.append(Signal("pdf.incremental_updates", min(0.45, 0.35 + 0.05 * (n - 1)),
                              f"{n} actualización(es) incremental(es) después de la versión original"))

    mix = font_mix(facts.amount_zone_fonts)
    if mix:
        majority, others = mix
        signals.append(Signal("pdf.amount_font_mix", 0.3,
                              f"cifras de montos con fuentes distintas: {majority} y {', '.join(others)}"))

    if facts.hidden_digit_chars:
        signals.append(Signal("pdf.hidden_text", 0.35,
                              f"{facts.hidden_digit_chars} cifras en texto invisible junto a texto visible"))

    if facts.covered_text_spans:
        signals.append(Signal("pdf.covered_text", 0.4,
                              f"{facts.covered_text_spans} fragmentos de texto tapados por rectángulos blancos"))

    if page1_ocr is not None:
        ocr_text, ocr_conf = page1_ocr
        embedded, rendered = _numbers(facts.page1_text_layer), _numbers(ocr_text)
        if ocr_conf >= 0.7 and len(embedded) >= 5:
            only_embedded = embedded - rendered
            only_rendered = rendered - embedded
            ratio = max(len(only_embedded) / len(embedded), len(only_rendered) / max(1, len(rendered)))
            if ratio > 0.3:
                signals.append(Signal(
                    "pdf.text_vs_render", 0.3,
                    f"{len(only_embedded)} cifras del texto embebido no se ven en la página renderizada y "
                    f"{len(only_rendered)} cifras visibles no están en el texto embebido",
                ))
    return signals


def ela_score(jpeg: bytes, quality: int = 90, block: int = 32) -> float | None:
    """Error Level Analysis: razón entre el bloque con más error de recompresión y la mediana.

    Solo se comparan bloques con contenido (texto/imagen): en un documento el fondo blanco casi
    no tiene error y haría que cualquier zona con texto pareciera anómala.
    """
    try:
        original = Image.open(io.BytesIO(jpeg)).convert("RGB")
    except Exception:  # noqa: BLE001 - imagen ilegible: sin señal
        return None
    if original.width < block * 4 or original.height < block * 4:
        return None
    buf = io.BytesIO()
    original.save(buf, "JPEG", quality=quality)
    recompressed = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    orig = np.asarray(original, np.int16)
    diff = np.abs(orig - np.asarray(recompressed, np.int16)).max(axis=2)
    gray = orig.mean(axis=2)
    h, w = (diff.shape[0] // block) * block, (diff.shape[1] // block) * block
    shape = (h // block, block, w // block, block)
    err = diff[:h, :w].reshape(shape).mean(axis=(1, 3))
    texture = gray[:h, :w].reshape(shape).std(axis=(1, 3))
    textured = err[texture > 12]
    if textured.size < 20:
        return None
    median = float(np.median(textured))
    peak = float(np.percentile(textured, 99.5))
    return peak / max(median, 0.5)


def image_signals(doc: DocumentContent) -> list[Signal]:
    signals: list[Signal] = []
    if doc.image_software and (hit := EDITORS.search(doc.image_software)):
        signals.append(Signal("image.editor_software", 0.35, f"EXIF indica edición con {hit.group(0)}"))
    for jpeg in doc.jpeg_samples[:3]:
        ratio = ela_score(jpeg)
        if ratio is not None and ratio > ELA_RATIO_THRESHOLD:
            signals.append(Signal("image.ela", 0.2,
                                  f"Error Level Analysis: zona con error de compresión {ratio:.1f}× la mediana"))
            break
    return signals


async def assess(
    *,
    doc: DocumentContent,
    doc_type: str,
    llm: LLMProvider,
    visual_review: str,
    page1_ocr: tuple[str, float] | None,
) -> tuple[AuthenticityResult, bool]:
    signals = pdf_signals(doc, page1_ocr) + image_signals(doc)
    llm_used = False
    # Las señales informativas (peso 0) no justifican una llamada.
    wants_llm = visual_review == "always" or (visual_review == "on_signals" and any(s.weight > 0 for s in signals))
    if wants_llm and llm.enabled and doc.preview_png:
        review = await llm.visual_review(doc_type=doc_type, image_png=doc.preview_png)
        if review is not None:
            llm_used = True
            if review.suspicious:
                reasons = "; ".join(review.reasons) or "indicios visuales de edición"
                signals.append(Signal("llm.visual_review", LLM_MAX_WEIGHT * review.confidence, reasons))
    return combine(signals), llm_used
