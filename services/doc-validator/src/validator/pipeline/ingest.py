"""Paso 1: validar el archivo recibido (tamaño y tipo real por magic bytes).

Se detectan las firmas a mano para no depender de libmagic en la imagen.
"""

from __future__ import annotations

import logging

from validator.errors import UnsupportedFileError

log = logging.getLogger(__name__)

SUPPORTED = ("application/pdf", "image/png", "image/jpeg", "image/tiff")


def detect_mime(data: bytes) -> str | None:
    head = data[:1024]
    # Algunos PDF traen basura antes de la cabecera; la especificación tolera hasta 1024 bytes.
    if b"%PDF-" in head:
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"II*\x00", b"MM\x00*")):
        return "image/tiff"
    return None


def ingest(data: bytes, declared_type: str, *, max_bytes: int) -> str:
    """Devuelve el MIME real. Lanza UnsupportedFileError si no se puede procesar."""
    if not data:
        raise UnsupportedFileError("el archivo está vacío")
    if len(data) > max_bytes:
        raise UnsupportedFileError(f"el archivo supera el máximo permitido ({max_bytes // (1024 * 1024)} MB)")
    mime = detect_mime(data)
    if mime is None:
        raise UnsupportedFileError("tipo de archivo no soportado (se aceptan PDF, PNG, JPEG y TIFF)")
    if mime != declared_type:
        # No es fatal: se procesa según el tipo real, pero queda registrado.
        log.warning("el tipo declarado no coincide con el real", extra={"declared": declared_type, "real": mime})
    return mime
