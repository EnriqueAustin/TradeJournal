"""Signal analytics microservice (FastAPI).

Heavy quant for the Signal research module: indicators, correlation/regression,
z-scores, COT analytics, seasonality, expected-move, event-reaction, backtesting.
Stateless HTTP under /compute/*; reads market.db READ-ONLY. Node owns caching.
See docs/signal/ARCHITECTURE.md and docs/signal/API-CONTRACT.md.

S0.1 ships only /health. Compute routers are added per docs/signal/ROADMAP.md.
"""
import os

from fastapi import FastAPI

APP_VERSION = "0.1.0"
MARKET_DB_PATH = os.environ.get("MARKET_DB_PATH", "/data/market.db")

app = FastAPI(title="Signal Analytics", version=APP_VERSION)


@app.get("/health")
def health() -> dict:
    """Liveness probe. Reports whether the shared market.db is visible (RO)."""
    db_visible = os.path.exists(MARKET_DB_PATH)
    return {
        "ok": True,
        "service": "analytics",
        "version": APP_VERSION,
        "market_db_path": MARKET_DB_PATH,
        "market_db_visible": db_visible,
    }


@app.get("/")
def root() -> dict:
    return {"service": "signal-analytics", "docs": "/docs", "health": "/health"}
