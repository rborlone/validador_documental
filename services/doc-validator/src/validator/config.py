"""Configuración del servicio (12-factor: todo por variables de entorno)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_SERVICE_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # Mensajería
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    max_attempts: int = Field(3, ge=1)
    prefetch: int = Field(2, ge=1, le=32)
    retry_delay_ms: int = 10_000  # debe coincidir con x-message-ttl de contracts/README
    processing_timeout_s: float = 300.0
    shutdown_grace_s: float = 60.0
    event_source: str = "/doc-validator"

    # Almacenamiento
    azure_storage_connection_string: str | None = None
    azure_storage_account_url: str | None = None  # AKS con Workload Identity (sin connection string)
    blob_container: str | None = "documents"
    max_file_size_mb: int = 20
    blob_retry_total: int = 2
    blob_connection_timeout_s: int = 5
    blob_read_timeout_s: int = 60

    # Pipeline
    templates_dir: Path = _SERVICE_ROOT / "templates"
    max_pages: int = Field(20, ge=1)
    ocr_lang: str = "spa+eng"
    ocr_dpi: int = 300
    min_text_chars_per_page: int = 40
    classifier_threshold: float = 0.6
    classifier_floor: float = 0.3
    field_min_confidence: float = 0.5
    ocr_min_confidence: float = 0.6
    timezone: str = "America/Santiago"

    # LLM (Claude)
    llm_enabled: bool = True
    anthropic_api_key: str | None = None
    claude_model: str = "claude-sonnet-5-5"
    llm_timeout_s: float = 60.0
    llm_max_retries: int = 2
    llm_refusal_fallback: bool = True
    llm_visual_review: str = Field("on_signals", pattern="^(always|on_signals|never)$")

    # Operación
    health_port: int = 8000
    log_level: str = "INFO"

    @property
    def llm_available(self) -> bool:
        return self.llm_enabled and bool(self.anthropic_api_key)

    @property
    def max_file_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
