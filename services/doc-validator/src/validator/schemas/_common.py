"""Tipos compartidos entre schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

Rut = str
Fecha = str  # ISO aaaa-mm-dd


class LineaDetalle(BaseModel):
    """Una línea del detalle de una factura u orden de compra."""

    model_config = ConfigDict(extra="forbid")

    cantidad: int | None = Field(None, description="Cantidad de unidades")
    descripcion: str | None = Field(None, description="Descripción del producto o servicio")
    precio_unitario: int | None = Field(None, description="Precio unitario en pesos, sin separadores")
    total: int | None = Field(None, description="Total de la línea en pesos, sin separadores")
