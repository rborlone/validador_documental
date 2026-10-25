"""Validación contra los JSON Schemas de contracts/ (resolviendo el $ref al resultado)."""

from __future__ import annotations

import json

import pytest

from tests.conftest import CONTRACTS


def validator_for(event_type: str):
    jsonschema = pytest.importorskip("jsonschema")
    referencing = pytest.importorskip("referencing")
    from referencing.jsonschema import DRAFT202012

    resources = []
    for path in [CONTRACTS / "validation-result.schema.json", *sorted((CONTRACTS / "events").glob("*.json"))]:
        schema = json.loads(path.read_text(encoding="utf-8"))
        resources.append((schema["$id"], DRAFT202012.create_resource(schema)))
    registry = referencing.Registry().with_resources(resources)
    schema = json.loads((CONTRACTS / "events" / f"{event_type}.schema.json").read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(schema, registry=registry, format_checker=jsonschema.FormatChecker())


def assert_valid(event: dict) -> None:
    errors = sorted(validator_for(event["type"]).iter_errors(event), key=str)
    assert not errors, [f"{list(e.path)}: {e.message}" for e in errors]
