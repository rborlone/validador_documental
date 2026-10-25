"""Genera los documentos de prueba (se versionan en el repo y se usan en el e2e).

Uso (desde services/doc-validator):  python tests/fixtures/generate.py

- factura_valida.pdf           Factura SII con capa de texto; totales correctos.
- factura_escaneada.jpg        La misma factura rasterizada, rotada ~1,5° y con ruido.
- factura_total_alterado.pdf   Factura "limpia" pero con el total inflado (falla totals.total).
- certificado_vencido.pdf      Certificado de vigencia emitido en enero de 2025, válido 30 días.
- factura_editada.pdf          factura_valida editada con un editor: rectángulos blancos tapando
                               texto, texto nuevo en otra fuente, actualización incremental,
                               Producer iLovePDF y ModDate distinto.
- orden_compra_valida.pdf      Orden de compra con totales correctos.
- documento_desconocido.pdf    Acta de reunión (no coincide con ningún template).
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
import pymupdf
from reportlab.lib.colors import Color, black
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "src"))

from validator.chile import format_amount, rut_dv  # noqa: E402


def rut(body: int) -> str:
    return f"{body:,}".replace(",", ".") + "-" + rut_dv(body)


EMISOR = ("ACME SERVICIOS SPA", rut(76_123_456))
RECEPTOR = ("COMERCIAL ANDES LIMITADA", rut(77_654_321))
RED = Color(0.75, 0.1, 0.1)

FACTURA_LINEAS = [
    (2, "Licencia software gestión documental anual", 350_000),
    (10, "Horas de soporte técnico", 25_000),
    (1, "Capacitación a usuarios", 50_000),
]
OC_LINEAS = [
    (5, "Resma papel carta 500 hojas", 4_500),
    (2, "Tóner impresora HP 85A", 45_000),
    (10, "Archivador lomo ancho", 2_750),
]


def _canvas(path: Path, title: str) -> Canvas:
    c = Canvas(str(path), pagesize=A4, invariant=1)  # invariant: PDF reproducible
    c.setTitle(title)
    c.setAuthor("Generador de fixtures doc-validator")
    return c


def _table(c: Canvas, y: float, header: tuple[str, str, str, str], rows: list[tuple[int, str, int]]) -> float:
    c.setFont("Helvetica-Bold", 9)
    c.line(40, y + 12, 555, y + 12)
    c.drawString(45, y, header[0])
    c.drawString(100, y, header[1])
    c.drawRightString(455, y, header[2])
    c.drawRightString(550, y, header[3])
    c.line(40, y - 5, 555, y - 5)
    c.setFont("Helvetica", 9)
    for qty, desc, price in rows:
        y -= 16
        c.drawString(45, y, str(qty))
        c.drawString(100, y, desc)
        c.drawRightString(455, y, format_amount(price).replace("$", "$ "))
        c.drawRightString(550, y, format_amount(qty * price).replace("$", "$ "))
    c.line(40, y - 8, 555, y - 8)
    return y - 30


def _totals(c: Canvas, y: float, rows: list[tuple[str, int]], bold_last: bool = True) -> float:
    for i, (label, value) in enumerate(rows):
        last = bold_last and i == len(rows) - 1
        c.setFont("Helvetica-Bold" if last else "Helvetica", 10)
        c.drawString(360, y, label)
        c.drawRightString(550, y, format_amount(value).replace("$", "$ "))
        y -= 16
    return y


def factura(path: Path, *, total_override: int | None = None) -> None:
    neto = sum(q * p for q, _, p in FACTURA_LINEAS)
    iva = round(neto * 0.19)
    total = neto + iva if total_override is None else total_override
    c = _canvas(path, "Factura electrónica 4521")

    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, 785, EMISOR[0])
    c.setFont("Helvetica", 9)
    c.drawString(40, 768, "Giro: Desarrollo de software y servicios informáticos")
    c.drawString(40, 752, "Av. Providencia 1234, Of. 501, Providencia, Santiago")
    c.drawString(40, 736, "Teléfono: +56 2 2345 6789")

    c.setStrokeColor(RED)
    c.setFillColor(RED)
    c.setLineWidth(2)
    c.rect(360, 725, 195, 80)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(457, 785, f"R.U.T.: {EMISOR[1]}")
    c.drawCentredString(457, 768, "FACTURA ELECTRÓNICA")
    c.drawCentredString(457, 752, "N° 4521")
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(457, 712, "S.I.I. - SANTIAGO ORIENTE")
    c.setFillColor(black)
    c.setStrokeColor(black)
    c.setLineWidth(1)

    c.setFont("Helvetica", 10)
    c.drawString(40, 685, "Fecha Emisión: 15 de marzo de 2026")
    c.drawString(40, 667, f"Señor(es): {RECEPTOR[0]}")
    c.drawString(40, 652, f"R.U.T.: {RECEPTOR[1]}")
    c.drawString(40, 637, "Giro: Comercio al por mayor de artículos de oficina")
    c.drawString(40, 622, "Dirección: Av. Apoquindo 4500, Las Condes, Santiago")
    c.drawString(40, 607, "Condición de venta: Crédito 30 días")

    y = _table(c, 575, ("Cantidad", "Descripción", "Precio Unitario", "Total"), FACTURA_LINEAS)
    y = _totals(c, y, [("MONTO NETO", neto), ("MONTO EXENTO", 0), ("I.V.A. 19%", iva), ("TOTAL", total)])

    # Timbre electrónico (simulado como un código de barras PDF417).
    rng = np.random.default_rng(7)
    x0, y0 = 60, 230
    for row in range(18):
        for col in range(60):
            if rng.random() > 0.5:
                c.rect(x0 + col * 3.5, y0 + row * 3, 3.5, 3, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(60, 215, "Timbre Electrónico SII")
    c.setFont("Helvetica", 8)
    c.drawString(60, 203, "Res. 80 de 2014 - Verifique documento: www.sii.cl")
    c.showPage()
    c.save()


def orden_compra(path: Path) -> None:
    neto = sum(q * p for q, _, p in OC_LINEAS)
    iva = round(neto * 0.19)
    c = _canvas(path, "Orden de compra OC-2026-0457")
    c.setFont("Helvetica-Bold", 13)
    c.drawString(40, 790, RECEPTOR[0])
    c.setFont("Helvetica", 9)
    c.drawString(40, 775, "Av. Apoquindo 4500, Las Condes, Santiago")
    c.setFont("Helvetica-Bold", 16)
    c.drawString(40, 740, "ORDEN DE COMPRA N° OC-2026-0457")
    c.setFont("Helvetica", 10)
    lines = [
        "Fecha: 10-03-2026",
        f"Comprador: {RECEPTOR[0]}   RUT: {RECEPTOR[1]}",
        f"Proveedor: {EMISOR[0]}   RUT: {EMISOR[1]}",
        "Fecha de entrega: 20-03-2026",
        "Condición de pago: 30 días",
        "Dirección de despacho: Av. Apoquindo 4500, Las Condes",
    ]
    y = 715
    for line in lines:
        c.drawString(40, y, line)
        y -= 16
    y = _table(c, y - 20, ("Cant.", "Descripción", "P. Unitario", "Total"), OC_LINEAS)
    _totals(c, y, [("Neto:", neto), ("IVA (19%):", iva), ("Total:", neto + iva)])
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(40, 120, "Favor indicar el número de esta orden de compra en la factura.")
    c.drawString(40, 108, "Facturar a: Comercial Andes Limitada. Aprobado por: Jefatura de Compras.")
    c.showPage()
    c.save()


def certificado_vencido(path: Path) -> None:
    c = _canvas(path, "Certificado de vigencia")
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(297, 790, "CONSERVADOR DE BIENES RAÍCES DE SANTIAGO")
    c.setFont("Helvetica", 9)
    c.drawCentredString(297, 775, "Registro de Comercio")
    c.setFont("Helvetica-Bold", 15)
    c.drawCentredString(297, 730, "CERTIFICADO DE VIGENCIA")
    c.setFont("Helvetica", 10)
    c.drawCentredString(297, 712, "Certificado N° 2025-001234")
    body = [
        f"Sociedad: {EMISOR[0]}",
        f"RUT: {EMISOR[1]}",
        "El Conservador que suscribe certifica que la sociedad individualizada se encuentra",
        "inscrita a fojas 12.345 número 6.789 del Registro de Comercio de Santiago del año 2019,",
        "y que a la fecha de este certificado su inscripción se encuentra vigente.",
        "",
        "Emitido el 10 de enero de 2025",
        "Válido por 30 días desde su fecha de emisión.",
        "",
        "Código de verificación: CBR-7F3A-91KD",
        "Verifique este documento en www.conservador.cl",
    ]
    y = 670
    for line in body:
        c.drawString(60, y, line)
        y -= 18
    c.showPage()
    c.save()


def desconocido(path: Path) -> None:
    c = _canvas(path, "Acta de reunión")
    c.setFont("Helvetica-Bold", 14)
    c.drawString(60, 780, "ACTA DE REUNIÓN DEL COMITÉ DE BIENESTAR")
    c.setFont("Helvetica", 10)
    body = [
        "Lugar: Sala 3, edificio corporativo.",
        "Asistentes: M. Rojas, P. Soto, C. Fuentes.",
        "Temas tratados:",
        "1. Organización del paseo de fin de año.",
        "2. Renovación de la cafetera del tercer piso.",
        "3. Calendario de actividades deportivas.",
        "Acuerdos: se cotizarán tres alternativas para el paseo y se informará por correo.",
        "Próxima reunión: primer lunes del mes.",
    ]
    y = 750
    for line in body:
        c.drawString(60, y, line)
        y -= 18
    c.showPage()
    c.save()


def escaneada(src_pdf: Path, path: Path) -> None:
    """Rasteriza a 200 dpi, rota ~1,5°, agrega ruido y guarda como JPEG (como un escaneo)."""
    with pymupdf.open(src_pdf) as doc:
        pix = doc[0].get_pixmap(dpi=200, colorspace=pymupdf.csGRAY)
        gray = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width).copy()
    h, w = gray.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), 1.5, 1.0)
    rotated = cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_LINEAR, borderValue=245)
    rng = np.random.default_rng(42)
    noisy = rotated.astype(np.int16) + rng.normal(0, 10, rotated.shape).astype(np.int16) - 8
    specks = rng.random(rotated.shape)
    noisy[specks < 0.0015] = 30
    out = np.clip(noisy, 0, 255).astype(np.uint8)
    cv2.imwrite(str(path), out, [cv2.IMWRITE_JPEG_QUALITY, 82])


def editada(src_pdf: Path, path: Path) -> None:
    """Simula una edición con un editor de PDF: tapa texto con blanco y escribe encima."""
    shutil.copyfile(src_pdf, path)
    doc = pymupdf.open(path)
    page = doc[0]
    replacements = [
        (RECEPTOR[0], "INVERSIONES PACÍFICO SPA"),
        ("15 de marzo de 2026", "15 de abril de 2026"),
    ]
    for old, new in replacements:
        for rect in page.search_for(old):
            cover = pymupdf.Rect(rect.x0 - 1, rect.y0 - 1, rect.x1 + 1, rect.y1 + 1)
            page.draw_rect(cover, color=(1, 1, 1), fill=(1, 1, 1))
            page.insert_text((rect.x0, rect.y1 - 2), new, fontname="tiro", fontsize=10)
    meta = doc.metadata or {}
    meta.update(producer="iLovePDF", modDate="D:20260420143000-03'00'")
    doc.set_metadata(meta)
    doc.saveIncr()
    doc.close()


def main() -> None:
    out = HERE
    factura(out / "factura_valida.pdf")
    factura(out / "factura_total_alterado.pdf", total_override=1_290_000)
    escaneada(out / "factura_valida.pdf", out / "factura_escaneada.jpg")
    editada(out / "factura_valida.pdf", out / "factura_editada.pdf")
    certificado_vencido(out / "certificado_vencido.pdf")
    orden_compra(out / "orden_compra_valida.pdf")
    desconocido(out / "documento_desconocido.pdf")
    for f in sorted(out.iterdir()):
        if f.suffix in (".pdf", ".jpg"):
            print(f"{f.name}: {f.stat().st_size} bytes")


if __name__ == "__main__":
    main()
