from datetime import date

import pytest

from validator.pipeline.models import ExtractedField
from validator.pipeline.rules import evaluate, iva_of
from validator.templates import TemplateRegistry

TODAY = date(2026, 10, 24)


def f(value, source="text", confidence=0.95) -> ExtractedField:
    return ExtractedField(value=value, source=source, confidence=confidence)


def factura_fields(**overrides) -> dict[str, ExtractedField]:
    fields = {
        "folio": f(4521),
        "rut_emisor": f("76.123.456-0"),
        "rut_receptor": f("77.654.321-7"),
        "fecha_emision": f("2026-03-15"),
        "lineas": f([
            {"cantidad": 2, "descripcion": "Licencia", "precio_unitario": 350_000, "total": 700_000},
            {"cantidad": 10, "descripcion": "Soporte", "precio_unitario": 25_000, "total": 250_000},
            {"cantidad": 1, "descripcion": "Capacitación", "precio_unitario": 50_000, "total": 50_000},
        ]),
        "monto_neto": f(1_000_000),
        "monto_exento": f(0),
        "iva": f(190_000),
        "monto_total": f(1_190_000),
    }
    fields.update({k: f(v) for k, v in overrides.items()})
    return fields


def by_id(checks):
    return {c.id: c for c in checks}


def test_iva_redondeo() -> None:
    assert iva_of(1_000_000, 0.19) == 190_000
    assert iva_of(112_500, 0.19) == 21_375
    assert iva_of(1_003, 0.19) == 191  # 190,57 -> 191


def test_factura_correcta_pasa_todo(registry: TemplateRegistry) -> None:
    checks = evaluate(registry.get("factura_sii"), factura_fields(), TODAY)
    failed = [c for c in checks if not c.passed]
    assert failed == []
    ids = by_id(checks)
    assert {"totals.lineas", "totals.iva", "totals.total", "rut.emisor", "rut.receptor"} <= ids.keys()


def test_total_alterado_falla(registry: TemplateRegistry) -> None:
    checks = by_id(evaluate(registry.get("factura_sii"), factura_fields(monto_total=1_290_000), TODAY))
    assert not checks["totals.total"].passed
    assert checks["totals.total"].severity == "error"
    assert checks["totals.iva"].passed


@pytest.mark.parametrize(("iva", "ok"), [(190_000, True), (190_001, True), (189_999, True), (190_002, False)])
def test_iva_tolerancia_un_peso(registry: TemplateRegistry, iva: int, ok: bool) -> None:
    checks = by_id(evaluate(registry.get("factura_sii"),
                            factura_fields(iva=iva, monto_total=1_000_000 + iva), TODAY))
    assert checks["totals.iva"].passed is ok
    assert checks["totals.total"].passed


def test_suma_de_lineas_distinta_del_neto(registry: TemplateRegistry) -> None:
    checks = by_id(evaluate(registry.get("factura_sii"),
                            factura_fields(monto_neto=900_000, iva=171_000, monto_total=1_071_000), TODAY))
    assert not checks["totals.lineas"].passed
    assert checks["totals.iva"].passed and checks["totals.total"].passed


def test_linea_mal_multiplicada_es_warning(registry: TemplateRegistry) -> None:
    fields = factura_fields()
    fields["lineas"].value[1]["precio_unitario"] = 30_000
    checks = by_id(evaluate(registry.get("factura_sii"), fields, TODAY))
    assert not checks["totals.lineas_items"].passed
    assert checks["totals.lineas_items"].severity == "warning"


def test_exento_suma_al_total(registry: TemplateRegistry) -> None:
    checks = by_id(evaluate(registry.get("factura_sii"),
                            factura_fields(monto_exento=50_000, monto_total=1_240_000), TODAY))
    assert checks["totals.total"].passed


def test_rut_invalido_y_obligatorio_faltante(registry: TemplateRegistry) -> None:
    fields = factura_fields(rut_emisor="76.123.456-9")
    del fields["iva"]
    checks = by_id(evaluate(registry.get("factura_sii"), fields, TODAY))
    assert not checks["rut.emisor"].passed
    assert not checks["required.iva"].passed
    # Sin IVA no se emite totals.iva (ya lo informa required.iva)
    assert "totals.iva" not in checks


def test_vigencia_por_dias_de_validez(registry: TemplateRegistry) -> None:
    t = registry.get("certificado_vigencia")
    base = {"titular": f("ACME"), "fecha_emision": f("2026-10-01"), "validez_dias": f(30)}
    vigente = by_id(evaluate(t, base, TODAY))["vigencia"]
    assert vigente.passed and "2026-10-31" in vigente.detail

    vencido = by_id(evaluate(t, {**base, "fecha_emision": f("2025-01-10")}, TODAY))["vigencia"]
    assert not vencido.passed and vencido.severity == "error"


def test_vigencia_usa_dias_por_defecto(registry: TemplateRegistry) -> None:
    t = registry.get("certificado_vigencia")
    vigente = by_id(evaluate(t, {"titular": f("ACME"), "fecha_emision": f("2026-09-30")}, TODAY))["vigencia"]
    assert vigente.passed and "+ 30 días" in vigente.detail  # vence 2026-10-30
    vencido = by_id(evaluate(t, {"titular": f("ACME"), "fecha_emision": f("2026-09-20")}, TODAY))["vigencia"]
    assert not vencido.passed


def test_vigencia_por_fecha_de_vencimiento(registry: TemplateRegistry) -> None:
    t = registry.get("cedula_identidad")
    ok = by_id(evaluate(t, {"run": f("12.345.678-5"), "apellidos": f("X"), "nombres": f("Y"),
                            "fecha_vencimiento": f("2032-01-10")}, TODAY))
    assert ok["vigencia"].passed
    hoy = by_id(evaluate(t, {"fecha_vencimiento": f("2026-10-24")}, TODAY))
    assert hoy["vigencia"].passed  # vence hoy: todavía vigente
    ayer = by_id(evaluate(t, {"fecha_vencimiento": f("2026-10-23")}, TODAY))
    assert not ayer["vigencia"].passed


def test_vigencia_opcional_en_contrato(registry: TemplateRegistry) -> None:
    t = registry.get("contrato")
    checks = by_id(evaluate(t, {"fecha_celebracion": f("2026-03-15"), "rut_parte_1": f("76.123.456-0")}, TODAY))
    assert "vigencia" not in checks
    assert "rut.parte_2" not in checks


def test_fecha_futura_es_warning(registry: TemplateRegistry) -> None:
    checks = by_id(evaluate(registry.get("factura_sii"), factura_fields(fecha_emision="2027-01-01"), TODAY))
    assert not checks["fecha.emision_no_futura"].passed
    assert checks["fecha.emision_no_futura"].severity == "warning"
