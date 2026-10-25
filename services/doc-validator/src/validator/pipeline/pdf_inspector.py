"""Paso 2: abrir el documento, extraer la capa de texto y preparar imágenes para OCR.

- PDF: PyMuPDF. Si una página no tiene texto suficiente se rasteriza a OCR_DPI para OCR.
  Además reúne hechos forenses (metadatos, actualizaciones incrementales, fuentes en zonas
  de montos, texto invisible o tapado) que luego usa authenticity.
- Imágenes (PNG/JPEG/TIFF): se cargan con Pillow; todas las páginas van a OCR.
"""

from __future__ import annotations

import io
import logging
import re
from collections import Counter
from datetime import UTC, datetime, timedelta, timezone

import numpy as np
import pymupdf
from PIL import Image, ImageOps, ImageSequence

from validator.errors import UnsupportedFileError
from validator.pipeline.layout import words_to_lines
from validator.pipeline.models import DocumentContent, PageContent, PdfForensics

log = logging.getLogger(__name__)

PREVIEW_MAX_SIDE = 1568  # tamaño recomendado para imágenes enviadas al LLM
AMOUNT_ZONE = re.compile(r"total|neto|i\.?\s?v\.?\s?a|monto|exento|subtotal|precio", re.IGNORECASE)
_DIGIT = re.compile(r"\d")
_SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")
_STYLE_SUFFIX = re.compile(
    r"(?:[-,]?(?:bold|italic|oblique|regular|medium|light|semibold|black|condensed|narrow|book|mt|ps))+$",
    re.IGNORECASE,
)


def font_family(name: str) -> str:
    base = _SUBSET_PREFIX.sub("", name or "")
    base = base.split(",")[0]
    prev = None
    while prev != base:
        prev = base
        base = _STYLE_SUFFIX.sub("", base)
    return base.split("-")[0].lower() or "desconocida"


def parse_pdf_date(raw: str | None) -> datetime | None:
    """D:20260315103000-03'00' -> datetime con zona."""
    if not raw:
        return None
    m = re.match(r"D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+\-])?(\d{2})?'?(\d{2})?", raw.strip())
    if not m:
        return None
    parts = [int(g) if g else d for g, d in zip(m.groups()[:6], (0, 1, 1, 0, 0, 0), strict=True)]
    tz = UTC
    if m.group(7) in ("+", "-") and m.group(8):
        offset = timedelta(hours=int(m.group(8)), minutes=int(m.group(9) or 0))
        tz = timezone(offset if m.group(7) == "+" else -offset)
    try:
        return datetime(*parts, tzinfo=tz)  # type: ignore[arg-type]
    except ValueError:
        return None


def _to_gray_array(pix: pymupdf.Pixmap) -> np.ndarray:
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 1:
        return arr[:, :, 0].copy()
    return np.dot(arr[:, :, :3], [0.299, 0.587, 0.114]).astype(np.uint8)


def _preview_png(gray: np.ndarray) -> bytes:
    img = Image.fromarray(gray)
    img.thumbnail((PREVIEW_MAX_SIDE, PREVIEW_MAX_SIDE))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# ---------------------------------------------------------------- forense PDF


def _visual_rows(spans: list[dict]) -> list[list[dict]]:
    rows: list[list[dict]] = []
    centers: list[float] = []
    for span in sorted(spans, key=lambda s: ((s["bbox"][1] + s["bbox"][3]) / 2, s["bbox"][0])):
        yc = (span["bbox"][1] + span["bbox"][3]) / 2
        h = max(1.0, span["bbox"][3] - span["bbox"][1])
        if rows and abs(yc - centers[-1]) <= h * 0.45:
            rows[-1].append(span)
        else:
            rows.append([span])
            centers.append(yc)
    return rows


def _white_rects(page: pymupdf.Page) -> list[tuple[pymupdf.Rect, int]]:
    try:
        drawings = page.get_drawings()
    except Exception:
        log.debug("no se pudieron obtener dibujos", exc_info=True)
        return []
    rects = []
    for d in drawings:
        fill = d.get("fill")
        if not fill or min(fill) < 0.95 or (d.get("fill_opacity") or 1) < 0.99:
            continue
        rect = pymupdf.Rect(d["rect"])
        if not rect.is_empty:
            rects.append((rect, d.get("seqno", -1)))
    return rects


def _span_words(span: dict, covers: list[pymupdf.Rect]) -> tuple[list[tuple], int]:
    """Palabras (x0, y0, x1, y1, texto) de un span, sin los caracteres tapados por `covers`.
    Devuelve también cuántos caracteres quedaron tapados."""
    words: list[tuple] = []
    chars: list[tuple[str, tuple]] = []
    hidden = 0

    def flush() -> None:
        if chars:
            x0 = min(b[0] for _, b in chars)
            y0 = min(b[1] for _, b in chars)
            x1 = max(b[2] for _, b in chars)
            y1 = max(b[3] for _, b in chars)
            words.append((x0, y0, x1, y1, "".join(c for c, _ in chars)))
            chars.clear()

    size = max(1.0, float(span.get("size") or 0) or 10.0)
    prev_origin: tuple[float, float] | None = None
    for ch in span.get("chars", ()):
        c = chr(ch[0]) if ch[0] > 0 else ""
        bbox = tuple(ch[3])
        origin = tuple(ch[2])
        center = pymupdf.Point((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
        if covers and any(center in r for r in covers):
            hidden += 0 if c.isspace() else 1
            flush()
            continue
        # Algunos generadores (p. ej. Oracle Publisher) posicionan cada palabra o línea dentro
        # del mismo span sin escribir espacios: se corta si el carácter salta de línea base,
        # deja un hueco o retrocede respecto del anterior.
        if chars and prev_origin is not None:
            last = chars[-1][1]
            if (abs(origin[1] - prev_origin[1]) > size * 0.5
                    or bbox[0] - last[2] > size * 0.2
                    or bbox[0] < last[0] - size * 0.1):
                flush()
        prev_origin = origin
        if not c or c.isspace():
            flush()
        else:
            chars.append((c, bbox))
    flush()
    return words, hidden


def analyze_page(page: pymupdf.Page, facts: PdfForensics) -> str:
    """Devuelve el texto que se VE en la página y acumula hechos forenses.

    Se excluyen los caracteres tapados por rectángulos blancos dibujados después (texto
    "borrado" por un editor): la extracción lee lo que ve una persona y authenticity lo informa.
    """
    try:
        trace = page.get_texttrace()
    except Exception:
        log.debug("no se pudo obtener texttrace; se usa get_text", exc_info=True)
        return words_to_lines(page.get_text("words"))

    rects = _white_rects(page)
    words: list[tuple] = []
    visible: list[dict] = []
    hidden_digits = 0
    for raw in trace:
        text = "".join(chr(c[0]) for c in raw.get("chars", ()) if c[0] > 0)
        if not text.strip():
            continue
        bbox = pymupdf.Rect(raw["bbox"])
        seqno = raw.get("seqno", 0)
        covers = [r for r, rseq in rects if rseq > seqno and r.intersects(bbox)]
        span_words, covered_chars = _span_words(raw, covers)
        words.extend(span_words)
        if raw.get("type") == 3 or raw.get("opacity", 1) == 0:
            hidden_digits += len(_DIGIT.findall(text))
            continue
        if covered_chars:
            facts.covered_text_spans += 1
        if span_words:
            visible.append({"text": " ".join(w[4] for w in span_words), "font": raw.get("font", ""),
                            "bbox": tuple(bbox)})

    if visible and hidden_digits:
        # Un escaneo "buscable" tiene solo texto invisible: eso es legítimo. Se marca solo la
        # mezcla de texto visible con texto invisible que contiene cifras.
        facts.hidden_digit_chars += hidden_digits

    # Fuentes de los montos: spans con dígitos en filas que mencionan total/neto/IVA/etc.
    for row in _visual_rows(visible):
        row_text = " ".join(s["text"] for s in row)
        if AMOUNT_ZONE.search(row_text):
            facts.amount_zone_fonts.extend(font_family(s["font"]) for s in row if _DIGIT.search(s["text"]))

    return words_to_lines(words)


# Una página cuyo contenido es casi todo imagen se trata como escaneo aunque traiga algo de texto
# (p. ej. un certificado escaneado con nombre y RUT escritos encima en un formulario).
SCAN_IMAGE_COVERAGE = 0.5
SCAN_MAX_TEXT_CHARS = 400


def _image_coverage(page: pymupdf.Page) -> float:
    """Fracción de la página cubierta por imágenes (aproximada: suma de áreas, máximo 1)."""
    page_area = abs(page.rect) or 1.0
    try:
        infos = page.get_image_info()
    except Exception:  # noqa: BLE001
        return 0.0
    covered = sum(abs(pymupdf.Rect(i["bbox"]) & page.rect) for i in infos)
    return min(1.0, covered / page_area)


def _visible_digits(page: pymupdf.Page) -> int:
    try:
        trace = page.get_texttrace()
    except Exception:  # noqa: BLE001
        return 0
    return sum(len(_DIGIT.findall("".join(chr(c[0]) for c in raw.get("chars", ()) if c[0] > 0)))
               for raw in trace if raw.get("type") != 3 and raw.get("opacity", 1) != 0)


def _repeated_copies(data: bytes) -> int:
    """Cuántas veces se repite, byte a byte, la primera revisión del archivo.

    Algunos sistemas exportan el mismo PDF concatenado varias veces: parecen actualizaciones
    incrementales pero el contenido no cambió.
    """
    first = re.search(rb"%%EOF[\r\n]*", data)
    if not first or first.end() >= len(data) or len(data) % first.end():
        return 1
    size = first.end()
    copies = len(data) // size
    head = data[:size]
    return copies if all(data[i * size:(i + 1) * size] == head for i in range(1, copies)) else 1


def _raw_structure(data: bytes, facts: PdfForensics) -> None:
    facts.repeated_copies = _repeated_copies(data)
    if facts.repeated_copies > 1:
        data = data[:len(data) // facts.repeated_copies]
    facts.eof_count = max(1, len(re.findall(rb"%%EOF", data)))
    facts.startxref_count = max(1, len(re.findall(rb"(?<![A-Za-z])startxref", data)))
    facts.linearized = b"/Linearized" in data[:2048]


# ---------------------------------------------------------------- entrada


def inspect_pdf(data: bytes, *, max_pages: int, dpi: int, min_text_chars: int) -> DocumentContent:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise UnsupportedFileError("el PDF está dañado o no se puede abrir") from exc
    with doc:
        if doc.needs_pass:
            raise UnsupportedFileError("el PDF está protegido con contraseña")
        if doc.page_count == 0:
            raise UnsupportedFileError("el PDF no tiene páginas")
        if doc.page_count > max_pages:
            raise UnsupportedFileError(f"el PDF tiene {doc.page_count} páginas; el máximo es {max_pages}")

        facts = PdfForensics(metadata={k: v for k, v in (doc.metadata or {}).items() if v})
        facts.creation_date = parse_pdf_date(facts.metadata.get("creationDate"))
        facts.mod_date = parse_pdf_date(facts.metadata.get("modDate"))
        try:
            facts.xmp = doc.get_xml_metadata() or ""
        except Exception:  # noqa: BLE001
            facts.xmp = ""
        _raw_structure(data, facts)

        pages: list[PageContent] = []
        jpeg_samples: list[bytes] = []
        preview: bytes | None = None
        for page in doc:
            text = analyze_page(page, facts)
            chars = len(re.sub(r"\s", "", text))
            scanned = chars < SCAN_MAX_TEXT_CHARS and _image_coverage(page) >= SCAN_IMAGE_COVERAGE
            needs_ocr = chars < min_text_chars or scanned
            if scanned and chars:
                facts.digits_over_scan += _visible_digits(page)
            content = PageContent(index=page.number, text=text, source="text", confidence=1.0,
                                  needs_ocr=needs_ocr)
            if page.number == 0:
                # Capa de texto completa (incluye lo tapado) para compararla con el render.
                facts.page1_text_layer = words_to_lines(page.get_text("words"))
            # Se rasteriza si hace falta OCR, y siempre la 1ª página (vista previa y forense).
            if needs_ocr or page.number == 0:
                pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, alpha=False)
                content.image = _to_gray_array(pix)
                if page.number == 0:
                    preview = _preview_png(content.image)
            if needs_ocr:
                content.source, content.text, content.confidence = "ocr", "", 0.0
                jpeg_samples.extend(_page_jpegs(doc, page))
            pages.append(content)

    return DocumentContent(mime="application/pdf", pages=pages, pdf=facts, preview_png=preview,
                           jpeg_samples=jpeg_samples[:3])


def _page_jpegs(doc: pymupdf.Document, page: pymupdf.Page) -> list[bytes]:
    out = []
    for img in page.get_images(full=True):
        try:
            info = doc.extract_image(img[0])
        except Exception:
            log.debug("no se pudo extraer una imagen embebida", exc_info=True)
            continue
        if info and info.get("ext") in ("jpeg", "jpg"):
            out.append(info["image"])
    return out


def inspect_image(data: bytes, mime: str, *, max_pages: int) -> DocumentContent:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:
        raise UnsupportedFileError("la imagen está dañada o no se puede abrir") from exc

    software = None
    try:
        software = (img.getexif().get(0x0131) or None)  # EXIF Software
    except Exception:  # noqa: BLE001
        software = None

    pages: list[PageContent] = []
    for i, frame in enumerate(ImageSequence.Iterator(img)):
        if i >= max_pages:
            raise UnsupportedFileError(f"la imagen tiene más de {max_pages} páginas")
        gray = ImageOps.exif_transpose(frame.convert("RGB")).convert("L")
        pages.append(PageContent(index=i, source="ocr", confidence=0.0, image=np.asarray(gray).copy(),
                                 needs_ocr=True))
    preview = _preview_png(pages[0].image) if pages and pages[0].image is not None else None
    return DocumentContent(
        mime=mime,
        pages=pages,
        preview_png=preview,
        jpeg_samples=[data] if mime == "image/jpeg" else [],
        image_software=str(software) if software else None,
    )


def inspect(data: bytes, mime: str, *, max_pages: int, dpi: int, min_text_chars: int) -> DocumentContent:
    if mime == "application/pdf":
        return inspect_pdf(data, max_pages=max_pages, dpi=dpi, min_text_chars=min_text_chars)
    return inspect_image(data, mime, max_pages=max_pages)


def font_mix(fonts: list[str]) -> tuple[str, list[str]] | None:
    """Si los montos usan más de una familia de fuente devuelve (mayoritaria, otras)."""
    counts = Counter(fonts)
    if len(counts) < 2:
        return None
    majority = counts.most_common(1)[0][0]
    return majority, sorted(f for f in counts if f != majority)
