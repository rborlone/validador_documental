import pytest
import yaml

from validator.schemas import load_schema, strict_json_schema
from validator.templates import Template, TemplateRegistry

EXPECTED = {
    "factura_sii", "orden_compra", "certificado_vigencia", "cedula_identidad", "contrato",
    "certificado_accidentabilidad", "carpeta_tributaria", "certificado_f30",
}


def test_cargan_todos_los_templates(registry: TemplateRegistry) -> None:
    assert set(registry.ids()) == EXPECTED
    for t in registry.all():
        assert t.version.count(".") == 2
        assert t.schema_model is load_schema(t.schema_name)


def test_template_con_campo_fuera_del_schema_falla(settings) -> None:
    data = yaml.safe_load((settings.templates_dir / "factura_sii.yaml").read_text(encoding="utf-8"))
    data["fields"].append({"name": "campo_inexistente", "patterns": ["x(?P<value>\\d)"]})
    with pytest.raises(ValueError, match="campo_inexistente"):
        Template.model_validate(data)


def test_regla_con_campo_inexistente_falla(settings) -> None:
    data = yaml.safe_load((settings.templates_dir / "orden_compra.yaml").read_text(encoding="utf-8"))
    data["rules"].append({"id": "x", "type": "rut", "field": "no_existe"})
    with pytest.raises(ValueError, match="no_existe"):
        Template.model_validate(data)


def test_regex_invalida_falla(settings) -> None:
    data = yaml.safe_load((settings.templates_dir / "contrato.yaml").read_text(encoding="utf-8"))
    data["fields"][0]["patterns"] = ["(sin cerrar"]
    with pytest.raises(ValueError):
        Template.model_validate(data)


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_schema_estricto_para_salida_estructurada(name: str) -> None:
    schema = strict_json_schema(load_schema(name))
    assert "$defs" not in schema

    def walk(node):
        if isinstance(node, dict):
            assert "$ref" not in node
            if node.get("type") == "object" and "properties" in node:
                assert node["additionalProperties"] is False
                assert set(node["required"]) == set(node["properties"])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(schema)
