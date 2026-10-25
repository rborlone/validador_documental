"""Contrato entre dos partes (prestación de servicios, arriendo, trabajo, etc.)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from validator.schemas._common import Fecha, Rut


class Schema(BaseModel):
    """Contrato."""

    model_config = ConfigDict(extra="forbid")

    tipo_contrato: str | None = Field(None, description="Título o tipo del contrato")
    ciudad: str | None = Field(None, description="Ciudad donde se celebra")
    fecha_celebracion: Fecha | None = Field(None, description="Fecha de celebración, aaaa-mm-dd")
    parte_1: str | None = Field(None, description="Nombre de la primera parte")
    rut_parte_1: Rut | None = Field(None, description="RUT de la primera parte")
    parte_2: str | None = Field(None, description="Nombre de la segunda parte")
    rut_parte_2: Rut | None = Field(None, description="RUT de la segunda parte")
    monto: int | None = Field(None, description="Monto o precio pactado en pesos, si aplica")
    fecha_termino: Fecha | None = Field(None, description="Fecha de término del contrato si aparece, aaaa-mm-dd")
