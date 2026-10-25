"""Pipeline completo sobre los fixtures, con el LLM deshabilitado."""

import json
import uuid

import pytest

from tests.conftest import CONTRACTS, FIXTURES, TODAY, requires_contracts, requires_ocr
from validator.errors import UnsupportedFileError
from validator.llm.base import DisabledLLM
from validator.pipeline import ocr
from validator.pipeline.runner import Pipeline


@pytest.fixture
def pipeline(settings, registry) -> Pipeline:
    return Pipeline(settings=settings, registry=registry, llm=DisabledLLM(), today=lambda: TODAY)


def result_validator():
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((CONTRACTS / "validation-result.schema.json").read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())


async def run(pipeline: Pipeline, name: str, mime: str = "application/pdf", expected: str | None = None) -> dict:
    data = (FIXTURES / name).read_bytes()
    return await pipeline.run(document_id=str(uuid.uuid4()), data=data, declared_type=mime, expected_type=expected)


def failed(result: dict) -> dict[str, dict]:
    return {c["id"]: c for c in result["checks"] if not c["passed"]}


@requires_contracts
@pytest.mark.parametrize(
    "name",
    ["factura_valida.pdf", "factura_total_alterado.pdf", "certificado_vencido.pdf", "factura_editada.pdf",
     "orden_compra_valida.pdf", "documento_desconocido.pdf"],
)
async def test_resultado_cumple_el_contrato(pipeline: Pipeline, name: str) -> None:
    result = await run(pipeline, name)
    errors = sorted(result_validator().iter_errors(result), key=str)
    assert not errors, [e.message for e in errors]


async def test_factura_valida(pipeline: Pipeline) -> None:
    r = await run(pipeline, "factura_valida.pdf")
    assert r["verdict"] == "VALID", failed(r)
    assert r["documentType"]["value"] == "factura_sii" and r["documentType"]["method"] == "rules"
    assert r["textSource"] == "text" and r["pages"] == 1
    assert r["extracted"]["monto_total"]["value"] == 1_190_000
    assert r["authenticity"]["level"] == "LOW"
    assert r["signature"] == {"status": "NOT_IMPLEMENTED"}
    assert r["llmUsed"] is False
    assert r["templateVersion"] == "1.0.0"


async def test_factura_total_alterado(pipeline: Pipeline) -> None:
    r = await run(pipeline, "factura_total_alterado.pdf")
    assert r["verdict"] == "INVALID"
    assert "totals.total" in failed(r)


async def test_certificado_vencido(pipeline: Pipeline) -> None:
    r = await run(pipeline, "certificado_vencido.pdf")
    assert r["documentType"]["value"] == "certificado_vigencia"
    assert r["verdict"] == "INVALID"
    assert "vigencia" in failed(r)


async def test_pdf_editado_riesgo_alto(pipeline: Pipeline) -> None:
    r = await run(pipeline, "factura_editada.pdf")
    assert r["authenticity"]["level"] in ("MEDIUM", "HIGH")
    assert r["verdict"] == "REVIEW"


async def test_orden_compra_valida(pipeline: Pipeline) -> None:
    r = await run(pipeline, "orden_compra_valida.pdf", expected="orden_compra")
    assert r["verdict"] == "VALID", failed(r)
    assert r["documentType"]["method"] == "expected"
    assert any(c["id"] == "type.matches_expected" and c["passed"] for c in r["checks"])


async def test_tipo_esperado_distinto_invalida(pipeline: Pipeline) -> None:
    r = await run(pipeline, "orden_compra_valida.pdf", expected="factura_sii")
    assert r["verdict"] == "INVALID"
    assert "type.matches_expected" in failed(r)


async def test_documento_desconocido_queda_en_revision(pipeline: Pipeline) -> None:
    r = await run(pipeline, "documento_desconocido.pdf")
    assert r["documentType"]["value"] == "desconocido"
    assert r["templateVersion"] is None and r["extracted"] == {}
    assert r["verdict"] == "REVIEW"


async def test_tipo_declarado_distinto_es_warning(pipeline: Pipeline) -> None:
    r = await run(pipeline, "factura_valida.pdf", mime="image/png")
    assert failed(r)["file.declared_type"]["severity"] == "warning"
    assert r["verdict"] == "VALID"


async def test_archivo_no_soportado(pipeline: Pipeline) -> None:
    with pytest.raises(UnsupportedFileError):
        await pipeline.run(document_id=str(uuid.uuid4()), data=b"GIF89a....", declared_type="image/png")


async def test_escaneo_sin_ocr_no_rompe(pipeline: Pipeline, monkeypatch) -> None:
    monkeypatch.setattr(ocr, "resolve_lang", lambda _lang: None)
    r = await run(pipeline, "factura_escaneada.jpg", mime="image/jpeg")
    assert "ocr.disponible" in failed(r)
    assert r["verdict"] in ("REVIEW", "INVALID")


@requires_ocr
async def test_factura_escaneada_ocr(pipeline: Pipeline) -> None:
    r = await run(pipeline, "factura_escaneada.jpg", mime="image/jpeg")
    assert r["textSource"] == "ocr"
    assert r["documentType"]["value"] == "factura_sii"
    assert r["extracted"]["monto_total"]["value"] == 1_190_000
    assert r["extracted"]["monto_total"]["source"] == "ocr"
    assert r["verdict"] == "VALID", failed(r)
