"""Router: POST /compute/drivers — gold driver scorecard (S3.1 Python compute).

Stateless. Node gathers the aligned series from market.db and posts them here;
we return the enriched scorecard. Keeping the DB read on the Node side (single
writer) avoids cross-process SQLite locking on the shared WAL file.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.compute.drivers import score_drivers

router = APIRouter(prefix="/compute", tags=["drivers"])


class GoldBar(BaseModel):
    ts: int
    c: float | None = None


class SeriesPoint(BaseModel):
    ts: int
    value: float | None = None


class DriverInput(BaseModel):
    id: str
    name: str | None = None
    relationship: str = "direct"
    zThresh: float = 0.5
    series: list[SeriesPoint] = Field(default_factory=list)


class DriversRequest(BaseModel):
    instrument: str = "XAUUSD"
    window: int = 60
    gold: list[GoldBar] = Field(default_factory=list)
    drivers: list[DriverInput] = Field(default_factory=list)


@router.post("/drivers")
def compute_drivers(req: DriversRequest) -> dict:
    return score_drivers(req.model_dump())
