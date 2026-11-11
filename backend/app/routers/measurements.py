"""Measurements History Router."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Measurement, Node
from app.schemas import MeasurementOut

router = APIRouter(prefix="/api/v1/measurements", tags=["Measurements"])


@router.get("", response_model=List[MeasurementOut])
def get_measurements(
    node_id: Optional[str] = Query(None, description="Filter by node_id"),
    from_ts: Optional[datetime] = Query(None, alias="from", description="Start timestamp (ISO-8601)"),
    to_ts: Optional[datetime] = Query(None, alias="to", description="End timestamp (ISO-8601)"),
    limit: int = Query(100, ge=1, le=1000, description="Max records to return"),
    db: Session = Depends(get_db),
) -> List[MeasurementOut]:
    """Retrieve historical sensor measurements with filtering and pagination."""
    query = db.query(Measurement)

    if node_id:
        query = query.filter(Measurement.node_id == node_id)
    if from_ts:
        query = query.filter(Measurement.ts >= from_ts)
    if to_ts:
        query = query.filter(Measurement.ts <= to_ts)

    # Return descending by time (most recent first)
    records = query.order_by(Measurement.ts.desc()).limit(limit).all()
    return records


@router.get("/latest", response_model=List[MeasurementOut])
def get_latest_measurements(db: Session = Depends(get_db)) -> List[MeasurementOut]:
    """Get the most recent measurement for every registered node."""
    nodes = db.query(Node).all()
    results = []

    for node in nodes:
        latest = (
            db.query(Measurement)
            .filter(Measurement.node_id == node.node_id)
            .order_by(Measurement.ts.desc())
            .first()
        )
        if latest:
            results.append(latest)

    return results

