"""Unit tests for the gold driver scorecard compute.

Run: analytics/.venv/Scripts/python -m pytest analytics/app/compute/drivers_test.py
(or plain `python -m app.compute.drivers_test` — see the __main__ guard).
No DB: synthetic aligned series exercise the statistics directly.
"""
from __future__ import annotations

import numpy as np

from app.compute.drivers import score_driver, score_drivers

DAY = 86_400_000


def _series(values, start_ts=1_600_000_000_000):
    return [{"ts": start_ts + i * DAY, "value": v} for i, v in enumerate(values)]


def _gold(values, start_ts=1_600_000_000_000):
    return [{"ts": start_ts + i * DAY, "c": v} for i, v in enumerate(values)]


def test_inverse_driver_falling_is_bullish():
    # Real yields fall hard at the end (low z) → bullish for gold; and gold rises
    # as the driver falls → negative returns-correlation (expected for inverse).
    rng = np.random.default_rng(0)
    n = 80
    driver = np.linspace(2.0, 0.5, n) + rng.normal(0, 0.01, n)
    gold = 1900 + (2.0 - driver) * 100 + rng.normal(0, 1, n)  # gold ~ inverse of driver
    d = score_driver(_gold(gold.tolist()),
                     {"id": "DFII10", "name": "10Y Real", "relationship": "inverse",
                      "zThresh": 0.5, "series": _series(driver.tolist())}, 60)
    assert d["zScore"] is not None and d["zScore"] < -0.5
    assert d["signal"] == "bullish"
    assert d["correlation"] is not None and d["correlation"] < 0  # inverse co-move
    assert d["r2"] is not None and 0.0 <= d["r2"] <= 1.0


def test_contradicting_correlation_neutralizes():
    # Level says bullish (inverse driver low) but gold actually moves WITH the
    # driver (positive corr) → conviction downgraded to neutral.
    rng = np.random.default_rng(1)
    n = 80
    driver = np.linspace(2.0, 0.5, n) + rng.normal(0, 0.02, n)
    gold = 1900 + driver * 50 + rng.normal(0, 0.5, n)  # gold tracks driver positively (contradicts inverse)
    d = score_driver(_gold(gold.tolist()),
                     {"id": "DFII10", "relationship": "inverse", "zThresh": 0.5,
                      "series": _series(driver.tolist())}, 60)
    assert d["correlation"] is not None and d["correlation"] > 0.3
    assert d["signal"] == "neutral"


def test_empty_series_is_safe():
    d = score_driver(_gold([1, 2, 3]),
                     {"id": "X", "relationship": "direct", "series": []}, 60)
    assert d["value"] is None and d["signal"] == "neutral"
    assert d["correlation"] is None and d["contribution"] is None


def test_composite_weights_and_shape():
    n = 80
    gold = _gold((1900 + np.arange(n) * 0.5).tolist())
    payload = {
        "instrument": "XAUUSD",
        "window": 60,
        "gold": gold,
        "drivers": [
            {"id": "DFII10", "relationship": "inverse", "zThresh": 0.5,
             "series": _series(np.linspace(2.0, 0.5, n).tolist())},  # falling → bullish
            {"id": "GVZ", "relationship": "direct", "zThresh": 1.0,
             "series": _series((15 + np.zeros(n)).tolist())},  # flat → neutral
        ],
    }
    res = score_drivers(payload)
    assert res["engine"] == "python"
    assert len(res["drivers"]) == 2
    assert res["composite"]["label"] in ("tailwind", "neutral", "headwind")
    assert 0.0 <= res["composite"]["confidence"] <= 1.0
    # All numeric fields must be JSON-safe (no NaN/inf).
    import math
    for d in res["drivers"]:
        for k in ("value", "zScore", "zChange", "correlation", "beta", "r2", "pValue", "contribution"):
            assert d[k] is None or math.isfinite(d[k])


if __name__ == "__main__":
    import traceback

    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok  {fn.__name__}")
        except Exception:  # noqa: BLE001
            failed += 1
            print(f" FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    raise SystemExit(1 if failed else 0)
