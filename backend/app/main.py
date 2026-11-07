"""Cloud Backend API (FastAPI) for Marine Pollution IoT Platform.

Provides REST and WebSocket endpoints for:
- Data Ingestion from IoT Gateways (/api/v1/ingest)
- Monitoring Station metadata & status (/api/v1/nodes)
- Historical and latest measurements (/api/v1/measurements)
- Pollution anomaly alerts & acknowledgments (/api/v1/alerts)
- Real-time event streaming (/ws)
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from typing import AsyncGenerator
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.database import Base, SessionLocal, engine
from app.models import Node
from app.routers import alerts, ingest, measurements, nodes, ws
from app.services.ml_service import ml_service

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("marine.backend")


def seed_default_nodes(db: Session) -> None:
    """Ensure default nodes exist with realistic coastal coordinates."""
    default_nodes = [
        {
            "node_id": "node01",
            "name": "Trạm Bãi biển Ngoài khơi (Node 01)",
            "lat": 16.0748,
            "lon": 108.2441,
            "status": "online",
        },
        {
            "node_id": "node02",
            "name": "Trạm Cửa sông / Cảng cá (Node 02)",
            "lat": 16.0585,
            "lon": 108.2312,
            "status": "online",
        },
    ]

    for item in default_nodes:
        existing = db.query(Node).filter(Node.node_id == item["node_id"]).first()
        if not existing:
            node = Node(
                node_id=item["node_id"],
                name=item["name"],
                lat=item["lat"],
                lon=item["lon"],
                status=item["status"],
            )
            db.add(node)
            logger.info(f"Seeded default station: {item['node_id']} ({item['name']})")
    db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application startup and shutdown lifecycle management."""
    logger.info("Initializing database tables...")
    Base.metadata.create_all(bind=engine)

    # Seed default monitoring stations
    db = SessionLocal()
    try:
        seed_default_nodes(db)
    finally:
        db.close()

    # Warm-up ML model
    ml_service.load_model()
    logger.info("Marine Pollution IoT Backend is READY.")

    yield

    logger.info("Shutting down Marine Pollution IoT Backend.")


app = FastAPI(
    title="Marine Pollution IoT API",
    description="Real-time coastal water quality monitoring, ML anomaly detection, and alert platform.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware (permits Web Console dashboards on any host/port)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(ingest.router)
app.include_router(nodes.router)
app.include_router(measurements.router)
app.include_router(alerts.router)
app.include_router(ws.router)


@app.get("/health", tags=["Health"])
def health() -> dict:
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "marine-pollution-backend",
        "ml_model_loaded": ml_service.is_loaded,
        "classes": ml_service.classes if ml_service.is_loaded else [],
    }


@app.get("/", tags=["Root"])
def root() -> dict:
    """Root info endpoint."""
    return {
        "title": "Marine Pollution IoT Platform API",
        "documentation": "/docs",
        "health": "/health",
    }
