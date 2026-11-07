"""Automated test suite for Marine Pollution IoT Backend API."""

from __future__ import annotations

import os
from pathlib import Path
import sys
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Setup test environment with temporary in-memory database
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["API_KEY"] = "test_api_key_123"

# Ensure backend package can be imported
sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.config import API_KEY
from app.database import Base, get_db
from app.main import app, seed_default_nodes

# In-memory test engine using StaticPool so all threads/sessions share the database
engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="module", autouse=True)
def setup_test_db():
    """Setup and teardown in-memory tables and seed nodes."""
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    seed_default_nodes(db)
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_check(client):
    """Verify health endpoint."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "ml_model_loaded" in data


def test_list_nodes(client):
    """Verify default seeded nodes exist."""
    resp = client.get("/api/v1/nodes")
    assert resp.status_code == 200
    nodes = resp.json()
    assert len(nodes) >= 2
    node_ids = [n["node_id"] for n in nodes]
    assert "node01" in node_ids
    assert "node02" in node_ids


def test_ingest_authentication(client):
    """Verify API key security on ingest endpoint."""
    payload = {
        "node_id": "node01",
        "seq": 1,
        "ts": "2026-11-20T10:00:00Z",
        "temp_c": 28.0,
        "ph": 8.0,
        "tds_ppm": 2200.0,
        "turbidity_ntu": 5.0,
        "color": {"r": 100, "g": 140, "b": 120},
        "rssi": -65,
    }

    # Missing API key
    resp_no_auth = client.post("/api/v1/ingest", json=payload)
    assert resp_no_auth.status_code == 401

    # Invalid API key
    resp_bad_auth = client.post(
        "/api/v1/ingest",
        json=payload,
        headers={"X-API-Key": "wrong_key"},
    )
    assert resp_bad_auth.status_code == 401


def test_ingest_normal_telemetry(client):
    """Verify ingestion of normal environmental data without triggering alerts."""
    payload = {
        "node_id": "node01",
        "seq": 100,
        "ts": "2026-11-20T12:00:00Z",
        "temp_c": 27.8,
        "ph": 8.1,
        "tds_ppm": 2250.0,
        "turbidity_ntu": 5.2,
        "color": {"r": 95, "g": 142, "b": 125},
        "rssi": -62,
    }

    resp = client.post(
        "/api/v1/ingest",
        json=payload,
        headers={"X-API-Key": "test_api_key_123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["count"] == 1
    assert data["alerts_triggered"] == 0


def test_ingest_anomaly_telemetry_triggers_alert(client):
    """Verify that an acidic pollution event triggers an alert with cause classification."""
    payload = {
        "node_id": "node01",
        "seq": 105,
        "ts": "2026-11-20T12:05:00Z",
        "temp_c": 28.2,
        "ph": 4.1,  # Severe acid drop
        "tds_ppm": 3100.0,
        "turbidity_ntu": 18.0,
        "color": {"r": 140, "g": 130, "b": 90},
        "rssi": -64,
    }

    resp = client.post(
        "/api/v1/ingest",
        json=payload,
        headers={"X-API-Key": "test_api_key_123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 1
    assert data["alerts_triggered"] == 1
    assert len(data["alerts"]) == 1
    alert = data["alerts"][0]
    assert alert["cause"] == "acidic_industrial"
    assert alert["confidence"] > 50.0


def test_query_measurements(client):
    """Verify measurements query endpoint."""
    resp = client.get("/api/v1/measurements?node_id=node01&limit=10")
    assert resp.status_code == 200
    records = resp.json()
    assert len(records) >= 2
    assert records[0]["node_id"] == "node01"


def test_query_and_acknowledge_alerts(client):
    """Verify alert listing and operator acknowledgment."""
    # List alerts
    resp = client.get("/api/v1/alerts?unacknowledged_only=true")
    assert resp.status_code == 200
    alerts = resp.json()
    assert len(alerts) >= 1
    alert_id = alerts[0]["id"]
    assert alerts[0]["acknowledged"] is False

    # Acknowledge alert
    ack_resp = client.post(f"/api/v1/alerts/{alert_id}/ack")
    assert ack_resp.status_code == 200
    ack_data = ack_resp.json()
    assert ack_data["alert_id"] == alert_id
    assert ack_data["acknowledged"] is True

    # Check unacknowledged list has decreased
    resp_after = client.get(f"/api/v1/alerts?unacknowledged_only=true")
    ids_after = [a["id"] for a in resp_after.json()]
    assert alert_id not in ids_after
