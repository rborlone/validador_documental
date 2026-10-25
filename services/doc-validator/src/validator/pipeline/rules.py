"""Paso 6: validaciones declaradas en el template (RUT, fechas, vigencia y totales)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from validator.chile import format_amount, is_valid_rut, parse_amount, parse_date
from validator.pipeline.models import Check, ExtractedField
from validator.templates import (
    DateNotFutureRule,
    DateOrderRule,
    IvaRule,
    LineItemsRule,
    RutRule,
    SumLinesRule,
    Template,
    TotalRule,
    VigenciaRule,
)


class _Ctx:
    def __init__(self, template: Template, fields: dict[str, ExtractedField], today: date):
        self.template = template
        self.fields = fields
        self.today = today

    def value(self, name: str | None) -> Any:
        if not name or name not in self.fields:
            return None
        return self.fields[name].value

    def amount(self, name: str | None) -> int | None:
        v = self.value(name)
        return v if isinstance(v, int) and not isinstance(v, bool) else parse_amount(v) if v else None

    def date(self, name: str | None) -> date | None:
        v = self.value(name)
        return parse_date(v) if isinstance(v, str) else None

    def integer(self, name: str | None) -> int | None:
        v = self.value(name)
        return v if isinstance(v, int) and not isinstance(v, bool) else None

    def is_required(self, name: str) -> bool:
        f = self.template.field(name)
        return bool(f and f.required)


def _not_verifiable(rule_id: str, missing: list[str]) -> Check:
    return Check(rule_id, False, "warning", f"no se pudo verificar: falta {', '.join(missing)}")


def iva_of(net: int, rate: float) -> int:
    return int((Decimal(net) * Decimal(str(rate))).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _rut(rule: RutRule, ctx: _Ctx) -> Check | None:
    raw = ctx.value(rule.field)
    if raw is None:
        if rule.optional or ctx.is_required(rule.field):
            return None  # si es obligatorio ya lo reporta required.<campo>
        return _not_verifiable(rule.id, [rule.field])
    ok = is_valid_rut(str(raw))
    detail = f"{raw}: dígito verificador correcto" if ok else f"{raw}: RUT inválido (módulo 11)"
    return Check(rule.id, ok, rule.severity, detail)


def _sum_lines(rule: SumLinesRule, ctx: _Ctx) -> Check | None:
    lines = ctx.value(rule.field)
    target = ctx.amount(rule.target)
    if target is None:
        return None if ctx.is_required(rule.target) else _not_verifiable(rule.id, [rule.target])
    if not isinstance(lines, list) or not lines:
        return _not_verifiable(rule.id, [rule.field])
    amounts = [parse_amount(line.get(rule.column)) if isinstance(line, dict) else None for line in lines]
    if any(a is None for a in amounts):
        return _not_verifiable(rule.id, [f"{rule.field}[].{rule.column}"])
    total = sum(a for a in amounts if a is not None)
    diff = total - target
    ok = abs(diff) <= rule.tolerance
    detail = (f"suma de {len(lines)} líneas = {format_amount(total)}; {rule.target} = {format_amount(target)}"
              + ("" if ok else f" (diferencia {format_amount(diff)})"))
    return Check(rule.id, ok, rule.severity, detail)


def _line_items(rule: LineItemsRule, ctx: _Ctx) -> Check | None:
    lines = ctx.value(rule.field)
    if not isinstance(lines, list) or not lines:
        return None  # sum_lines ya informa que no hay detalle
    bad, checked = [], 0
    for i, line in enumerate(lines, start=1):
        if not isinstance(line, dict):
            continue
        q, p, t = (parse_amount(line.get(k)) for k in (rule.quantity, rule.unit_price, rule.total))
        if q is None or p is None or t is None:
            continue
        checked += 1
        if abs(q * p - t) > rule.tolerance:
            bad.append(f"línea {i}: {q} × {format_amount(p)} = {format_amount(q * p)} ≠ {format_amount(t)}")
    if not checked:
        return _not_verifiable(rule.id, ["cantidad/precio/total de las líneas"])
    if bad:
        return Check(rule.id, False, rule.severity, "; ".join(bad[:5]))
    return Check(rule.id, True, rule.severity, f"{checked} líneas: cantidad × precio unitario = total")


def _iva(rule: IvaRule, ctx: _Ctx) -> Check | None:
    net, vat = ctx.amount(rule.net), ctx.amount(rule.vat)
    missing = [n for n, v in ((rule.net, net), (rule.vat, vat)) if v is None]
    if missing:
        return None if all(ctx.is_required(m) for m in missing) else _not_verifiable(rule.id, missing)
    assert net is not None and vat is not None
    expected = iva_of(net, rule.rate)
    ok = abs(vat - expected) <= rule.tolerance
    detail = (f"{rule.net} {format_amount(net)} × {rule.rate:.0%} = {format_amount(expected)}; "
              f"IVA declarado {format_amount(vat)}")
    return Check(rule.id, ok, rule.severity, detail)


def _total(rule: TotalRule, ctx: _Ctx) -> Check | None:
    net, vat, total = ctx.amount(rule.net), ctx.amount(rule.vat), ctx.amount(rule.total)
    exempt = ctx.amount(rule.exempt) or 0
    missing = [n for n, v in ((rule.net, net), (rule.vat, vat), (rule.total, total)) if v is None]
    if missing:
        return None if all(ctx.is_required(m) for m in missing) else _not_verifiable(rule.id, missing)
    assert net is not None and vat is not None and total is not None
    expected = net + vat + exempt
    ok = abs(total - expected) <= rule.tolerance
    detail = (f"neto {format_amount(net)} + IVA {format_amount(vat)} + exento {format_amount(exempt)} = "
              f"{format_amount(expected)}; total declarado {format_amount(total)}")
    return Check(rule.id, ok, rule.severity, detail)


def _vigencia(rule: VigenciaRule, ctx: _Ctx) -> Check | None:
    expiry = ctx.date(rule.expiry_field)
    basis = f"{rule.expiry_field}"
    if expiry is None and rule.issue_field:
        issue = ctx.date(rule.issue_field)
        days = ctx.integer(rule.validity_days_field) or rule.validity_days
        if issue is not None and days is not None:
            expiry = issue + timedelta(days=days)
            basis = f"{rule.issue_field} + {days} días"
    if expiry is None:
        if rule.optional:
            return None
        return Check(rule.id, False, rule.severity, "no se pudo determinar la fecha de vencimiento")
    remaining = (expiry - ctx.today).days
    if remaining >= 0:
        return Check(rule.id, True, rule.severity,
                     f"vigente hasta {expiry.isoformat()} ({basis}); quedan {remaining} días")
    return Check(rule.id, False, rule.severity,
                 f"vencido desde {expiry.isoformat()} ({basis}); hace {-remaining} días")


def _not_future(rule: DateNotFutureRule, ctx: _Ctx) -> Check | None:
    d = ctx.date(rule.field)
    if d is None:
        return None
    ok = d <= ctx.today
    return Check(rule.id, ok, rule.severity,
                 f"{rule.field} {d.isoformat()}" + ("" if ok else " es posterior a hoy"))


def _order(rule: DateOrderRule, ctx: _Ctx) -> Check | None:
    a, b = ctx.date(rule.before), ctx.date(rule.after)
    if a is None or b is None:
        return None
    ok = a <= b
    return Check(rule.id, ok, rule.severity,
                 f"{rule.before} {a.isoformat()} {'≤' if ok else '>'} {rule.after} {b.isoformat()}")


_HANDLERS: dict[type, Callable[[Any, _Ctx], Check | None]] = {
    RutRule: _rut,
    SumLinesRule: _sum_lines,
    LineItemsRule: _line_items,
    IvaRule: _iva,
    TotalRule: _total,
    VigenciaRule: _vigencia,
    DateNotFutureRule: _not_future,
    DateOrderRule: _order,
}


def evaluate(template: Template, fields: dict[str, ExtractedField], today: date) -> list[Check]:
    ctx = _Ctx(template, fields, today)
    checks: list[Check] = []
    for f in template.fields:
        if f.required:
            present = f.name in fields and fields[f.name].value not in (None, "", [])
            detail = (f"{f.name} encontrado ({fields[f.name].source})" if present
                      else f"no se encontró el campo obligatorio {f.name}")
            checks.append(Check(f"required.{f.name}", present, "error", detail))
    for rule in template.rules:
        check = _HANDLERS[type(rule)](rule, ctx)
        if check is not None:
            checks.append(check)
    return checks
