import io

import numpy as np
import pymupdf
import pytest
from PIL import Image

from tests.conftest import FIXTURES, FakeLLM
from validator.llm.base import LLMVisualReview
from validator.pipeline import authenticity
from validator.pipeline.models import DocumentContent, Signal
from validator.pipeline.pdf_inspector import font_family, inspect_pdf, parse_pdf_date


def inspect(data: bytes) -> DocumentContent:
    return inspect_pdf(data, max_pages=20, dpi=72, min_text_chars=40)


def ids(signals) -> set[str]:
    return {s.id for s in signals}


def test_factura_valida_sin_senales() -> None:
    doc = inspect((FIXTURES / "factura_valida.pdf").read_bytes())
    assert authenticity.pdf_signals(doc, None) == []


def test_factura_editada_senales_de_metadatos() -> None:
    doc = inspect((FIXTURES / "factura_editada.pdf").read_bytes())
    assert doc.pdf is not None
    assert doc.pdf.incremental_updates == 1
    signals = authenticity.pdf_signals(doc, None)
    assert {"pdf.mod_date_differs", "pdf.editor_producer", "pdf.incremental_updates", "pdf.covered_text"} <= ids(
        signals
    )
    result = authenticity.combine(signals)
    assert result.level == "HIGH"
    # La extracción lee lo que se ve, no el texto tapado.
    assert "INVERSIONES PACÍFICO SPA" in doc.pages[0].text
    assert "COMERCIAL ANDES" not in doc.pages[0].text


def _pdf(draw) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    draw(page)
    data = doc.tobytes()
    doc.close()
    return data


def test_mezcla_de_fuentes_en_montos() -> None:
    def draw(page):
        page.insert_text((50, 100), "MONTO NETO $ 1.000.000", fontname="helv", fontsize=10)
        page.insert_text((50, 120), "I.V.A. 19% $ 190.000", fontname="helv", fontsize=10)
        page.insert_text((50, 140), "TOTAL", fontname="helv", fontsize=10)
        page.insert_text((150, 140), "$ 1.290.000", fontname="tiro", fontsize=10)

    signals = authenticity.pdf_signals(inspect(_pdf(draw)), None)
    assert "pdf.amount_font_mix" in ids(signals)


def test_misma_familia_en_negrita_no_es_senal() -> None:
    def draw(page):
        page.insert_text((50, 100), "MONTO NETO $ 1.000.000", fontname="helv", fontsize=10)
        page.insert_text((50, 140), "TOTAL $ 1.190.000", fontname="hebo", fontsize=10)

    assert "pdf.amount_font_mix" not in ids(authenticity.pdf_signals(inspect(_pdf(draw)), None))


def test_texto_invisible_con_cifras() -> None:
    def draw(page):
        page.insert_text((50, 100), "TOTAL $ 1.190.000", fontname="helv", fontsize=10)
        page.insert_text((50, 200), "TOTAL $ 9.990.000", fontname="helv", fontsize=10, render_mode=3)

    assert "pdf.hidden_text" in ids(authenticity.pdf_signals(inspect(_pdf(draw)), None))


def test_texto_embebido_distinto_del_render() -> None:
    doc = inspect((FIXTURES / "factura_valida.pdf").read_bytes())
    ocr_text = "TOTAL $ 9.999.999 NETO $ 8.888.888 IVA $ 7.777.777 RUT 11.111.111-1 FOLIO 123456"
    signals = authenticity.pdf_signals(doc, (ocr_text, 0.9))
    assert "pdf.text_vs_render" in ids(signals)
    # Con el OCR coherente no hay señal
    assert authenticity.pdf_signals(doc, (doc.pdf.page1_text_layer, 0.9)) == []


def test_fechas_pdf() -> None:
    d = parse_pdf_date("D:20260315103000-03'00'")
    assert d is not None and d.year == 2026 and d.utcoffset().total_seconds() == -3 * 3600
    assert parse_pdf_date("basura") is None


@pytest.mark.parametrize(
    ("name", "family"),
    [("ABCDEF+ArialMT", "arial"), ("Helvetica-Bold", "helvetica"), ("TimesNewRomanPS-BoldMT", "timesnewroman"),
     ("Arial,Bold", "arial")],
)
def test_familia_de_fuente(name: str, family: str) -> None:
    assert font_family(name) == family


def test_niveles_de_riesgo() -> None:
    assert authenticity.combine([]).level == "LOW"
    assert authenticity.combine([Signal("a", 0.25, "")]).level == "LOW"
    assert authenticity.combine([Signal("a", 0.25, ""), Signal("b", 0.25, "")]).level == "MEDIUM"
    high = authenticity.combine([Signal("a", 0.4, ""), Signal("b", 0.35, ""), Signal("c", 0.35, "")])
    assert high.level == "HIGH" and 0 < high.score < 1


def test_ela_escaneo_limpio_y_parche() -> None:
    scan = (FIXTURES / "factura_escaneada.jpg").read_bytes()
    ratio = authenticity.ela_score(scan)
    assert ratio is not None and ratio < authenticity.ELA_RATIO_THRESHOLD

    img = Image.open(io.BytesIO(scan)).convert("RGB")
    rng = np.random.default_rng(1)
    img.paste(Image.fromarray(rng.integers(0, 255, (200, 400, 3), dtype=np.uint8)), (900, 1200))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    assert authenticity.ela_score(buf.getvalue()) > authenticity.ELA_RATIO_THRESHOLD


async def test_revision_visual_llm_no_es_decisiva() -> None:
    doc = inspect((FIXTURES / "factura_valida.pdf").read_bytes())
    llm = FakeLLM(review=LLMVisualReview(True, 1.0, ["cifra del total con otra tipografía"]))
    result, used = await authenticity.assess(doc=doc, doc_type="factura_sii", llm=llm, visual_review="always",
                                             page1_ocr=None)
    assert used and llm.calls == ["visual_review"]
    assert ids(result.signals) == {"llm.visual_review"}
    assert result.level == "LOW"  # sola no alcanza para MEDIUM


async def test_revision_visual_solo_con_senales() -> None:
    doc = inspect((FIXTURES / "factura_valida.pdf").read_bytes())
    llm = FakeLLM(review=LLMVisualReview(False, 0.9, []))
    _, used = await authenticity.assess(doc=doc, doc_type="factura_sii", llm=llm, visual_review="on_signals",
                                        page1_ocr=None)
    assert not used and llm.calls == []


async def test_senal_informativa_no_dispara_revision_visual() -> None:
    """Un PDF concatenado varias veces solo genera una señal de peso 0: no justifica llamar al LLM."""
    data = (FIXTURES / "factura_valida.pdf").read_bytes()
    doc = inspect(data * 3)
    llm = FakeLLM(review=LLMVisualReview(False, 0.9, []))
    result, used = await authenticity.assess(doc=doc, doc_type="factura_sii", llm=llm, visual_review="on_signals",
                                             page1_ocr=None)
    assert ids(result.signals) == {"pdf.repeated_copies"}
    assert not used and llm.calls == []
