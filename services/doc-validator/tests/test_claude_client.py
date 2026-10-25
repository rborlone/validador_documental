import json
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from validator.llm.base import DisabledLLM
from validator.llm.claude_client import FALLBACK_BETA, ClaudeProvider, build_provider, build_system_prompt
from validator.schemas import load_schema


def response(payload: dict | None, stop_reason: str = "end_turn"):
    content = [SimpleNamespace(type="text", text=json.dumps(payload))] if payload is not None else []
    return SimpleNamespace(
        content=content, stop_reason=stop_reason, model="claude-sonnet-5-5", stop_details=None,
        usage=SimpleNamespace(input_tokens=10, cache_read_input_tokens=0, cache_creation_input_tokens=0,
                              output_tokens=5),
        _request_id="req_test",
    )


class FakeMessages:
    def __init__(self, result):
        self.result = result
        self.kwargs: dict = {}

    async def create(self, **kwargs):
        self.kwargs = kwargs
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeClient:
    def __init__(self, result):
        self.beta = SimpleNamespace(messages=FakeMessages(result))

    async def close(self):
        return None


def provider(registry, result) -> tuple[ClaudeProvider, FakeMessages]:
    client = FakeClient(result)
    p = ClaudeProvider(api_key="x", model="claude-sonnet-5-5", registry=registry, client=client)
    return p, client.beta.messages


async def test_clasificacion_estructurada_con_cache_y_fallback(registry) -> None:
    p, messages = provider(registry, response({"type": "contrato", "confidence": 0.9, "reason": "cláusulas"}))
    result = await p.classify(text="CONTRATO ...", image_png=b"\x89PNG")
    assert result is not None and result.type == "contrato" and result.confidence == 0.9

    kw = messages.kwargs
    assert kw["model"] == "claude-sonnet-5-5"
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"}
    fmt = kw["output_config"]["format"]
    assert fmt["type"] == "json_schema"
    assert set(fmt["schema"]["properties"]["type"]["enum"]) == {*registry.ids(), "desconocido"}
    assert kw["betas"] == [FALLBACK_BETA] and kw["fallbacks"] == "default"
    content = kw["messages"][0]["content"]
    assert content[0]["type"] == "image" and content[0]["source"]["media_type"] == "image/png"
    assert "<documento>" in content[1]["text"]


def test_system_prompt_determinista(registry) -> None:
    a, b = build_system_prompt(registry), build_system_prompt(registry)
    assert a == b
    for type_id in registry.ids():
        assert f"## {type_id}" in a


async def test_extraccion_valida_contra_schema(registry) -> None:
    p, messages = provider(registry, response({"fecha_emision": "2026-03-15", "folio": 12}))
    data = await p.extract(doc_type="factura_sii", schema=load_schema("factura_sii"), fields=["fecha_emision"],
                           text="...", image_png=None)
    assert data is not None and data["folio"] == 12 and data["fecha_emision"] == "2026-03-15"
    schema = messages.kwargs["output_config"]["format"]["schema"]
    assert schema["additionalProperties"] is False


async def test_extraccion_que_no_cumple_schema_devuelve_none(registry) -> None:
    p, _ = provider(registry, response({"folio": "no es número", "campo_extra": 1}))
    assert await p.extract(doc_type="factura_sii", schema=load_schema("factura_sii"), fields=[], text="",
                           image_png=None) is None


@pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens"])
async def test_rechazo_o_truncado_devuelve_none(registry, stop_reason: str) -> None:
    p, _ = provider(registry, response({"type": "contrato", "confidence": 1, "reason": ""}, stop_reason))
    assert await p.classify(text="x", image_png=None) is None


async def test_errores_de_api_no_rompen(registry) -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    p, _ = provider(registry, anthropic.APIConnectionError(request=request))
    assert await p.classify(text="x", image_png=None) is None
    p, _ = provider(registry, anthropic.APITimeoutError(request=request))
    assert await p.visual_review(doc_type="factura_sii", image_png=b"png") is None


def test_build_provider(settings, registry) -> None:
    assert isinstance(build_provider(settings, registry), DisabledLLM)
    sin_clave = settings.model_copy(update={"llm_enabled": True, "anthropic_api_key": None})
    assert isinstance(build_provider(sin_clave, registry), DisabledLLM)
    con_clave = settings.model_copy(update={"llm_enabled": True, "anthropic_api_key": "sk-test"})
    assert isinstance(build_provider(con_clave, registry), ClaudeProvider)


async def test_llamadas_quedan_registradas_por_documento(registry) -> None:
    from validator.llm.base import current_calls, start_recording, stop_recording

    p, _ = provider(registry, response({"type": "contrato", "confidence": 0.9, "reason": "cláusulas"}))
    await p.classify(text="fuera de un documento", image_png=None)  # sin registro activo: no falla

    token = start_recording()
    try:
        await p.classify(text="CONTRATO ...", image_png=None)
        await p.extract(doc_type="contrato", schema=load_schema("contrato"), fields=["rut_parte_1"],
                        text="CONTRATO ...", image_png=None)  # el payload no cumple el schema
        calls = [c.to_json() for c in current_calls()]
    finally:
        stop_recording(token)
    assert current_calls() == []
    assert [(c["purpose"], c["outcome"]) for c in calls] == [("classify", "ok"), ("extract", "schema_mismatch")]
    assert calls[0]["inputTokens"] == 10 and calls[0]["outputTokens"] == 5 and calls[0]["model"] == "claude-sonnet-5-5"
    assert calls[1]["fields"] == ["rut_parte_1"]
