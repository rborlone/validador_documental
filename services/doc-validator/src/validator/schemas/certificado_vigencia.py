"""Certificado de vigencia (sociedad, poderes, etc.) con fecha de emisión y validez."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from validator.schemas._common import Fecha, Rut


class Schema(BaseModel):
    """Certificado de vigencia."""

    model_config = ConfigDict(extra="forbid")

    numero_certificado: str | None = Field(None, description="Número o folio del certificado")
    emisor: str | None = Field(None, description="Institución que emite el certificado")
    titular: str | None = Field(None, description="Sociedad o persona a la que se refiere el certificado")
    rut_titular: Rut | None = Field(None, description="RUT del titular, formato 12.345.678-5")
    fecha_emision: Fecha | None = Field(None, description="Fecha de emisión, aaaa-mm-dd")
    fecha_vencimiento: Fecha | None = Field(None, description="Fecha de vencimiento si aparece, aaaa-mm-dd")
    validez_dias: int | None = Field(None, description="Días de validez declarados en el certificado")
    codigo_verificacion: str | None = Field(None, description="Código de verificación en línea")
