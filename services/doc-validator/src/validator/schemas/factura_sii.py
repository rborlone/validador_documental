"""Factura electrónica emitida según el formato del SII (DTE tipo 33/34)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from validator.schemas._common import Fecha, LineaDetalle, Rut


class Schema(BaseModel):
    """Factura electrónica chilena (SII)."""

    model_config = ConfigDict(extra="forbid")

    folio: int | None = Field(None, description="Número de folio de la factura")
    rut_emisor: Rut | None = Field(None, description="RUT del emisor, formato 12.345.678-5")
    razon_social_emisor: str | None = Field(None, description="Razón social del emisor")
    rut_receptor: Rut | None = Field(None, description="RUT del receptor (Señor(es)), formato 12.345.678-5")
    razon_social_receptor: str | None = Field(None, description="Razón social del receptor")
    fecha_emision: Fecha | None = Field(None, description="Fecha de emisión en formato aaaa-mm-dd")
    lineas: list[LineaDetalle] | None = Field(None, description="Líneas del detalle")
    monto_neto: int | None = Field(None, description="Monto neto en pesos")
    monto_exento: int | None = Field(None, description="Monto exento en pesos (0 si no aparece)")
    iva: int | None = Field(None, description="IVA (19%) en pesos")
    monto_total: int | None = Field(None, description="Total en pesos")
