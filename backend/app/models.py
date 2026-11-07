"""SQLAlchemy ORM Models for Marine Pollution IoT Platform."""

from __future__ import annotations

from datetime import datetime
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.database import Base


class Node(Base):
    """IoT Station / Buoy Node entity."""

    __tablename__ = "nodes"

    node_id = Column(String(50), primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    last_seen = Column(DateTime, nullable=True)
    status = Column(String(20), default="offline", nullable=False)  # "online" or "offline"

    # Relationships
    measurements = relationship("Measurement", back_populates="node", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="node", cascade="all, delete-orphan")


class Measurement(Base):
    """Time-series sensor telemetry measurement."""

    __tablename__ = "measurements"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    node_id = Column(String(50), ForeignKey("nodes.node_id"), nullable=False, index=True)
    seq = Column(Integer, nullable=True)
    ts = Column(DateTime, nullable=False, index=True)
    temp_c = Column(Float, nullable=False)
    ph = Column(Float, nullable=False)
    tds_ppm = Column(Float, nullable=False)
    turbidity_ntu = Column(Float, nullable=False)
    color_r = Column(Integer, default=0, nullable=False)
    color_g = Column(Integer, default=0, nullable=False)
    color_b = Column(Integer, default=0, nullable=False)
    rssi = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    node = relationship("Node", back_populates="measurements")


class Alert(Base):
    """Environmental anomaly alert record."""

    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    node_id = Column(String(50), ForeignKey("nodes.node_id"), nullable=False, index=True)
    ts = Column(DateTime, nullable=False, index=True)
    type = Column(String(50), default="anomaly", nullable=False)
    cause = Column(String(100), nullable=False)  # e.g. acidic_industrial, domestic_sewage, algal_bloom, runoff_sediment
    confidence = Column(Float, nullable=False)  # Confidence percentage (0.0 to 100.0)
    acknowledged = Column(Boolean, default=False, nullable=False, index=True)
    details = Column(Text, nullable=True)  # Optional JSON or descriptive details
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    node = relationship("Node", back_populates="alerts")

