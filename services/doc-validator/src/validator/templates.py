"""Carga y validación de templates YAML (uno por tipo de documento).

Agregar un tipo = un YAML en templates/ + un schema pydantic en validator/schemas/.
En las expresiones regulares se pueden usar macros: <<RUT>>, <<DATE>>, <<AMOUNT>>, <<INT>>, <<SEP>>.
"""

from __future__ import annotations

import logging
import re
from functools import cached_property
from pathlib import Path
from typing import Annotated, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from validator.chile import DATE_REGEX
from validator.schemas import load_schema

log = logging.getLogger(__name__)

MACROS = {
    # Las macros no cruzan saltos de línea ([ \t] en vez de \s) para no unir etiqueta y valor de
    # líneas distintas (p. ej. el encabezado "Total" de una tabla con la primera fila).
    "<<RUT>>": r"\d{1,2}[ \t]?\.?[ \t]?\d{3}[ \t]?\.?[ \t]?\d{3}[ \t]?[-‐–][ \t]?[\dkK]\b",
    "<<DATE>>": DATE_REGEX,
    # El OCR a veces lee "$" como "S" o "§".
    # Formato chileno (1.234,56), con coma de miles (58,816.00) o sin separador. Nunca un
    # porcentaje: en "IVA 19%" el 19 no es un monto.
    "<<AMOUNT>>": (
        r"(?:[$S§][ \t]?)?"
        r"(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)"
        r"(?![\d.,]*\d)(?![ \t]*%)"
    ),
    "<<INT>>": r"\d[\d.]*",
    # Separador entre etiqueta y valor: dos puntos opcionales y, como excepción a la regla de
    # arriba, a lo sumo un salto de línea (formatos que ponen el valor bajo la etiqueta).
    "<<SEP>>": r"[ \t]*:?[ \t]*(?:\r?\n[ \t]*)?",
}

_FLAGS = re.IGNORECASE | re.MULTILINE


def expand(pattern: str) -> str:
    for macro, regex in MACROS.items():
        pattern = pattern.replace(macro, regex)
    return pattern


def compile_pattern(pattern: str) -> re.Pattern[str]:
    return re.compile(expand(pattern), _FLAGS)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _check_regex(pattern: str, where: str) -> str:
    try:
        compile_pattern(pattern)
    except re.error as exc:
        raise ValueError(f"regex inválida en {where}: {exc}") from exc
    return pattern


class Keyword(_Strict):
    pattern: str
    weight: float = Field(1.0, gt=0)

    @field_validator("pattern")
    @classmethod
    def _valid(cls, v: str) -> str:
        return _check_regex(v, "classification.keywords")

    @cached_property
    def regex(self) -> re.Pattern[str]:
        return compile_pattern(self.pattern)


class Classification(_Strict):
    keywords: list[Keyword] = Field(min_length=1)
    description: str = ""


FieldType = Literal["string", "rut", "date", "amount", "integer", "lines"]
ColumnType = Literal["string", "amount", "integer"]


class Section(_Strict):
    start: str | None = None
    end: str | None = None

    @field_validator("start", "end")
    @classmethod
    def _valid(cls, v: str | None) -> str | None:
        return _check_regex(v, "section") if v else v


class FieldDef(_Strict):
    name: str
    type: FieldType = "string"
    required: bool = False
    description: str = ""
    patterns: list[str] = Field(default_factory=list)
    occurrence: int | Literal["last"] = 1
    # Solo para type=lines
    row_pattern: str | None = None
    columns: dict[str, ColumnType] = Field(default_factory=dict)
    section: Section | None = None

    @model_validator(mode="after")
    def _check(self) -> FieldDef:
        if self.type == "lines":
            if not self.row_pattern or not self.columns:
                raise ValueError(f"el campo {self.name} (lines) necesita row_pattern y columns")
        elif not self.patterns:
            raise ValueError(f"el campo {self.name} necesita al menos un patrón")
        for p in [*self.patterns, *([self.row_pattern] if self.row_pattern else [])]:
            _check_regex(p, f"el campo {self.name}")  # falla temprano si la regex es inválida
        return self

    @cached_property
    def regexes(self) -> list[re.Pattern[str]]:
        return [compile_pattern(p) for p in self.patterns]

    @cached_property
    def row_regex(self) -> re.Pattern[str] | None:
        return compile_pattern(self.row_pattern) if self.row_pattern else None


Severity = Literal["error", "warning"]


class _Rule(_Strict):
    id: str
    severity: Severity = "error"


class RutRule(_Rule):
    type: Literal["rut"]
    field: str
    optional: bool = False


class SumLinesRule(_Rule):
    type: Literal["sum_lines"]
    field: str
    column: str = "total"
    target: str
    tolerance: int = 1


class LineItemsRule(_Rule):
    type: Literal["line_items"]
    field: str
    quantity: str = "cantidad"
    unit_price: str = "precio_unitario"
    total: str = "total"
    tolerance: int = 1


class IvaRule(_Rule):
    type: Literal["iva"]
    net: str
    vat: str
    rate: float = 0.19
    tolerance: int = 1


class TotalRule(_Rule):
    type: Literal["total"]
    net: str
    vat: str
    total: str
    exempt: str | None = None
    tolerance: int = 1


class VigenciaRule(_Rule):
    type: Literal["vigencia"]
    expiry_field: str | None = None
    issue_field: str | None = None
    validity_days: int | None = None
    validity_days_field: str | None = None
    optional: bool = False


class DateNotFutureRule(_Rule):
    type: Literal["date_not_future"]
    field: str


class DateOrderRule(_Rule):
    type: Literal["date_order"]
    before: str
    after: str


Rule = Annotated[
    RutRule | SumLinesRule | LineItemsRule | IvaRule | TotalRule | VigenciaRule | DateNotFutureRule
    | DateOrderRule,
    Field(discriminator="type"),
]


class Template(_Strict):
    id: str
    version: str
    name: str
    schema_name: str = Field(alias="schema")
    classification: Classification
    fields: list[FieldDef]
    rules: list[Rule] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    @field_validator("id")
    @classmethod
    def _id_format(cls, v: str) -> str:
        if not re.fullmatch(r"[a-z][a-z0-9_]*", v):
            raise ValueError("id debe ser snake_case")
        return v

    @model_validator(mode="after")
    def _consistency(self) -> Template:
        names = {f.name for f in self.fields}
        schema = load_schema(self.schema_name)
        missing_in_schema = names - set(schema.model_fields)
        if missing_in_schema:
            raise ValueError(f"campos sin definir en el schema {self.schema_name}: {sorted(missing_in_schema)}")
        for rule in self.rules:
            for attr in ("field", "target", "net", "vat", "total", "exempt", "expiry_field", "issue_field",
                         "validity_days_field", "before", "after"):
                ref = getattr(rule, attr, None)
                if ref and ref not in names and not (rule.type == "line_items" and attr == "total"):
                    raise ValueError(f"la regla {rule.id} referencia un campo inexistente: {ref}")
        return self

    @property
    def schema_model(self) -> type[BaseModel]:
        return load_schema(self.schema_name)

    def field(self, name: str) -> FieldDef | None:
        return next((f for f in self.fields if f.name == name), None)


class TemplateRegistry:
    def __init__(self, templates: dict[str, Template]):
        self._templates = dict(sorted(templates.items()))

    @classmethod
    def load(cls, directory: Path) -> TemplateRegistry:
        templates: dict[str, Template] = {}
        for path in sorted(directory.glob("*.y*ml")):
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            template = Template.model_validate(data)
            if template.id in templates:
                raise ValueError(f"template duplicado: {template.id}")
            templates[template.id] = template
            log.info("template cargado", extra={"template": template.id, "version": template.version})
        if not templates:
            raise ValueError(f"no hay templates en {directory}")
        return cls(templates)

    def get(self, type_id: str) -> Template | None:
        return self._templates.get(type_id)

    def all(self) -> list[Template]:
        return list(self._templates.values())

    def ids(self) -> list[str]:
        return list(self._templates)
