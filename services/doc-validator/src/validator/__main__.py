"""Punto de entrada: `python -m validator`."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal

from validator.config import get_settings
from validator.health import build_server, create_app
from validator.llm.claude_client import build_provider
from validator.logging_setup import configure_logging
from validator.messaging.consumer import Worker
from validator.pipeline import ocr
from validator.pipeline.runner import Pipeline
from validator.storage import AzureBlobReader
from validator.templates import TemplateRegistry

log = logging.getLogger("validator")


async def _start_with_backoff(worker: Worker, stop: asyncio.Event) -> bool:
    delay = 1.0
    while not stop.is_set():
        try:
            await worker.start()
            return True
        except Exception as exc:  # noqa: BLE001 - RabbitMQ aún no disponible, credenciales, etc.
            log.warning("no se pudo conectar a RabbitMQ; reintentando",
                        extra={"error": type(exc).__name__, "retry_in_s": delay})
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=delay)
            delay = min(delay * 2, 30.0)
    return False


async def run() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    registry = TemplateRegistry.load(settings.templates_dir)
    lang = ocr.resolve_lang(settings.ocr_lang)
    log.info("iniciando doc-validator", extra={"templates": registry.ids(), "ocr_lang": lang,
                                               "llm": settings.llm_available, "model": settings.claude_model})

    llm = build_provider(settings, registry)
    blobs = AzureBlobReader(settings)
    pipeline = Pipeline(settings=settings, registry=registry, llm=llm)
    worker = Worker(settings=settings, pipeline=pipeline, blobs=blobs)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    server = build_server(create_app(lambda: worker.ready), settings.health_port)
    server_task = asyncio.create_task(server.serve())
    try:
        if await _start_with_backoff(worker, stop):
            await stop.wait()
        log.info("señal de término recibida; apagado ordenado")
    finally:
        await worker.stop()
        server.should_exit = True
        await server_task
        await llm.aclose()
        await blobs.close()
        log.info("doc-validator detenido")


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
