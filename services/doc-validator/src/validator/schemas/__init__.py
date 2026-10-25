"""Schemas pydantic por tipo de documento.

Cada módulo `validator.schemas.<nombre>` expone una clase `Schema` cuyos campos coinciden con los
`fields` del template YAML. Se usan para pedir y validar la salida estructurada del LLM.
"""

from __future__ import annotations

import copy
import importlib
from functools import cache
from typing import Any

from pydantic import BaseModel


@cache
def load_schema(name: str) -> type[BaseModel]:
    module = importlib.import_module(f"validator.schemas.{name}")
    schema = getattr(module, "Schema", None)
    if not (isinstance(schema, type) and issubclass(schema, BaseModel)):
        raise ValueError(f"validator.schemas.{name} no define una clase Schema (pydantic)")
    return schema


def strict_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON Schema apto para salida estructurada: sin títulos ni defaults, todos los campos
    requeridos (los opcionales se expresan como nullable) y additionalProperties=false."""
    schema = copy.deepcopy(model.model_json_schema())
    defs = schema.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            ref = node.pop("$ref", None)
            if ref:  # se inlinean las referencias ($defs) para un esquema autocontenido
                node.update(copy.deepcopy(defs[ref.rsplit("/", 1)[-1]]))
            node.pop("title", None)
            node.pop("default", None)
            if node.get("type") == "object" and "properties" in node:
                node["required"] = list(node["properties"])
                node["additionalProperties"] = False
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)
        return node

    return walk(schema)
