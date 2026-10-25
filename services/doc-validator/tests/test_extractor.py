from tests.conftest import FakeLLM, read_text
from validator.llm.base import DisabledLLM
from validator.pipeline.extractor import extract, extract_by_rules
from validator.pipeline.models import DocumentContent, PageContent
from validator.templates import TemplateRegistry


def doc_from_text(text: str, source: str = "text", confidence: float = 1.0) -> DocumentContent:
    return DocumentContent(mime="application/pdf",
                           pages=[PageContent(index=0, text=text, source=source, confidence=confidence)])


def values(fields):
    return {k: v.value for k, v in fields.items()}


def test_factura_ocr(registry: TemplateRegistry) -> None:
    fields = extract_by_rules(registry.get("factura_sii"), doc_from_text(read_text("factura_ocr.txt"), "ocr", 0.86))
    v = values(fields)
    assert v["folio"] == 4521
    assert v["rut_emisor"] == "76.123.456-0"
    assert v["rut_receptor"] == "77.654.321-7"
    assert v["razon_social_receptor"] == "COMERCIAL ANDES LIMITADA"
    assert v["fecha_emision"] == "2026-03-15"
    assert v["monto_neto"] == 1_000_000
    assert v["monto_exento"] == 0
    assert v["iva"] == 190_000
    assert v["monto_total"] == 1_190_000
    assert [line["total"] for line in v["lineas"]] == [700_000, 250_000, 50_000]
    assert v["lineas"][0]["precio_unitario"] == 350_000  # "S 350.000" leído por OCR
    assert fields["iva"].source == "ocr"
    assert 0.8 < fields["iva"].confidence < 0.86


def test_orden_compra(registry: TemplateRegistry) -> None:
    v = values(extract_by_rules(registry.get("orden_compra"), doc_from_text(read_text("orden_compra.txt"))))
    assert v["numero_oc"] == "OC-2026-0457"
    assert v["fecha_emision"] == "2026-03-10"
    assert v["fecha_entrega"] == "2026-03-20"
    assert v["rut_comprador"] == "77.654.321-7"
    assert v["rut_proveedor"] == "76.123.456-0"
    assert v["razon_social_proveedor"] == "ACME SERVICIOS SPA"
    assert v["condicion_pago"] == "30 días"
    assert (v["monto_neto"], v["iva"], v["monto_total"]) == (112_500, 21_375, 133_875)
    assert len(v["lineas"]) == 2


def test_certificado(registry: TemplateRegistry) -> None:
    v = values(extract_by_rules(registry.get("certificado_vigencia"), doc_from_text(read_text("certificado.txt"))))
    assert v["numero_certificado"] == "2026-004321"
    assert v["titular"] == "ACME SERVICIOS SPA"
    assert v["fecha_emision"] == "2026-10-01"
    assert v["fecha_vencimiento"] == "2026-12-31"
    assert v["codigo_verificacion"] == "CBR-1234-ABCD"
    assert v["emisor"].startswith("CONSERVADOR DE BIENES")


def test_cedula(registry: TemplateRegistry) -> None:
    v = values(extract_by_rules(registry.get("cedula_identidad"), doc_from_text(read_text("cedula.txt"))))
    assert v["run"] == "12.345.678-5"
    assert v["apellidos"] == "GONZÁLEZ PÉREZ"
    assert v["nombres"] == "MARÍA JOSÉ"
    assert v["nacionalidad"] == "CHILENA"
    assert v["sexo"] == "F"
    assert v["fecha_nacimiento"] == "1985-03-15"
    assert v["numero_documento"] == "523.456.789"
    assert v["fecha_emision"] == "2022-01-10"
    assert v["fecha_vencimiento"] == "2032-01-10"


def test_contrato(registry: TemplateRegistry) -> None:
    v = values(extract_by_rules(registry.get("contrato"), doc_from_text(read_text("contrato.txt"))))
    assert v["tipo_contrato"] == "CONTRATO DE PRESTACIÓN DE SERVICIOS"
    assert v["ciudad"] == "Santiago"
    assert v["fecha_celebracion"] == "2026-03-15"
    assert v["parte_1"] == "ACME SERVICIOS SPA"
    assert v["rut_parte_1"] == "76.123.456-0"
    assert v["parte_2"] == "COMERCIAL ANDES LIMITADA"
    assert v["rut_parte_2"] == "77.654.321-7"
    assert v["monto"] == 1_500_000
    assert v["fecha_termino"] == "2026-12-31"


async def test_campos_faltantes_se_completan_con_llm(registry: TemplateRegistry) -> None:
    text = read_text("factura_ocr.txt").replace("Fecha Emisién: 15 de marzo de 2026\n", "")
    llm = FakeLLM(extraction={"fecha_emision": "2026-03-15", "folio": 9999, "rut_receptor": None})
    out = await extract(template=registry.get("factura_sii"), doc=doc_from_text(text), llm=llm, min_conf=0.5)
    assert llm.calls == ["extract"]
    assert out.llm_used
    assert out.fields["fecha_emision"].value == "2026-03-15"
    assert out.fields["fecha_emision"].source == "llm"
    # Las reglas ganan cuando están seguras: el folio no se reemplaza.
    assert out.fields["folio"].value == 4521 and out.fields["folio"].source == "text"


async def test_sin_llm_no_rompe(registry: TemplateRegistry) -> None:
    out = await extract(template=registry.get("factura_sii"), doc=doc_from_text("texto sin datos"),
                        llm=DisabledLLM(), min_conf=0.5)
    assert out.fields == {}
    assert not out.llm_used


def test_orden_compra_formato_oracle(registry: TemplateRegistry) -> None:
    """Etiquetas con el valor en la línea siguiente, montos con coma de miles y meses abreviados."""
    v = values(extract_by_rules(registry.get("orden_compra"), doc_from_text(read_text("orden_compra_oracle.txt"))))
    assert v["numero_oc"] == "31415"
    assert v["fecha_emision"] == "2026-08-07"
    assert v["rut_comprador"] == "77.654.321-7"
    assert v["rut_proveedor"] == "76.123.456-0"
    assert v["razon_social_proveedor"] == "SERVICIOS DEL PACIFICO LTDA"
    assert v["condicion_pago"] == "30 Días"
    assert v["monto_neto"] == 125_400
    assert v["iva"] == 23_826  # no el 19 de "IVA 19%"
    assert v["monto_total"] == 149_226
    assert [line["total"] for line in v["lineas"]] == [125_400]


def _rules(registry: TemplateRegistry, template: str, text_file: str) -> dict:
    return values(extract_by_rules(registry.get(template), doc_from_text(read_text(text_file))))


def test_accidentabilidad_mutual(registry: TemplateRegistry) -> None:
    v = _rules(registry, "certificado_accidentabilidad", "accidentabilidad_mutual.txt")
    assert v["numero_certificado"] == "1700000000-123456"
    assert v["organismo"] == "Mutual de Seguridad"
    assert v["empresa"] == "SERVICIOS ANDINOS SPA"
    assert v["rut_empresa"] == "76.111.222-8"
    assert v["numero_adherente"] == "400123"
    assert v["fecha_emision"] == "2025-08-28"
    assert v["tasa_accidentabilidad"] == "1,20 0,00 2,30"
    assert v["tasa_siniestralidad"] == "10,50 0,00 22,10"
    assert v["tasa_frecuencia"] == "5,10 0,00 9,80"
    assert v["tasa_gravedad"] == "25,00 0,00 58,40"


def test_accidentabilidad_ist(registry: TemplateRegistry) -> None:
    """Valores de cada tasa en líneas separadas bajo la etiqueta."""
    v = _rules(registry, "certificado_accidentabilidad", "accidentabilidad_ist.txt")
    assert v["organismo"] == "INSTITUTO DE SEGURIDAD DEL TRABAJO"
    assert v["empresa"] == "ASESORÍAS DEL SUR LIMITADA"
    assert v["rut_empresa"] == "77.333.444-7"
    assert v["numero_adherente"] == "100200"
    assert v["fecha_emision"] == "2025-08-27"
    assert v["tasa_accidentabilidad"] == "0,00 0,50 0,00"
    assert v["tasa_siniestralidad"] == "0,00 4,00 0,00"


def test_accidentabilidad_achs(registry: TemplateRegistry) -> None:
    v = _rules(registry, "certificado_accidentabilidad", "accidentabilidad_achs.txt")
    assert v["numero_certificado"] == "10000001"
    assert v["organismo"] == "Asociación Chilena de Seguridad"  # no la Mutual mencionada en la carta
    assert v["empresa"] == "MINERA DEL NORTE LIMITADA"
    assert v["rut_empresa"] == "76.555.666-K"
    assert v["numero_adherente"] == "2000000001"
    assert v["fecha_emision"] == "2025-10-06"  # la del certificado, no la de la carta
    assert v["tasa_accidentabilidad"] == "0,51 0,22 0,82"
    assert v["tasa_siniestralidad"] == "62,13 10,18 37,17"


def test_carpeta_tributaria(registry: TemplateRegistry) -> None:
    v = _rules(registry, "carpeta_tributaria", "carpeta_tributaria.txt")
    assert v["tipo_carpeta"] == "REGULAR PARA SOLICITAR CRÉDITO"
    assert v["razon_social"] == "IMPRESIONES DEL VALLE SPA"
    assert v["rut"] == "78.777.888-7"
    assert v["fecha_generacion"] == "2025-10-02"
    assert v["fecha_inicio_actividades"] == "2025-04-08"
    assert v["regimen_tributario"] == "REGIMEN PRO PYME GENERAL (14D)"


def test_certificado_f30_1(registry: TemplateRegistry) -> None:
    v = _rules(registry, "certificado_f30", "f30_1.txt")
    assert v["titulo"].startswith("CERTIFICADO DE CUMPLIMIENTO DE OBLIGACIONES LABORALES")
    assert v["numero_certificado"] == "2025/123456"
    assert v["razon_social"] == "CONSTRUCTORA EJEMPLO SPA"
    assert v["rut_empleador"] == "76.999.000-3"
    assert v["fecha_emision"] == "2025-09-15"
    assert v["periodo"] == "Agosto 2025"
    assert v["trabajadores"] == 42
    assert v["codigo_verificacion"] == "ABCD-1234-EFGH"


def test_accidentabilidad_rut_leido_por_ocr_sin_guion(registry: TemplateRegistry) -> None:
    text = ("Certificado de Siniestralidad\nRazón Social EMPRESA DE PRUEBA SA\nRu 761112228\n"
            "Instituto de Seguridad Laboral")
    v = values(extract_by_rules(registry.get("certificado_accidentabilidad"), doc_from_text(text, "ocr", 0.85)))
    assert v["rut_empresa"] == "76.111.222-8"
    assert v["empresa"] == "EMPRESA DE PRUEBA SA"
    assert v["organismo"] == "Instituto de Seguridad Laboral"
