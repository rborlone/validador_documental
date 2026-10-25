import io

from validator.pipeline.pdf_inspector import _span_words


def _span(*runs: tuple[str, float, float], size: float = 8.0) -> dict:
    """Span de texttrace con caracteres de ancho fijo; cada run es (texto, x inicial, y base)."""
    chars = []
    for text, x, y in runs:
        for i, c in enumerate(text):
            x0 = x + i * size * 0.6
            chars.append((ord(c), 0, (x0, y), (x0, y - size, x0 + size * 0.6, y + size * 0.2)))
    return {"size": size, "chars": chars}


def texts(span: dict) -> list[str]:
    return [w[4] for w in _span_words(span, [])[0]]


def test_corta_palabras_en_lineas_distintas_del_mismo_span() -> None:
    # Oracle Publisher escribe "FECHA" y debajo la fecha en el mismo span, sin espacio.
    assert texts(_span(("FECHA", 275.0, 57.0), ("07-AGO-2026", 264.0, 67.0))) == ["FECHA", "07-AGO-2026"]


def test_corta_palabras_separadas_por_hueco_sin_espacio() -> None:
    assert texts(_span(("En", 10.0, 50.0), ("atención", 22.0, 50.0))) == ["En", "atención"]


def test_no_corta_una_palabra_continua() -> None:
    assert texts(_span(("RUT:", 10.0, 50.0))) == ["RUT:"]
    assert texts(_span(("Hola mundo", 10.0, 50.0))) == ["Hola", "mundo"]


def test_copias_concatenadas_no_cuentan_como_actualizaciones() -> None:
    import pymupdf

    from validator.pipeline.authenticity import pdf_signals
    from validator.pipeline.pdf_inspector import inspect_pdf

    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Certificado de prueba")
    original = doc.tobytes()
    content = inspect_pdf(original * 4, max_pages=5, dpi=72, min_text_chars=1)
    assert content.pdf.repeated_copies == 4
    assert content.pdf.incremental_updates == 0
    ids = {s.id: s.weight for s in pdf_signals(content, None)}
    assert ids["pdf.repeated_copies"] == 0.0
    assert "pdf.incremental_updates" not in ids


def test_pagina_escaneada_con_texto_encima_se_ocrea_y_se_informa() -> None:
    import numpy as np
    import pymupdf
    from PIL import Image

    from validator.pipeline.authenticity import pdf_signals
    from validator.pipeline.pdf_inspector import inspect_pdf

    buf = io.BytesIO()
    Image.fromarray(np.full((800, 600), 235, dtype=np.uint8)).save(buf, format="JPEG")
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(page.rect, stream=buf.getvalue())  # el "escaneo" cubre toda la página
    page.insert_text((400, 700), "Nombre: Juana Perez RUT: 11.111.111-1 Horas 1.874 1.864 1.884")
    content = inspect_pdf(doc.tobytes(), max_pages=5, dpi=72, min_text_chars=40)
    assert content.pages[0].needs_ocr
    assert content.pdf.digits_over_scan > 0
    assert "pdf.text_over_scan" in {s.id for s in pdf_signals(content, None)}


def test_pdf_con_texto_normal_no_es_escaneo() -> None:
    import pymupdf

    from validator.pipeline.pdf_inspector import inspect_pdf

    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Certificado de prueba con suficiente texto para no requerir OCR 12345")
    content = inspect_pdf(doc.tobytes(), max_pages=5, dpi=72, min_text_chars=40)
    assert not content.pages[0].needs_ocr
    assert content.pdf.digits_over_scan == 0
