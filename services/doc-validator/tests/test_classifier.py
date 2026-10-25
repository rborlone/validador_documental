import pytest

from tests.conftest import FakeLLM, read_text
from validator.llm.base import DisabledLLM, LLMClassification
from validator.pipeline.classifier import classify, classify_by_rules
from validator.templates import TemplateRegistry


@pytest.mark.parametrize(
    ("text_file", "expected"),
    [
        ("factura_ocr.txt", "factura_sii"),
        ("orden_compra.txt", "orden_compra"),
        ("certificado.txt", "certificado_vigencia"),
        ("cedula.txt", "cedula_identidad"),
        ("contrato.txt", "contrato"),
        ("accidentabilidad_mutual.txt", "certificado_accidentabilidad"),
        ("accidentabilidad_ist.txt", "certificado_accidentabilidad"),
        ("accidentabilidad_achs.txt", "certificado_accidentabilidad"),
        ("carpeta_tributaria.txt", "carpeta_tributaria"),
        ("f30_1.txt", "certificado_f30"),
    ],
)
def test_clasifica_por_reglas(registry: TemplateRegistry, text_file: str, expected: str) -> None:
    result = classify_by_rules(registry, read_text(text_file))
    assert result.value == expected
    assert result.method == "rules"
    assert result.confidence >= 0.6, result.scores


async def test_desconocido_sin_llm(registry: TemplateRegistry) -> None:
    out = await classify(registry=registry, text=read_text("desconocido.txt"), preview_png=None,
                         expected_type=None, llm=DisabledLLM(), threshold=0.6, floor=0.3)
    assert out.result.value == "desconocido"
    assert out.llm_used is False


async def test_baja_confianza_usa_llm(registry: TemplateRegistry) -> None:
    llm = FakeLLM(classification=LLMClassification("contrato", 0.82, "cláusulas y partes"))
    out = await classify(registry=registry, text=read_text("desconocido.txt"), preview_png=b"png",
                         expected_type=None, llm=llm, threshold=0.6, floor=0.3)
    assert llm.calls == ["classify"]
    assert out.result.value == "contrato"
    assert out.result.method == "llm"
    assert out.llm_used


async def test_alta_confianza_no_llama_al_llm(registry: TemplateRegistry) -> None:
    llm = FakeLLM(classification=LLMClassification("contrato", 0.9, "x"))
    out = await classify(registry=registry, text=read_text("factura_ocr.txt"), preview_png=None,
                         expected_type=None, llm=llm, threshold=0.6, floor=0.3)
    assert llm.calls == []
    assert out.result.value == "factura_sii"


async def test_llm_falla_cae_a_reglas(registry: TemplateRegistry) -> None:
    llm = FakeLLM(classification=None)  # error/timeout del proveedor
    out = await classify(registry=registry, text=read_text("desconocido.txt"), preview_png=None,
                         expected_type=None, llm=llm, threshold=0.6, floor=0.3)
    assert out.result.value == "desconocido"
    assert out.result.method == "rules"
    assert not out.llm_used


async def test_tipo_esperado_coincide(registry: TemplateRegistry) -> None:
    out = await classify(registry=registry, text=read_text("orden_compra.txt"), preview_png=None,
                         expected_type="orden_compra", llm=DisabledLLM(), threshold=0.6, floor=0.3)
    assert out.result.method == "expected"
    assert out.result.value == "orden_compra"
    [check] = out.checks
    assert check.id == "type.matches_expected" and check.passed


async def test_tipo_esperado_no_coincide(registry: TemplateRegistry) -> None:
    out = await classify(registry=registry, text=read_text("factura_ocr.txt"), preview_png=None,
                         expected_type="cedula_identidad", llm=DisabledLLM(), threshold=0.6, floor=0.3)
    assert out.result.method == "expected"
    assert out.result.value == "cedula_identidad"
    [check] = out.checks
    assert not check.passed and check.severity == "error"
    assert "factura_sii" in check.detail


async def test_tipo_esperado_inconcluso_es_warning(registry: TemplateRegistry) -> None:
    out = await classify(registry=registry, text=read_text("desconocido.txt"), preview_png=None,
                         expected_type="contrato", llm=DisabledLLM(), threshold=0.6, floor=0.3)
    [check] = out.checks
    assert not check.passed and check.severity == "warning"
