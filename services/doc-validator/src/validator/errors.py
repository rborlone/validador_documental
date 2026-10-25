"""Errores técnicos del procesamiento.

Un documento inválido NO es un error: termina en doc.validation.completed con veredicto INVALID.
Estos errores terminan en doc.validation.failed (tras reintentos si corresponde).
"""

from __future__ import annotations


class ProcessingError(Exception):
    """Error técnico. `retryable` indica si tiene sentido reintentar."""

    code = "PROCESSING_ERROR"
    retryable = True

    def __init__(self, message: str, *, code: str | None = None, retryable: bool | None = None):
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if retryable is not None:
            self.retryable = retryable


class UnsupportedFileError(ProcessingError):
    code = "UNSUPPORTED_FILE"
    retryable = False


class BlobNotFoundError(ProcessingError):
    code = "BLOB_NOT_FOUND"
    retryable = False


class InvalidMessageError(ProcessingError):
    code = "INVALID_MESSAGE"
    retryable = False
