"""IoT Gateway for Marine Pollution Monitoring Platform.

Functions:
1. Subscribes to MQTT topics:
   - marine/+/telemetry (QoS 1)
   - marine/+/status (LWT)
2. Validates JSON payload schema and filters out-of-physical-bound sensor anomalies.
3. Buffers valid messages into a local SQLite database (Store-and-Forward) to prevent data loss.
4. Periodically flushes buffered records in batches to the Cloud FastAPI backend via HTTPS POST /api/v1/ingest.
5. Implements Exponential Backoff retry when the Cloud is offline or unreachable.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import logging
import os
from pathlib import Path
import signal
import sqlite3
import sys
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
import paho.mqtt.client as mqtt

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [Gateway] %(message)s",
)
logger = logging.getLogger("marine.gateway")


# ==============================================================================
# Physical Bounds Validation
# ==============================================================================
def validate_telemetry(data: Dict[str, Any]) -> Tuple[bool, str]:
    """Validate telemetry schema and environmental physical limits."""
    required_fields = ["node_id", "ts", "temp_c", "ph", "tds_ppm", "turbidity_ntu"]
    for field in required_fields:
        if field not in data:
            return False, f"Missing required field: '{field}'"

    # Type & Range Checks based on marine physics
    try:
        temp = float(data["temp_c"])
        if not (-10.0 <= temp <= 60.0):
            return False, f"Temperature {temp}°C out of physical range [-10, 60]"

        ph = float(data["ph"])
        if not (0.0 <= ph <= 14.0):
            return False, f"pH {ph} out of physical range [0, 14]"

        tds = float(data["tds_ppm"])
        if not (0.0 <= tds <= 50000.0):
            return False, f"TDS {tds} ppm out of physical range [0, 50000]"

        turb = float(data["turbidity_ntu"])
        if not (0.0 <= turb <= 2000.0):
            return False, f"Turbidity {turb} NTU out of physical range [0, 2000]"

    except (ValueError, TypeError) as e:
        return False, f"Invalid numeric parameter format: {e}"

    return True, "Valid"


# ==============================================================================
# Local Buffer Manager (SQLite Store-and-Forward)
# ==============================================================================
class BufferManager:
    """Thread-safe SQLite persistent buffer for offline store-and-forward."""

    def __init__(self, db_path: str = "gateway_buffer.db", max_records: int = 5000) -> None:
        self.db_path = db_path
        self.max_records = max_records
        self._lock = threading.Lock()
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        """Create buffer table if it does not exist."""
        with self._lock:
            conn = self._get_connection()
            try:
                with conn:
                    conn.execute("""
                        CREATE TABLE IF NOT EXISTS telemetry_buffer (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            node_id TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            retry_count INTEGER DEFAULT 0
                        )
                    """)
                    conn.execute("CREATE INDEX IF NOT EXISTS idx_buffer_created ON telemetry_buffer(created_at)")
            finally:
                conn.close()

    def insert(self, node_id: str, payload: Dict[str, Any]) -> int:
        """Insert a valid telemetry payload into the local persistent queue."""
        payload_str = json.dumps(payload)
        with self._lock:
            conn = self._get_connection()
            try:
                with conn:
                    cursor = conn.execute(
                        "INSERT INTO telemetry_buffer (node_id, payload_json) VALUES (?, ?)",
                        (node_id, payload_str),
                    )
                    row_id = cursor.lastrowid
                    # Prune old records if buffer exceeds max capacity
                    conn.execute("""
                        DELETE FROM telemetry_buffer WHERE id IN (
                            SELECT id FROM telemetry_buffer ORDER BY id ASC LIMIT MAX(0, (SELECT COUNT(*) FROM telemetry_buffer) - ?)
                        )
                    """, (self.max_records,))
                return row_id
            finally:
                conn.close()

    def get_batch(self, limit: int = 15) -> List[Tuple[int, Dict[str, Any]]]:
        """Fetch the oldest pending batch of telemetry records."""
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.execute(
                    "SELECT id, payload_json FROM telemetry_buffer ORDER BY id ASC LIMIT ?",
                    (limit,),
                )
                rows = cursor.fetchall()
                results = []
                for row in rows:
                    try:
                        results.append((row["id"], json.loads(row["payload_json"])))
                    except json.JSONDecodeError:
                        continue
                return results
            finally:
                conn.close()

    def delete_batch(self, ids: List[int]) -> None:
        """Remove successfully delivered records from the buffer."""
        if not ids:
            return
        placeholders = ",".join(["?"] * len(ids))
        with self._lock:
            conn = self._get_connection()
            try:
                with conn:
                    conn.execute(
                        f"DELETE FROM telemetry_buffer WHERE id IN ({placeholders})",
                        ids,
                    )
            finally:
                conn.close()

    def count_pending(self) -> int:
        """Return total number of unsent buffered records."""
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.execute("SELECT COUNT(*) AS total FROM telemetry_buffer")
                row = cursor.fetchone()
                return int(row["total"]) if row else 0
            finally:
                conn.close()


# ==============================================================================
# IoT Gateway Core Service
# ==============================================================================
class IoTGateway:
    """Coordinates MQTT subscription, edge filtering, offline buffering, and Cloud HTTP forwarding."""

    def __init__(
        self,
        broker_host: str = "localhost",
        broker_port: int = 1883,
        mqtt_user: Optional[str] = None,
        mqtt_pass: Optional[str] = None,
        cloud_url: str = "http://localhost:8000/api/v1/ingest",
        api_key: str = "marine_secret_key_2026",
        db_path: str = "gateway_buffer.db",
        batch_size: int = 10,
        flush_interval: float = 3.0,
    ) -> None:
        self.broker_host = broker_host
        self.broker_port = broker_port
        self.mqtt_user = mqtt_user
        self.mqtt_pass = mqtt_pass
        self.cloud_url = cloud_url
        self.api_key = api_key
        self.batch_size = batch_size
        self.flush_interval = flush_interval

        self.buffer = BufferManager(db_path=db_path)
        self.running = False
        self.forwarder_thread: Optional[threading.Thread] = None

        # Setup MQTT Client
        try:
            # Paho MQTT 2.x API
            self.client = mqtt.Client(
                mqtt.CallbackAPIVersion.VERSION2,
                client_id="gateway_python_service",
            )
        except AttributeError:
            # Fallback for Paho MQTT 1.x
            self.client = mqtt.Client(client_id="gateway_python_service")

        if self.mqtt_user and self.mqtt_pass:
            self.client.username_pw_set(self.mqtt_user, self.mqtt_pass)

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def _on_connect(self, client: Any, userdata: Any, flags: Any, rc: Any, properties: Any = None) -> None:
        if rc == 0 or getattr(rc, "value", rc) == 0:
            logger.info(f"Connected to Mosquitto MQTT Broker at {self.broker_host}:{self.broker_port}")
            # Subscribe to telemetry and status LWT topics
            client.subscribe("marine/+/telemetry", qos=1)
            client.subscribe("marine/+/status", qos=1)
            logger.info("Subscribed to topics: 'marine/+/telemetry' (QoS 1), 'marine/+/status'")
        else:
            logger.error(f"MQTT connection failed with result code: {rc}")

    def _on_disconnect(self, client: Any, userdata: Any, flags: Any, rc: Any, properties: Any = None) -> None:
        logger.warning(f"Disconnected from MQTT Broker (rc={rc}). Auto-reconnecting...")

    def _on_message(self, client: Any, userdata: Any, msg: Any) -> None:
        topic = msg.topic
        payload_bytes = msg.payload

        try:
            payload_str = payload_bytes.decode("utf-8")
            data = json.loads(payload_str)
        except Exception as e:
            logger.warning(f"Dropped non-JSON packet on {topic}: {e}")
            return

        # 1. Handle LWT Station Status (marine/{node_id}/status)
        if topic.endswith("/status"):
            node_id = data.get("node_id", topic.split("/")[1])
            status_val = data.get("status", "unknown")
            logger.info(f"[Node Status] Station '{node_id}' status update: {status_val.upper()}")
            # Status messages can also be forwarded or logged
            return

        # 2. Handle Telemetry (marine/{node_id}/telemetry)
        if topic.endswith("/telemetry"):
            is_valid, reason = validate_telemetry(data)
            if not is_valid:
                logger.warning(f"[Edge Filter] Rejected corrupt telemetry on {topic}: {reason}")
                return

            # Save to SQLite Buffer
            node_id = data["node_id"]
            row_id = self.buffer.insert(node_id, data)
            pending = self.buffer.count_pending()
            logger.info(
                f"[Buffered] Received packet from '{node_id}' (seq={data.get('seq')}, pH={data.get('ph')}, "
                f"TDS={data.get('tds_ppm')}). Buffer queue: {pending}"
            )

    def _forwarder_loop(self) -> None:
        """Background worker: reads batches from SQLite and flushes to Cloud Backend with Exponential Backoff."""
        logger.info(f"Cloud Forwarder worker started (Target: {self.cloud_url}).")
        backoff_delay = self.flush_interval

        while self.running:
            pending_count = self.buffer.count_pending()

            if pending_count == 0:
                time.sleep(self.flush_interval)
                backoff_delay = self.flush_interval
                continue

            # Fetch a batch to forward
            batch = self.buffer.get_batch(limit=self.batch_size)
            if not batch:
                time.sleep(self.flush_interval)
                continue

            ids = [item[0] for item in batch]
            payloads = [item[1] for item in batch]

            headers = {
                "X-API-Key": self.api_key,
                "Content-Type": "application/json",
            }

            try:
                # Forward to Cloud Ingest API
                with httpx.Client(timeout=8.0) as client:
                    resp = client.post(self.cloud_url, json=payloads, headers=headers)

                if resp.status_code == 200:
                    # Successful delivery -> Delete batch from local SQLite
                    self.buffer.delete_batch(ids)
                    remaining = self.buffer.count_pending()
                    logger.info(
                        f"[Cloud Ingest] Forwarded batch of {len(payloads)} records successfully. "
                        f"(Remaining buffer: {remaining})"
                    )
                    backoff_delay = self.flush_interval
                    # Continue flushing immediately if more records are queued
                    if remaining > 0:
                        continue
                else:
                    logger.warning(
                        f"[Cloud Ingest] Server returned HTTP {resp.status_code}: {resp.text}. "
                        f"Retrying in {backoff_delay:.1f}s..."
                    )
                    backoff_delay = min(60.0, backoff_delay * 2)

            except Exception as e:
                logger.warning(
                    f"[Cloud Ingest Offline] Could not reach Cloud ({e}). "
                    f"{pending_count} records safely stored in SQLite buffer. Retrying in {backoff_delay:.1f}s..."
                )
                backoff_delay = min(60.0, backoff_delay * 2)

            time.sleep(backoff_delay)

    def start(self) -> None:
        """Start the Gateway service."""
        self.running = True
        logger.info("Starting IoT Gateway Service...")

        # Start background Cloud Forwarder thread
        self.forwarder_thread = threading.Thread(target=self._forwarder_loop, daemon=True)
        self.forwarder_thread.start()

        # Connect to MQTT Broker
        try:
            self.client.connect(self.broker_host, self.broker_port, keepalive=60)
            self.client.loop_start()
            logger.info("Gateway event loop running. Press Ctrl+C to terminate.")
        except Exception as e:
            logger.error(f"Failed to connect to Mosquitto Broker at {self.broker_host}:{self.broker_port}: {e}")
            logger.info("Gateway will continue forwarder thread for existing SQLite buffer...")

    def stop(self) -> None:
        """Gracefully stop the Gateway service."""
        logger.info("Shutting down IoT Gateway...")
        self.running = False
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass

        if self.forwarder_thread and self.forwarder_thread.is_alive():
            self.forwarder_thread.join(timeout=2.0)
        logger.info("IoT Gateway stopped safely.")


# ==============================================================================
# CLI Entry Point
# ==============================================================================
def main() -> None:
    parser = argparse.ArgumentParser(description="IoT Marine Pollution Gateway Service.")
    parser.add_argument("--broker", type=str, default=os.getenv("MQTT_BROKER_HOST", "localhost"), help="MQTT broker host.")
    parser.add_argument("--port", type=int, default=int(os.getenv("MQTT_BROKER_PORT", "1883")), help="MQTT broker port.")
    parser.add_argument("--user", type=str, default=os.getenv("MQTT_USER", None), help="MQTT username.")
    parser.add_argument("--password", type=str, default=os.getenv("MQTT_PASSWORD", None), help="MQTT password.")
    parser.add_argument("--cloud-url", type=str, default=os.getenv("CLOUD_INGEST_URL", "http://localhost:8000/api/v1/ingest"), help="Cloud Ingest API URL.")
    parser.add_argument("--api-key", type=str, default=os.getenv("GATEWAY_API_KEY", "marine_secret_key_2026"), help="Ingest API Key.")
    parser.add_argument("--db-path", type=str, default="gateway_buffer.db", help="Local SQLite buffer database path.")
    parser.add_argument("--batch-size", type=int, default=10, help="Max batch size per HTTP POST.")
    parser.add_argument("--interval", type=float, default=3.0, help="Flush interval in seconds.")
    args = parser.parse_args()

    gateway = IoTGateway(
        broker_host=args.broker,
        broker_port=args.port,
        mqtt_user=args.user,
        mqtt_pass=args.password,
        cloud_url=args.cloud_url,
        api_key=args.api_key,
        db_path=args.db_path,
        batch_size=args.batch_size,
        flush_interval=args.interval,
    )

    def signal_handler(sig: Any, frame: Any) -> None:
        gateway.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    gateway.start()

    # Keep main thread alive
    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        gateway.stop()


if __name__ == "__main__":
    main()
