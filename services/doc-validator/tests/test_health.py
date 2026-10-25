from fastapi.testclient import TestClient

from validator.health import create_app


def test_health_endpoints() -> None:
    state = {"ready": False}
    client = TestClient(create_app(lambda: state["ready"]))
    assert client.get("/health/live").status_code == 200
    assert client.get("/health/ready").status_code == 503
    state["ready"] = True
    assert client.get("/health/ready").status_code == 200
    metrics = client.get("/metrics")
    assert metrics.status_code == 200
    assert "doc_validator_documents_processed_total" in metrics.text
    assert "doc_validator_processing_seconds" in metrics.text
