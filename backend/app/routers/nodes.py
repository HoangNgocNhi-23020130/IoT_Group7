"""Nodes Management Router."""

from __future__ import annotations

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Measurement, Node
from app.schemas import NodeCreate, NodeOut

router = APIRouter(prefix="/api/v1/nodes", tags=["Nodes"])


@router.get("", response_model=List[NodeOut])
def list_nodes(db: Session = Depends(get_db)) -> List[NodeOut]:
    """List all registered monitoring nodes with their latest measurement."""
    nodes = db.query(Node).all()
    results = []

    for node in nodes:
        latest = (
            db.query(Measurement)
            .filter(Measurement.node_id == node.node_id)
            .order_by(Measurement.ts.desc())
            .first()
        )
        node_dict = {
            "node_id": node.node_id,
            "name": node.name,
            "lat": node.lat,
            "lon": node.lon,
            "last_seen": node.last_seen,
            "status": node.status,
            "latest_measurement": latest,
        }
        results.append(NodeOut(**node_dict))

    return results


@router.get("/{node_id}", response_model=NodeOut)
def get_node(node_id: str, db: Session = Depends(get_db)) -> NodeOut:
    """Get details and latest measurement for a specific node."""
    node = db.query(Node).filter(Node.node_id == node_id).first()
    if not node:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Node '{node_id}' not found.",
        )

    latest = (
        db.query(Measurement)
        .filter(Measurement.node_id == node.node_id)
        .order_by(Measurement.ts.desc())
        .first()
    )

    return NodeOut(
        node_id=node.node_id,
        name=node.name,
        lat=node.lat,
        lon=node.lon,
        last_seen=node.last_seen,
        status=node.status,
        latest_measurement=latest,
    )


@router.post("", response_model=NodeOut, status_code=status.HTTP_201_CREATED)
def register_or_update_node(payload: NodeCreate, db: Session = Depends(get_db)) -> NodeOut:
    """Register or update an IoT node's metadata."""
    node = db.query(Node).filter(Node.node_id == payload.node_id).first()
    if not node:
        node = Node(
            node_id=payload.node_id,
            name=payload.name,
            lat=payload.lat,
            lon=payload.lon,
            status=payload.status or "offline",
        )
        db.add(node)
    else:
        node.name = payload.name
        if payload.lat is not None:
            node.lat = payload.lat
        if payload.lon is not None:
            node.lon = payload.lon
        if payload.status:
            node.status = payload.status

    db.commit()
    db.refresh(node)

    return NodeOut(
        node_id=node.node_id,
        name=node.name,
        lat=node.lat,
        lon=node.lon,
        last_seen=node.last_seen,
        status=node.status,
        latest_measurement=None,
    )
