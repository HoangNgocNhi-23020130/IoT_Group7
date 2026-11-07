"""Pydantic request and response schemas for FastAPI."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class TelemetryColor(BaseModel):
    r: int = Field(0, ge=0, le=255)
    g: int = Field(0, ge=0, le=255)
    b: int = Field(0, ge=0, le=255)


class TelemetryItem(BaseModel):
    """Raw telemetry payload structure (matches docs/mqtt-topics.md)."""

    node_id: str
    seq: Optional[int] = None
    ts: datetime
    temp_c: float = Field(..., ge=-10.0, le=60.0)
    ph: float = Field(..., ge=0.0, le=14.0)
    tds_ppm: float = Field(..., ge=0.0)
    turbidity_ntu: float = Field(..., ge=0.0)
    color: Optional[TelemetryColor] = None
    color_r: Optional[int] = Field(None, ge=0, le=255)
    color_g: Optional[int] = Field(None, ge=0, le=255)
    color_b: Optional[int] = Field(None, ge=0, le=255)
    rssi: Optional[int] = Field(-60, ge=-120, le=0)

    def get_color_rgb(self) -> tuple[int, int, int]:
        """Normalize color from nested or flat fields."""
        if self.color is not None:
            return self.color.r, self.color.g, self.color.b
        r = self.color_r if self.color_r is not None else 0
        g = self.color_g if self.color_g is not None else 0
        b = self.color_b if self.color_b is not None else 0
        return r, g, b


class IngestResponse(BaseModel):
    status: str = "ok"
    count: int
    alerts_triggered: int
    alerts: List[Dict[str, Any]] = []


class MeasurementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    node_id: str
    seq: Optional[int] = None
    ts: datetime
    temp_c: float
    ph: float
    tds_ppm: float
    turbidity_ntu: float
    color_r: int
    color_g: int
    color_b: int
    rssi: int
    created_at: datetime


class NodeCreate(BaseModel):
    node_id: str
    name: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    status: Optional[str] = "offline"


class NodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    node_id: str
    name: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    last_seen: Optional[datetime] = None
    status: str
    latest_measurement: Optional[MeasurementOut] = None


class AlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    node_id: str
    ts: datetime
    type: str
    cause: str
    confidence: float
    acknowledged: bool
    details: Optional[str] = None
    created_at: datetime


class AlertAckResponse(BaseModel):
    status: str = "ok"
    alert_id: int
    acknowledged: bool
