"""Certificado F30 / F30-1 de la Dirección del Trabajo."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from validator.schemas._common import Fecha, Rut


class Schema(BaseModel):
    """Certificado F30 o F30-1."""

    model_config = ConfigDict(extra="forbid")

    titulo: str | None = Field(
        None, description="Título del certificado (antecedentes laborales = F30; cumplimiento de obligaciones = F30-1)")
    numero_certificado: str | None = Field(None, description="Número o folio del certificado")
    razon_social: str | None = Field(None, description="Razón social del empleador")
    rut_empleador: Rut | None = Field(None, description="RUT del empleador, formato 12.345.678-5")
    fecha_emision: Fecha | None = Field(None, description="Fecha de emisión, aaaa-mm-dd")
    periodo: str | None = Field(None, description="Período informado o certificado, tal como aparece")
    trabajadores: int | None = Field(None, description="Número de trabajadores informados")
    codigo_verificacion: str | None = Field(None, description="Código de verificación en línea")
