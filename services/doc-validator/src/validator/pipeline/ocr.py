"""Paso 3: OCR con preprocesamiento OpenCV (enderezado, limpieza y binarización) + Tesseract."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

import cv2
import numpy as np
import pytesseract

from validator.pipeline.layout import words_to_lines

log = logging.getLogger(__name__)

MIN_WIDTH_FOR_OCR = 1600  # bajo este ancho se amplía (imágenes de baja resolución)


@dataclass
class OcrResult:
    text: str
    confidence: float  # 0..1, promedio ponderado por largo de palabra
    words: int


@lru_cache
def available_languages() -> frozenset[str]:
    try:
        return frozenset(pytesseract.get_languages(config=""))
    except Exception:  # noqa: BLE001 - binario ausente u otro error del sistema
        log.warning("Tesseract no está disponible; el OCR queda deshabilitado")
        return frozenset()


def resolve_lang(requested: str) -> str | None:
    """Filtra los idiomas pedidos a los instalados. None si no queda ninguno."""
    langs = available_languages()
    usable = [lang for lang in requested.split("+") if lang in langs]
    missing = [lang for lang in requested.split("+") if lang not in langs]
    if missing and langs:
        log.warning("faltan idiomas de Tesseract", extra={"missing": missing, "available": sorted(langs)})
    return "+".join(usable) if usable else None


def estimate_skew(gray: np.ndarray, max_angle: float = 8.0) -> float:
    """Ángulo de inclinación (grados) por perfil de proyección horizontal.

    Se busca el ángulo que maximiza la varianza de la suma por filas: con el texto derecho,
    las filas de texto y los espacios entre ellas producen picos marcados.
    """
    h, w = gray.shape[:2]
    scale = 1000 / max(h, w)
    small = cv2.resize(gray, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    _, inv = cv2.threshold(small, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    center = (inv.shape[1] / 2, inv.shape[0] / 2)

    def score(angle: float) -> float:
        m = cv2.getRotationMatrix2D(center, angle, 1.0)
        rotated = cv2.warpAffine(inv, m, (inv.shape[1], inv.shape[0]), flags=cv2.INTER_NEAREST)
        return float(np.var(rotated.sum(axis=1, dtype=np.float64)))

    coarse = np.arange(-max_angle, max_angle + 0.01, 0.5)
    best = max(coarse, key=score)
    fine = np.arange(best - 0.5, best + 0.51, 0.1)
    return float(max(fine, key=score))


def rotate(gray: np.ndarray, angle: float) -> np.ndarray:
    h, w = gray.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    return cv2.warpAffine(gray, m, (nw, nh), flags=cv2.INTER_CUBIC, borderValue=255)


def preprocess(gray: np.ndarray) -> np.ndarray:
    if gray.ndim == 3:
        gray = cv2.cvtColor(gray, cv2.COLOR_RGB2GRAY)
    if gray.shape[1] < MIN_WIDTH_FOR_OCR:
        factor = MIN_WIDTH_FOR_OCR / gray.shape[1]
        gray = cv2.resize(gray, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
    angle = estimate_skew(gray)
    if abs(angle) >= 0.2:
        gray = rotate(gray, angle)
    # Limpieza de ruido sal y pimienta conservando bordes; luego binarización adaptativa
    # (tolera iluminación desigual de fotos y escaneos).
    denoised = cv2.medianBlur(gray, 3)
    binary = cv2.adaptiveThreshold(denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15)
    return binary


def run_ocr(gray: np.ndarray, lang: str) -> OcrResult:
    image = preprocess(gray)
    data = pytesseract.image_to_data(
        image, lang=lang, config="--oem 1 --psm 3 -c preserve_interword_spaces=1",
        output_type=pytesseract.Output.DICT,
    )
    boxes: list[tuple] = []
    weighted, total_chars = 0.0, 0
    for i, word in enumerate(data["text"]):
        word = (word or "").strip()
        conf = float(data["conf"][i])
        if not word or conf < 0:
            continue
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        boxes.append((x, y, x + w, y + h, word))
        weighted += conf * len(word)
        total_chars += len(word)
    # Misma reconstrucción por filas que la capa de texto del PDF: los templates ven un formato único.
    text = words_to_lines(boxes)
    confidence = (weighted / total_chars / 100) if total_chars else 0.0
    return OcrResult(text=text, confidence=round(confidence, 4), words=len(boxes))
