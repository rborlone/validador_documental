"""Paso 4: clasificación del tipo de documento.

1. Reglas del template: cada keyword que aparece suma su peso; la confianza es el peso
   encontrado sobre el peso total del template.
2. Si la mejor confianza es menor al umbral y hay LLM: Claude con la 1ª página + texto.
3. Si viene expectedType: method="expected", pero igual se verifica la coincidencia y se
   agrega el check `type.matches_expected`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from validator.llm.base import LLMProvider
from validator.pipeline.models import Check, ClassificationResult
from validator.templates import Template, TemplateRegistry

log = logging.getLogger(__name__)

UNKNOWN = "desconocido"


def score_template(template: Template, text: str) -> float:
    total = sum(k.weight for k in template.classification.keywords)
    found = sum(k.weight for k in template.classification.keywords if k.regex.search(text))
    return found / total if total else 0.0


def score_all(registry: TemplateRegistry, text: str) -> dict[str, float]:
    return {t.id: round(score_template(t, text), 4) for t in registry.all()}


def classify_by_rules(registry: TemplateRegistry, text: str) -> ClassificationResult:
    scores = score_all(registry, text)
    best = max(scores, key=lambda k: scores[k]) if scores else UNKNOWN
    ranked = sorted(scores.values(), reverse=True)
    confidence = scores.get(best, 0.0)
    # Si dos tipos empatan de cerca, la clasificación es ambigua: se castiga la confianza.
    if len(ranked) > 1 and ranked[0] - ranked[1] < 0.15:
        confidence *= 0.8
    return ClassificationResult(value=best, confidence=confidence, method="rules",
                                reason=f"palabras clave del template ({scores.get(best, 0):.0%})", scores=scores)


@dataclass
class ClassifierOutcome:
    result: ClassificationResult
    checks: list[Check]
    llm_used: bool


async def classify(
    *,
    registry: TemplateRegistry,
    text: str,
    preview_png: bytes | None,
    expected_type: str | None,
    llm: LLMProvider,
    threshold: float,
    floor: float,
) -> ClassifierOutcome:
    rules = classify_by_rules(registry, text)
    detected = rules
    llm_used = False

    if rules.confidence < threshold and llm.enabled:
        llm_result = await llm.classify(text=text, image_png=preview_png)
        if llm_result is not None:
            llm_used = True
            detected = ClassificationResult(value=llm_result.type, confidence=llm_result.confidence,
                                            method="llm", reason=llm_result.reason, scores=rules.scores)

    if detected.method == "rules" and detected.confidence < floor:
        detected = ClassificationResult(value=UNKNOWN, confidence=1 - detected.confidence, method="rules",
                                        reason="ningún template coincide lo suficiente", scores=rules.scores)

    if not expected_type or expected_type == UNKNOWN or registry.get(expected_type) is None:
        return ClassifierOutcome(detected, [], llm_used)

    # --- Tipo esperado indicado por el usuario
    expected_score = rules.scores.get(expected_type, 0.0)
    detected_is_confident = detected.value != UNKNOWN and detected.confidence >= threshold
    if detected.value == expected_type:
        check = Check("type.matches_expected", True, "error",
                      f"el documento coincide con el tipo esperado ({detected.method}, {detected.confidence:.0%})")
        confidence = max(detected.confidence, expected_score)
    elif detected_is_confident:
        check = Check("type.matches_expected", False, "error",
                      f"se esperaba {expected_type} pero el documento parece {detected.value} "
                      f"({detected.method}, {detected.confidence:.0%})")
        confidence = expected_score
    else:
        check = Check("type.matches_expected", False, "warning",
                      f"no se pudo confirmar que el documento sea {expected_type} "
                      f"(coincidencia {expected_score:.0%})")
        confidence = expected_score

    result = ClassificationResult(
        value=expected_type, confidence=confidence, method="expected",
        reason=f"tipo indicado al subir; detectado: {detected.value} ({detected.method})", scores=rules.scores,
    )
    return ClassifierOutcome(result, [check], llm_used)
