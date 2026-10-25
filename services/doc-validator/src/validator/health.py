"""Servidor HTTP de operación: liveness, readiness y métricas Prometheus."""

from __future__ import annotations

import contextlib
from collections.abc import Callable, Iterator

import uvicorn
from fastapi import FastAPI, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest


def create_app(is_ready: Callable[[], bool]) -> FastAPI:
    app = FastAPI(title="doc-validator", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health/live")
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready")
    async def ready(response: Response) -> dict[str, str]:
        if is_ready():
            return {"status": "ok"}
        response.status_code = 503
        return {"status": "no disponible", "detail": "sin conexión AMQP o consumidor detenido"}

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app


class EmbeddedServer(uvicorn.Server):
    """uvicorn dentro del mismo event loop; las señales las maneja el proceso principal."""

    @contextlib.contextmanager
    def capture_signals(self) -> Iterator[None]:
        yield


def build_server(app: FastAPI, port: int) -> EmbeddedServer:
    config = uvicorn.Config(app, host="0.0.0.0", port=port, log_config=None, access_log=False,  # noqa: S104
                            lifespan="off")
    return EmbeddedServer(config)
