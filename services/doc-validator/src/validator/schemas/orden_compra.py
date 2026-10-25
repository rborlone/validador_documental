"""Orden de compra emitida por una empresa a un proveedor."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from validator.schemas._common import Fecha, LineaDetalle, Rut


class Schema(BaseModel):
    """Orden de compra."""

    model_config = ConfigDict(extra="forbid")

    numero_oc: str | None = Field(None, description="Número de la orden de compra")
    fecha_emision: Fecha | None = Field(None, description="Fecha de emisión en formato aaaa-mm-dd")
    fecha_entrega: Fecha | None = Field(None, description="Fecha de entrega comprometida, aaaa-mm-dd")
    rut_comprador: Rut | None = Field(None, description="RUT de la empresa compradora")
    razon_social_comprador: str | None = Field(None, description="Razón social del comprador")
    rut_proveedor: Rut | None = Field(None, description="RUT del proveedor")
    razon_social_proveedor: str | None = Field(None, description="Razón social del proveedor")
    condicion_pago: str | None = Field(None, description="Condición de pago, p. ej. '30 días'")
    lineas: list[LineaDetalle] | None = Field(None, description="Líneas de la orden")
    monto_neto: int | None = Field(None, description="Monto neto en pesos")
    iva: int | None = Field(None, description="IVA (19%) en pesos")
    monto_total: int | None = Field(None, description="Total en pesos")
