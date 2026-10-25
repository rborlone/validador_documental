"""Carpeta tributaria electrónica del SII."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from validator.schemas._common import Fecha, Rut


class Schema(BaseModel):
    """Carpeta tributaria."""

    model_config = ConfigDict(extra="forbid")

    tipo_carpeta: str | None = Field(None, description="Tipo de carpeta, p. ej. 'REGULAR PARA SOLICITAR CRÉDITO'")
    razon_social: str | None = Field(None, description="Nombre o razón social del contribuyente")
    rut: Rut | None = Field(None, description="RUT del contribuyente, formato 12.345.678-5")
    fecha_generacion: Fecha | None = Field(None, description="Fecha de generación de la carpeta, aaaa-mm-dd")
    fecha_inicio_actividades: Fecha | None = Field(None, description="Fecha de inicio de actividades, aaaa-mm-dd")
    clasificacion_entidad: str | None = Field(
        None, description="Clasificación de la entidad, p. ej. SOCIEDAD POR ACCIONES")
    actividades_economicas: str | None = Field(None, description="Descripción de las actividades económicas")
    categoria_tributaria: str | None = Field(None, description="Categoría tributaria")
    regimen_tributario: str | None = Field(None, description="Régimen tributario")
    domicilio: str | None = Field(None, description="Domicilio tributario")
