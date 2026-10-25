"""Certificado de accidentabilidad de una mutualidad (Mutual de Seguridad, ACHS, IST, ISL)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from validator.schemas._common import Fecha, Rut

_SERIE = "Valores por período separados por espacio, del más antiguo al más reciente, tal como aparecen"


class Schema(BaseModel):
    """Certificado de accidentabilidad."""

    model_config = ConfigDict(extra="forbid")

    numero_certificado: str | None = Field(None, description="Número, folio o código de verificación del certificado")
    organismo: str | None = Field(None, description="Mutualidad u organismo administrador que emite el certificado")
    empresa: str | None = Field(None, description="Razón social de la empresa certificada")
    rut_empresa: Rut | None = Field(None, description="RUT de la empresa, formato 12.345.678-5")
    numero_adherente: str | None = Field(None, description="Número de adherente, asociado o contrato en la mutualidad")
    fecha_emision: Fecha | None = Field(None, description="Fecha de emisión, aaaa-mm-dd")
    tasa_accidentabilidad: str | None = Field(None, description=f"Tasa de accidentabilidad. {_SERIE}")
    tasa_siniestralidad: str | None = Field(
        None, description=f"Tasa de siniestralidad por incapacidades temporales. {_SERIE}")
    tasa_frecuencia: str | None = Field(None, description=f"Tasa de frecuencia. {_SERIE}")
    tasa_gravedad: str | None = Field(None, description=f"Tasa de gravedad. {_SERIE}")
