from datetime import date

import pytest

from validator.chile import format_rut, is_valid_rut, parse_amount, parse_date, rut_dv


@pytest.mark.parametrize(
    "rut",
    ["12.345.678-5", "12345678-5", "76.123.456-0", "77.654.321-7", "11.111.111-1", "10.000.013-K", "10000013k"],
)
def test_rut_valido(rut: str) -> None:
    assert is_valid_rut(rut)


@pytest.mark.parametrize("rut", ["12.345.678-9", "76.123.456-1", "abc", "", "1-9", "10.000.013-1"])
def test_rut_invalido(rut: str) -> None:
    assert not is_valid_rut(rut)


def test_rut_dv_modulo_11() -> None:
    assert rut_dv(12_345_678) == "5"
    assert rut_dv(10_000_013) == "K"
    assert rut_dv(11_111_111) == "1"
    # resto 11 -> "0"
    assert rut_dv(76_123_456) == "0"


def test_format_rut() -> None:
    assert format_rut("123456785") == "12.345.678-5"
    assert format_rut("10000013k") == "10.000.013-K"
    assert format_rut("x") is None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("$ 1.190.000", 1_190_000),
        ("1.190.000", 1_190_000),
        ("$0", 0),
        ("S 350.000", 350_000),
        ("1.234,60", 1_235),
        # Formato con coma de miles y punto decimal (p. ej. Oracle Publisher).
        ("$58,816.00", 58_816),
        ("$11,175.00", 11_175),
        ("58,816", 58_816),
        ("$0.00", 0),
        ("1,234,567.50", 1_234_568),
        ("1234,5", 1_235),
        (190000, 190_000),
        ("sin monto", None),
        (None, None),
    ],
)
def test_parse_amount(raw, expected) -> None:
    assert parse_amount(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("15-03-2026", date(2026, 3, 15)),
        ("15/03/2026", date(2026, 3, 15)),
        ("2026-03-15", date(2026, 3, 15)),
        ("15 de marzo de 2026", date(2026, 3, 15)),
        ("1 de septiembre del 2025", date(2025, 9, 1)),
        ("15 MAR 1985", date(1985, 3, 15)),
        ("10 ENE 2032", date(2032, 1, 10)),
        ("07-AGO-2026", date(2026, 8, 7)),
        ("14/dic/2026", date(2026, 12, 14)),
        ("28 del 08 del 2025", date(2025, 8, 28)),
        ("09 de Octubre, del 2025", date(2025, 10, 9)),
        ("miércoles, 27 de agosto de 2025", date(2025, 8, 27)),
        ("31-02-2026", None),
        ("no es fecha", None),
    ],
)
def test_parse_date(raw: str, expected) -> None:
    assert parse_date(raw) == expected
