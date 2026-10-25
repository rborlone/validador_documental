"""Paso 5: extracción de campos según el template.

Primero regex/anclas del template sobre el texto de cada página. Los campos obligatorios que
faltan o salen con baja confianza se piden al LLM con el schema pydantic del tipo.
Cada campo queda como {value, source: text|ocr|llm, confidence}.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from validator.chile import format_rut, parse_amount, parse_date, split_rut
from validator.llm.base import LLMProvider
from validator.pipeline.models import DocumentContent, ExtractedField, PageContent
from validator.templates import FieldDef, Template, compile_pattern

log = logging.getLogger(__name__)

RULES_CONFIDENCE = 0.95  # regex sobre capa de texto; en OCR se multiplica por la confianza de la página
UNPARSED_CONFIDENCE = 0.3  # hubo coincidencia pero el valor no se pudo normalizar
LLM_CONFIDENCE = 0.75


def normalize(ftype: str, raw: Any) -> tuple[Any, bool]:
    """Devuelve (valor normalizado, ok). Si no se puede normalizar devuelve el texto crudo."""
    if raw is None:
        return None, False
    if ftype == "rut":
        formatted = format_rut(str(raw)) if split_rut(str(raw)) else None
        return (formatted, True) if formatted else (str(raw).strip(), False)
    if ftype == "date":
        parsed = parse_date(str(raw))
        return (parsed.isoformat(), True) if parsed else (str(raw).strip(), False)
    if ftype == "amount":
        value = parse_amount(raw)
        return (value, True) if value is not None else (str(raw).strip(), False)
    if ftype == "integer":
        if isinstance(raw, int) and not isinstance(raw, bool):
            return raw, True
        digits = re.sub(r"\D", "", str(raw))
        return (int(digits), True) if digits else (str(raw).strip(), False)
    text = re.sub(r"\s+", " ", str(raw)).strip()
    return (text, True) if text else (None, False)


def _page_confidence(page: PageContent) -> float:
    return 1.0 if page.source == "text" else max(0.0, min(1.0, page.confidence))


def _extract_scalar(field: FieldDef, pages: list[PageContent]) -> ExtractedField | None:
    matches: list[tuple[str, PageContent]] = []
    for regex in field.regexes:
        for page in pages:
            for m in regex.finditer(page.text):
                value = m.groupdict().get("value")
                if value is None and m.groups():
                    value = m.group(1)
                if value:
                    matches.append((value, page))
        if matches:
            break  # los patrones están en orden de preferencia
    if not matches:
        return None
    if field.occurrence == "last":
        raw, page = matches[-1]
    elif len(matches) >= field.occurrence:
        raw, page = matches[field.occurrence - 1]
    else:
        return None
    value, ok = normalize(field.type, raw)
    if value is None:
        return None
    confidence = (RULES_CONFIDENCE if ok else UNPARSED_CONFIDENCE) * _page_confidence(page)
    return ExtractedField(value=value, source=page.source, confidence=confidence)


def _section(text: str, field: FieldDef) -> str:
    if not field.section:
        return text
    if field.section.start:
        m = compile_pattern(field.section.start).search(text)
        if not m:
            return ""
        nl = text.find("\n", m.end())
        text = text[nl + 1:] if nl >= 0 else ""
    if field.section.end:
        m = compile_pattern(field.section.end).search(text)
        if m:
            text = text[: m.start()]
    return text


def _extract_lines(field: FieldDef, pages: list[PageContent]) -> ExtractedField | None:
    assert field.row_regex is not None
    rows: list[dict[str, Any]] = []
    confidences: list[float] = []
    for page in pages:
        for m in field.row_regex.finditer(_section(page.text, field)):
            row: dict[str, Any] = {}
            for col, ctype in field.columns.items():
                raw = m.groupdict().get(col)
                row[col] = normalize(ctype, raw)[0] if raw is not None else None
            rows.append(row)
            confidences.append(_page_confidence(page))
    if not rows:
        return None
    source = "ocr" if any(p.source == "ocr" for p in pages) else "text"
    return ExtractedField(value=rows, source=source, confidence=0.9 * min(confidences))


def extract_by_rules(template: Template, doc: DocumentContent) -> dict[str, ExtractedField]:
    out: dict[str, ExtractedField] = {}
    for field in template.fields:
        result = _extract_lines(field, doc.pages) if field.type == "lines" else _extract_scalar(field, doc.pages)
        if result is not None:
            out[field.name] = result
    return out


def fields_needing_llm(template: Template, fields: dict[str, ExtractedField], min_conf: float) -> list[str]:
    return [
        f.name for f in template.fields
        if f.required and (f.name not in fields or fields[f.name].confidence < min_conf)
    ]


def _normalize_llm_value(field: FieldDef, value: Any) -> Any:
    if value is None:
        return None
    if field.type == "lines":
        if not isinstance(value, list):
            return None
        rows = []
        for item in value:
            if isinstance(item, dict):
                rows.append({col: (normalize(ct, item.get(col))[0] if item.get(col) is not None else None)
                             for col, ct in field.columns.items()})
        return rows or None
    normalized, ok = normalize(field.type, value)
    return normalized if ok else None


@dataclass
class ExtractionOutcome:
    fields: dict[str, ExtractedField]
    llm_used: bool


async def extract(
    *, template: Template, doc: DocumentContent, llm: LLMProvider, min_conf: float
) -> ExtractionOutcome:
    fields = extract_by_rules(template, doc)
    pending = fields_needing_llm(template, fields, min_conf)
    if not pending or not llm.enabled:
        return ExtractionOutcome(fields, False)

    log.info("campos pendientes se piden al LLM", extra={"template": template.id, "fields": pending})
    data = await llm.extract(doc_type=template.id, schema=template.schema_model, fields=pending,
                             text=doc.full_text, image_png=doc.preview_png)
    if not data:
        return ExtractionOutcome(fields, False)

    used = False
    for field in template.fields:
        current = fields.get(field.name)
        if current is not None and current.confidence >= min_conf:
            continue  # las reglas ganan cuando están seguras
        value = _normalize_llm_value(field, data.get(field.name))
        if value is None:
            continue
        fields[field.name] = ExtractedField(value=value, source="llm", confidence=LLM_CONFIDENCE)
        used = True
    return ExtractionOutcome(fields, used)
