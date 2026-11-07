"""Cloud backend (FastAPI). TODO: ingest, query, alerts, ML inference."""
from fastapi import FastAPI

app = FastAPI(title="Marine Pollution IoT API")

@app.get("/health")
def health():
    return {"status": "ok"}
