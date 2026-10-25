"""Cédula de identidad chilena (Registro Civil)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from validator.schemas._common import Fecha, Rut


class Schema(BaseModel):
    """Cédula de identidad chilena."""

    model_config = ConfigDict(extra="forbid")

    run: Rut | None = Field(None, description="RUN del titular, formato 12.345.678-5")
    apellidos: str | None = Field(None, description="Apellidos")
    nombres: str | None = Field(None, description="Nombres")
    nacionalidad: str | None = Field(None, description="Nacionalidad")
    sexo: str | None = Field(None, description="Sexo (M/F)")
    fecha_nacimiento: Fecha | None = Field(None, description="Fecha de nacimiento, aaaa-mm-dd")
    numero_documento: str | None = Field(None, description="Número de documento (serie)")
    fecha_emision: Fecha | None = Field(None, description="Fecha de emisión, aaaa-mm-dd")
    fecha_vencimiento: Fecha | None = Field(None, description="Fecha de vencimiento, aaaa-mm-dd")
