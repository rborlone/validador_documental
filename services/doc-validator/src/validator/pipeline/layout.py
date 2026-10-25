"""Reconstrucción de líneas visuales a partir de palabras con coordenadas."""

from __future__ import annotations

from itertools import pairwise


def words_to_lines(words: list[tuple]) -> str:
    """Reconstruye líneas visuales agrupando palabras por altura (similar a la salida de OCR).

    Así etiqueta y valor que están en la misma fila quedan en la misma línea aunque el PDF los
    haya escrito como objetos de texto separados.
    """
    items = sorted(
        ((w[0], w[1], w[2], w[3], w[4]) for w in words if str(w[4]).strip()),
        key=lambda w: ((w[1] + w[3]) / 2, w[0]),
    )
    lines: list[list[tuple]] = []
    centers: list[float] = []
    for w in items:
        yc, h = (w[1] + w[3]) / 2, max(1.0, w[3] - w[1])
        if lines and abs(yc - centers[-1]) <= h * 0.45:
            lines[-1].append(w)
            centers[-1] = (centers[-1] * (len(lines[-1]) - 1) + yc) / len(lines[-1])
        else:
            lines.append([w])
            centers.append(yc)
    return "\n".join(_join(sorted(line, key=lambda w: w[0])) for line in lines)


def _join(line: list[tuple]) -> str:
    """Une palabras; fragmentos pegados (sin hueco visible) se concatenan sin espacio."""
    out = str(line[0][4])
    for prev, cur in pairwise(line):
        gap = cur[0] - prev[2]
        height = max(1.0, cur[3] - cur[1])
        out += ("" if gap < height * 0.08 else " ") + str(cur[4])
    return out
