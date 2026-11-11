"""Alerts and Anomaly Events Router."""

from __future__ import annotations

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Alert
from app.schemas import AlertAckResponse, AlertOut

router = APIRouter(prefix="/api/v1/alerts", tags=["Alerts"])


@router.get("", response_model=List[AlertOut])
def get_alerts(
    node_id: Optional[str] = Query(None, description="Filter by node_id"),
    unacknowledged_only: bool = Query(False, description="Filter only unacknowledged alerts"),
    limit: int = Query(50, ge=1, le=500, description="Max alerts to return"),
    db: Session = Depends(get_db),
) -> List[AlertOut]:
    """Retrieve pollution anomaly alerts, ordered by most recent."""
    query = db.query(Alert)

    if node_id:
        query = query.filter(Alert.node_id == node_id)
    if unacknowledged_only:
        query = query.filter(Alert.acknowledged == False)

    alerts = query.order_by(Alert.ts.desc()).limit(limit).all()
    return alerts


@router.post("/{alert_id}/ack", response_model=AlertAckResponse)
def acknowledge_alert(alert_id: int, db: Session = Depends(get_db)) -> AlertAckResponse:
    """Acknowledge an alert to mark it as inspected by an operator."""
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert id {alert_id} not found.",
        )

    alert.acknowledged = True
    db.commit()

    return AlertAckResponse(alert_id=alert.id, acknowledged=True)

