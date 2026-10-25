"""Formatos chilenos: RUT (módulo 11), montos en pesos y fechas en español."""

from __future__ import annotations

import re
import unicodedata
from datetime import date

# ---------------------------------------------------------------- RUT

_RUT_CLEAN = re.compile(r"[^0-9kK]")


def rut_dv(body: int) -> str:
    """Dígito verificador por módulo 11 (serie 2..7)."""
    total, factor = 0, 2
    while body > 0:
        total += (body % 10) * factor
        body //= 10
        factor = 2 if factor == 7 else factor + 1
    rest = 11 - (total % 11)
    return {11: "0", 10: "K"}.get(rest, str(rest))


def split_rut(raw: str) -> tuple[int, str] | None:
    cleaned = _RUT_CLEAN.sub("", raw or "").upper()
    if len(cleaned) < 2 or not cleaned[:-1].isdigit():
        return None
    return int(cleaned[:-1]), cleaned[-1]


def is_valid_rut(raw: str) -> bool:
    parts = split_rut(raw)
    if parts is None:
        return False
    body, dv = parts
    return 1_000 <= body <= 99_999_999 and rut_dv(body) == dv


def format_rut(raw: str) -> str | None:
    """Normaliza a 12.345.678-5. No valida el dígito verificador."""
    parts = split_rut(raw)
    if parts is None:
        return None
    body, dv = parts
    return f"{body:,}".replace(",", ".") + f"-{dv}"


# ---------------------------------------------------------------- Montos

_AMOUNT_CHARS = re.compile(r"[^0-9.,\-]")


def parse_amount(raw: str | int | float | None) -> int | None:
    """Monto a pesos enteros (se redondea). Acepta '$ 1.234.567', '1.234,60' y '$58,816.00'.

    Con ambos separadores, el último es el decimal. Con uno solo, es de miles si agrupa de a
    tres dígitos (1.234 / 58,816) y decimal en otro caso (1234,5 / 0.00).
    """
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int | float):
        return round(raw)
    text = _AMOUNT_CHARS.sub("", str(raw))
    if not text or not any(ch.isdigit() for ch in text):
        return None
    negative = text.startswith("-")
    text = text.lstrip("-")
    decimal_sep = _decimal_separator(text)
    decimals = ""
    if decimal_sep:
        text, decimals = text.rsplit(decimal_sep, 1)
    integer = text.replace(".", "").replace(",", "")
    if not integer.isdigit():
        return None
    value = int(integer)
    if decimals.isdigit() and int(decimals[0]) >= 5:
        value += 1
    return -value if negative else value


def _decimal_separator(text: str) -> str | None:
    if "," in text and "." in text:
        return "," if text.rfind(",") > text.rfind(".") else "."
    for sep in (",", "."):
        if sep in text:
            return None if _THOUSANDS[sep].fullmatch(text) else sep
    return None


_THOUSANDS = {sep: re.compile(r"\d{1,3}(?:" + re.escape(sep) + r"\d{3})+") for sep in (",", ".")}


def format_amount(value: int) -> str:
    return "$" + f"{value:,}".replace(",", ".")


# ---------------------------------------------------------------- Fechas

MONTHS = {
    "enero": 1, "ene": 1,
    "febrero": 2, "feb": 2,
    "marzo": 3, "mar": 3,
    "abril": 4, "abr": 4,
    "mayo": 5, "may": 5,
    "junio": 6, "jun": 6,
    "julio": 7, "jul": 7,
    "agosto": 8, "ago": 8,
    "septiembre": 9, "setiembre": 9, "sep": 9, "sept": 9, "set": 9,
    "octubre": 10, "oct": 10,
    "noviembre": 11, "nov": 11,
    "diciembre": 12, "dic": 12,
}  # fmt: skip

_NUMERIC_DMY = re.compile(r"\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})\b")
_NUMERIC_YMD = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_NUMERIC_DEL = re.compile(r"\b(\d{1,2})\s+del?\s+(\d{1,2})\s+del?\s+(\d{4})\b")  # 28 del 08 del 2025
_TEXT_DATE = re.compile(
    r"\b(\d{1,2})\s*(?:de\s+|[-/]\s*)?([a-z]{3,10})\.?,?\s*(?:de(?:l)?\s+|[-/]\s*)?(\d{4})\b",
    re.IGNORECASE,
)

# Fragmento de regex reutilizable en templates: cualquier fecha soportada.
DATE_REGEX = (
    r"(?:\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4}"
    r"|\d{4}-\d{2}-\d{2}"
    r"|\d{1,2}\s+del?\s+\d{1,2}\s+del?\s+\d{4}"
    r"|\d{1,2}\s*(?:de\s+|[-/]\s*)?[A-Za-zÁÉÍÓÚáéíóú]{3,10}\.?,?\s*(?:del?\s+|[-/]\s*)?\d{4})"
)


def _strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def parse_date(raw: str | None) -> date | None:
    """Acepta dd-mm-aaaa, dd/mm/aaaa, aaaa-mm-dd, '15 de marzo de 2026', '15 MAR 2026',
    '07-AGO-2026' y '28 del 08 del 2025'."""
    if not raw:
        return None
    text = _strip_accents(str(raw)).strip().lower()
    try:
        if m := _NUMERIC_YMD.search(text):
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if m := _NUMERIC_DEL.search(text):
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        if m := _NUMERIC_DMY.search(text):
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        if m := _TEXT_DATE.search(text):
            month = MONTHS.get(m.group(2).lower())
            if month:
                return date(int(m.group(3)), month, int(m.group(1)))
    except ValueError:
        return None
    return None
