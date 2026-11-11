"""Data Ingestion Router for IoT Gateway communication."""

from __future__ import annotations

import asyncio
from datetime import datetime
import json
import logging
from typing import Any, Dict, List, Union
from fastapi import APIRouter, Depends, Header, HTTPException, Security, status
from sqlalchemy.orm import Session

from app.config import API_KEY
from app.database import get_db
from app.models import Alert, Measurement, Node
from app.schemas import IngestResponse, TelemetryItem
from app.services.connection_manager import ws_manager
from app.services.ml_service import ml_service
from app.services.telegram_service import send_telegram_alert

logger = logging.getLogger("marine.ingest")
router = APIRouter(prefix="/api/v1", tags=["Ingest"])


def verify_api_key(
    x_api_key: Union[str, None] = Header(None, alias="X-API-Key"),
    authorization: Union[str, None] = Header(None),
) -> bool:
    """Verify incoming API Key from headers (X-API-Key or Bearer token)."""
    provided_key = None
    if x_api_key:
        provided_key = x_api_key
    elif authorization and authorization.startswith("Bearer "):
        provided_key = authorization.split("Bearer ", 1)[1].strip()

    if not provided_key or provided_key != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing Ingest API Key.",
        )
    return True


@router.post("/ingest", response_model=IngestResponse, dependencies=[Depends(verify_api_key)])
async def ingest_telemetry(
    payload: Union[TelemetryItem, List[TelemetryItem]],
    db: Session = Depends(get_db),
) -> IngestResponse:
    """Ingest real-time telemetry from IoT Gateway (single item or batch)."""
    items = [payload] if isinstance(payload, TelemetryItem) else payload
    if not items:
        return IngestResponse(count=0, alerts_triggered=0)

    alerts_created: List[Dict[str, Any]] = []

    for item in items:
        r, g, b = item.get_color_rgb()

        # 1. Update or create Node record
        node = db.query(Node).filter(Node.node_id == item.node_id).first()
        if not node:
            node = Node(
                node_id=item.node_id,
                name=f"Monitoring Station {item.node_id.upper()}",
                status="online",
                last_seen=item.ts,
            )
            db.add(node)
        else:
            node.last_seen = item.ts
            node.status = "online"

        # 2. Save measurement to DB
        meas = Measurement(
            node_id=item.node_id,
            seq=item.seq,
            ts=item.ts,
            temp_c=item.temp_c,
            ph=item.ph,
            tds_ppm=item.tds_ppm,
            turbidity_ntu=item.turbidity_ntu,
            color_r=r,
            color_g=g,
            color_b=b,
            rssi=item.rssi if item.rssi is not None else -60,
        )
        db.add(meas)

        # 3. Perform Real-time ML Inference
        meas_dict = {
            "node_id": item.node_id,
            "ts": item.ts.isoformat(),
            "temp_c": item.temp_c,
            "ph": item.ph,
            "tds_ppm": item.tds_ppm,
            "turbidity_ntu": item.turbidity_ntu,
            "color_r": r,
            "color_g": g,
            "color_b": b,
            "rssi": item.rssi or -60,
        }

        is_anomaly, cause, confidence = ml_service.predict(meas_dict)

        alert_dict = None
        if is_anomaly:
            details_json = json.dumps({
                "temp_c": item.temp_c,
                "ph": item.ph,
                "tds_ppm": item.tds_ppm,
                "turbidity_ntu": item.turbidity_ntu,
                "color": {"r": r, "g": g, "b": b},
            })

            new_alert = Alert(
                node_id=item.node_id,
                ts=item.ts,
                type="anomaly",
                cause=cause,
                confidence=confidence,
                acknowledged=False,
                details=details_json,
            )
            db.add(new_alert)
            db.flush()  # to populate new_alert.id

            alert_dict = {
                "id": new_alert.id,
                "node_id": item.node_id,
                "ts": item.ts.isoformat(),
                "cause": cause,
                "confidence": confidence,
                "temp_c": item.temp_c,
                "ph": item.ph,
                "tds_ppm": item.tds_ppm,
                "turbidity_ntu": item.turbidity_ntu,
            }
            alerts_created.append(alert_dict)

            # Fire Telegram notification asynchronously without blocking response
            asyncio.create_task(send_telegram_alert(alert_dict))

        # 4. Broadcast real-time packet via WebSocket
        ws_payload = {
            "type": "telemetry",
            "data": meas_dict,
            "alert": alert_dict,
        }
        asyncio.create_task(ws_manager.broadcast(ws_payload))

    db.commit()

    return IngestResponse(
        count=len(items),
        alerts_triggered=len(alerts_created),
        alerts=alerts_created,
    )

