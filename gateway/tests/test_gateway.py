"""Automated Unit Tests for IoT Gateway Service."""

from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import pytest

sys.path.append(str(Path(__file__).resolve().parent.parent / "app"))

from gateway import BufferManager, validate_telemetry


def test_validate_telemetry_valid():
    """Verify that a standard marine telemetry packet passes validation."""
    payload = {
        "node_id": "node01",
        "seq": 101,
        "ts": "2026-11-20T08:15:30Z",
        "temp_c": 28.4,
        "ph": 7.9,
        "tds_ppm": 1820.0,
        "turbidity_ntu": 12.5,
        "color": {"r": 120, "g": 140, "b": 98},
        "rssi": -61,
    }
    is_valid, reason = validate_telemetry(payload)
    assert is_valid is True
    assert reason == "Valid"


def test_validate_telemetry_missing_field():
    """Verify that packets with missing required fields are rejected."""
    payload = {
        "node_id": "node01",
        # missing "ts"
        "temp_c": 28.4,
        "ph": 7.9,
        "tds_ppm": 1820.0,
        "turbidity_ntu": 12.5,
    }
    is_valid, reason = validate_telemetry(payload)
    assert is_valid is False
    assert "Missing required field" in reason


def test_validate_telemetry_out_of_bounds():
    """Verify that electrical sensor short/disconnection values outside physics bounds are rejected."""
    # Impossible pH
    bad_ph = {
        "node_id": "node01",
        "ts": "2026-11-20T08:15:30Z",
        "temp_c": 28.4,
        "ph": 17.5,  # pH > 14
        "tds_ppm": 1820.0,
        "turbidity_ntu": 12.5,
    }
    is_valid, reason = validate_telemetry(bad_ph)
    assert is_valid is False
    assert "pH 17.5 out of physical range" in reason

    # Impossible Temperature
    bad_temp = {
        "node_id": "node01",
        "ts": "2026-11-20T08:15:30Z",
        "temp_c": 120.0,  # Boiling water
        "ph": 7.5,
        "tds_ppm": 1820.0,
        "turbidity_ntu": 12.5,
    }
    is_valid, reason = validate_telemetry(bad_temp)
    assert is_valid is False
    assert "Temperature 120.0°C out of physical range" in reason


def test_buffer_manager_lifecycle():
    """Verify SQLite persistent buffer insertion, batch fetching, and deletion."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    try:
        buffer = BufferManager(db_path=db_path, max_records=100)
        assert buffer.count_pending() == 0

        # Insert 3 records
        for i in range(3):
            data = {
                "node_id": "node01",
                "seq": i,
                "ts": "2026-11-20T08:15:30Z",
                "temp_c": 28.0 + i,
                "ph": 8.0,
                "tds_ppm": 2000.0,
                "turbidity_ntu": 5.0,
            }
            buffer.insert("node01", data)

        assert buffer.count_pending() == 3

        # Fetch batch of 2
        batch = buffer.get_batch(limit=2)
        assert len(batch) == 2
        first_id, first_payload = batch[0]
        assert first_payload["seq"] == 0

        # Delete first item (simulating successful delivery)
        buffer.delete_batch([first_id])
        assert buffer.count_pending() == 2

        # Delete remaining items
        remaining_batch = buffer.get_batch(limit=10)
        assert len(remaining_batch) == 2
        buffer.delete_batch([item[0] for item in remaining_batch])
        assert buffer.count_pending() == 0

    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

