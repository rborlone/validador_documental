"""Descarga de documentos desde Azure Blob Storage (Azurite en local)."""

from __future__ import annotations

import logging
from typing import Protocol

from azure.core.exceptions import AzureError, ResourceNotFoundError
from azure.storage.blob.aio import BlobServiceClient

from validator.config import Settings
from validator.errors import BlobNotFoundError, ProcessingError, UnsupportedFileError

log = logging.getLogger(__name__)


class BlobReader(Protocol):
    async def download(self, container: str, blob_name: str) -> bytes: ...

    async def close(self) -> None: ...


class AzureBlobReader:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._credential = None
        # Los reintentos largos los maneja la cola retry; el SDK solo reintenta fallas breves.
        opts = {
            "retry_total": settings.blob_retry_total,
            "connection_timeout": settings.blob_connection_timeout_s,
            "read_timeout": settings.blob_read_timeout_s,
        }
        if settings.azure_storage_connection_string:
            self._client = BlobServiceClient.from_connection_string(settings.azure_storage_connection_string, **opts)
        elif settings.azure_storage_account_url:
            # AKS: Workload Identity, sin secretos en el chart.
            from azure.identity.aio import DefaultAzureCredential

            self._credential = DefaultAzureCredential()
            self._client = BlobServiceClient(settings.azure_storage_account_url, credential=self._credential, **opts)
        else:
            raise ValueError("falta AZURE_STORAGE_CONNECTION_STRING o AZURE_STORAGE_ACCOUNT_URL")

    async def download(self, container: str, blob_name: str) -> bytes:
        allowed = self._settings.blob_container
        if allowed and container != allowed:
            raise ProcessingError(f"contenedor no permitido: {container}", code="INVALID_MESSAGE", retryable=False)
        blob = self._client.get_blob_client(container=container, blob=blob_name)
        try:
            props = await blob.get_blob_properties()
            if props.size > self._settings.max_file_bytes:
                raise UnsupportedFileError(
                    f"el archivo supera el máximo permitido ({self._settings.max_file_size_mb} MB)"
                )
            stream = await blob.download_blob()
            data = await stream.readall()
        except ResourceNotFoundError as exc:
            raise BlobNotFoundError("el archivo no existe en el almacenamiento") from exc
        except AzureError as exc:
            # Errores de red/servicio: se reintenta.
            raise ProcessingError(f"error descargando el archivo: {type(exc).__name__}", code="STORAGE_ERROR") from exc
        log.info("archivo descargado", extra={"bytes": len(data)})
        return data

    async def close(self) -> None:
        await self._client.close()
        if self._credential is not None:
            await self._credential.close()
