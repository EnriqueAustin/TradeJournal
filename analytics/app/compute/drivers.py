"""Gold driver scorecard — real quant (numpy/scipy).

Replaces the Node stub (spurious level-correlation + equal-weight composite)
with a statistically defensible read of how each macro driver is positioned
relative to gold. Pure functions; no DB access. Node passes aligned series in,
gets an enriched scorecard out. See docs/signal/FEATURE-SPEC-epic3-gold.md S3.1.

Method (per driver, over the trailing `window`, default 60 trading days):
  * Align driver level with gold D1 close by UTC calendar day (inner join).
  * z-score of the current *level* vs the window       → "how extreme now"
  * z-score of the latest *change* vs the window       → "how sharp the move"
  * Pearson correlation of gold log-returns vs driver  → real co-movement
    first-differences (both stationary), with p-value    (not spurious levels)
  * OLS beta of gold returns on driver changes + R²     → sensitivity + fit
  * contribution = beta * latest driver change          → expected gold %
                                                          push from this driver
  * signal from the level z-score + relationship, then confirmed by whether
    the returns-correlation carries the expected sign.

Composite weights each driver's signal by |returns correlation| (capped),
so drivers that actually co-move with gold dominate the tailwind/headwind read.
Confidence = share of drivers whose correlation is significant (p < 0.05).
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy import stats

DAY_MS = 86_400_000


def _day_key(ts_ms: float) -> int:
    return int(ts_ms // DAY_MS)


def _finite(x: Any) -> float | None:
    """Return a plain float, or None for NaN/inf/None (JSON-safe)."""
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _round(x: float | None, nd: int) -> float | None:
    return None if x is None else round(x, nd)


def _z_of_last(values: np.ndarray) -> float | None:
    """z-score of the final element vs the whole array (population std)."""
    if values.size < 2:
        return None
    sd = float(values.std())
    if sd == 0:
        return 0.0
    return _finite((float(values[-1]) - float(values.mean())) / sd)


def _align(gold: list[dict], series: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Inner-join gold close and a driver level on UTC day. Ascending by day.

    Returns (gold_levels, driver_levels) as parallel arrays.
    """
    gmap: dict[int, float] = {}
    for row in gold:
        v = _finite(row.get("c"))
        if v is not None:
            gmap[_day_key(row["ts"])] = v  # last write per day wins
    dmap: dict[int, float] = {}
    for row in series:
        v = _finite(row.get("value"))
        if v is not None:
            dmap[_day_key(row["ts"])] = v
    common = sorted(set(gmap) & set(dmap))
    g = np.array([gmap[k] for k in common], dtype=float)
    d = np.array([dmap[k] for k in common], dtype=float)
    return g, d


def _signal(z_level: float | None, relationship: str, z_thresh: float,
            corr: float | None) -> str:
    """Direction for gold from the driver's level extreme, confirmed by corr.

    inverse driver (real yields, DXY, fed funds): low z → bullish gold.
    direct driver (breakevens, GVZ, HY spread):   high z → bullish gold.
    A confirming returns-correlation strengthens conviction; a correlation that
    flips against the expected sign downgrades the call to neutral.
    """
    if z_level is None:
        return "neutral"
    if relationship == "inverse":
        raw = "bullish" if z_level < -z_thresh else "bearish" if z_level > z_thresh else "neutral"
        expected_sign = -1.0  # gold moves opposite the driver
    else:
        raw = "bullish" if z_level > z_thresh else "bearish" if z_level < -z_thresh else "neutral"
        expected_sign = 1.0
    # If we have a meaningful correlation that contradicts the relationship,
    # don't fight the tape — neutralize.
    if raw != "neutral" and corr is not None and abs(corr) >= 0.3:
        if math.copysign(1.0, corr) != expected_sign:
            return "neutral"
    return raw


def score_driver(gold: list[dict], drv: dict, window: int) -> dict:
    """Enriched score for one driver. `drv` carries id/name/relationship/zThresh/series."""
    relationship = drv.get("relationship", "direct")
    z_thresh = float(drv.get("zThresh", 0.5))
    series = drv.get("series", [])

    g_all, d_all = _align(gold, series)
    n = min(g_all.size, d_all.size)

    out: dict[str, Any] = {
        "id": drv["id"],
        "name": drv.get("name", drv["id"]),
        "relationship": relationship,
        "value": None,
        "zScore": None,
        "zChange": None,
        "signal": "neutral",
        "correlation": None,   # returns-based (real), not level correlation
        "beta": None,
        "r2": None,
        "pValue": None,
        "contribution": None,
    }
    if n == 0:
        return out

    g = g_all[-window:]
    d = d_all[-window:]
    out["value"] = _finite(d[-1])
    out["zScore"] = _round(_z_of_last(d), 2)

    # Changes / returns over the window (stationary series for correlation).
    if d.size >= 2:
        d_chg = np.diff(d)
        out["zChange"] = _round(_z_of_last(d_chg), 2)
    if g.size >= 3 and d.size >= 3:
        g_ret = np.diff(np.log(np.where(g > 0, g, np.nan)))
        d_chg = np.diff(d)
        mask = np.isfinite(g_ret) & np.isfinite(d_chg)
        gr, dc = g_ret[mask], d_chg[mask]
        if gr.size >= 5 and dc.std() > 0 and gr.std() > 0:
            reg = stats.linregress(dc, gr)  # gold_return ~ driver_change
            out["correlation"] = _round(_finite(reg.rvalue), 2)
            out["beta"] = _round(_finite(reg.slope), 6)
            r2 = _finite(reg.rvalue)
            out["r2"] = _round(r2 * r2, 3) if r2 is not None else None
            out["pValue"] = _round(_finite(reg.pvalue), 4)
            # Expected gold %-push = beta * latest driver change, in percent.
            latest_chg = float(dc[-1])
            if out["beta"] is not None:
                out["contribution"] = _round(out["beta"] * latest_chg * 100.0, 3)

    out["signal"] = _signal(out["zScore"], relationship, z_thresh, out["correlation"])
    return out


def score_drivers(payload: dict) -> dict:
    """Full scorecard. payload: {instrument, gold:[{ts,c}], drivers:[...], window?}."""
    gold = payload.get("gold", [])
    window = int(payload.get("window", 60))
    drivers = [score_driver(gold, d, window) for d in payload.get("drivers", [])]

    weight_of = {"bullish": 1.0, "neutral": 0.0, "bearish": -1.0}
    num = den = 0.0
    sig_total = sig_hits = 0
    for d in drivers:
        w = abs(d["correlation"]) if d["correlation"] is not None else 0.15
        w = min(max(w, 0.1), 1.0)  # floor so a driver never vanishes entirely
        num += weight_of[d["signal"]] * w
        den += w
        if d["pValue"] is not None:
            sig_total += 1
            if d["pValue"] < 0.05:
                sig_hits += 1
    score = (num / den) if den > 0 else 0.0
    label = "tailwind" if score > 0.3 else "headwind" if score < -0.3 else "neutral"
    confidence = (sig_hits / sig_total) if sig_total else 0.0

    return {
        "instrument": payload.get("instrument", "XAUUSD"),
        "drivers": drivers,
        "composite": {
            "score": _round(score, 2),
            "label": label,
            "confidence": _round(confidence, 2),
        },
        "engine": "python",
    }
