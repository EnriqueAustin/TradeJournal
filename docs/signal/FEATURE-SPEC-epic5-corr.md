# FEATURE-SPEC — Epic 5: Positioning, Correlation & Seasonality

> Bloomberg CORR/HRA/COMP/CIX/SEAG parity: rolling correlation matrix, regression + beta, normalized comparison overlay, custom-spread builder, enhanced seasonality with significance. Cross-instrument.

## Pre-existing infrastructure

| Component | Status | Location |
|---|---|---|
| 3 instruments (XAUUSD, US100, XAGUSD) D1 bars | **built** | `prices` table via OANDA ingest |
| 18 FRED macro series | **built** | `series_data` table via `ingest/fred.js` |
| 3 CBOE vol indices (VIX, VXN, GVZ) | **built** | `series_data` table via `ingest/cboe.js` |
| COT positioning (gold) | **built** | `cot` table via `ingest/cftc.js` |
| ETF flows (GLD) | **built** | `etf_holdings` table via `ingest/etf.js` |
| `zScore()` + `rollingCorrelation()` | **built** | `routes.js` (module-level helpers) |
| Python FastAPI skeleton | **built** | `analytics/app/main.py` (health only) |
| Node→Python proxy | **built** | `analyticsClient.js` `compute(path, body)` |
| `analytics_cache` table | **built** | `schema.js` — keyed by input_hash + data_version |
| SeasonalityPanel (monthly) | **built** | `SeasonalityPanel.tsx` + `GET /seasonality/:instrument` |
| Gold/silver ratio | **built** | `GoldSilverPanel.tsx` + `GET /ratio/gold-silver` |
| Real-yield overlay + correlation | **built** | `RealYieldOverlay.tsx` + `GET /overlay/xauusd/realyield` |
| RegimePanel | **built** | `RegimePanel.tsx` + `GET /regime` |

## Data sources

All data already ingested. No new external feeds needed. Oil (WTICO_USD) requires adding to OANDA ingest config (3-line change) for richer correlation universe.

## Architecture decision: Node-first, Python-deferred

Per ARCHITECTURE.md compute-placement rule, correlation/regression/seasonality are Python-domain. However, the Python analytics service has no compute routers yet, and the data volumes are small (daily bars, <1000 rows per series for 60–252d windows). **Decision: build Node compute stubs first** (consistent with how S2.4/S3.1/S4.2 were done), with the same API shape the Python endpoints will eventually serve. When Python compute is stood up, routes swap from inline compute to `analyticsClient.compute()` transparently.

---

## Sessions

### S5.1 — Correlation matrix + regression + comparison

**Scope:** Rolling correlation heatmap, OLS-style regression with beta, normalized multi-series overlay (COMP-equivalent), custom-spread builder (CIX).

#### New data: Oil instrument

Add `WTICO_USD` (WTI Crude Oil) to OANDA ingest pipeline:
- `schema.js` `INSTRUMENTS` seed: `{ symbol: 'WTICO_USD', name: 'WTI Crude Oil', type: 'commodity' }`
- `oanda.js` `OANDA_INSTRUMENTS`: add entry
- `routes.js` `SYMBOL_MAP`: add mapping
- `marketdata.js` `OANDA_SYMBOL`: add `WTICO_USD: 'WTICO_USD'`

#### Route: `GET /api/research/correlation`

Query params: `?window=60&series=XAUUSD,US100,XAGUSD,WTICO_USD,DGS10,DFII10,DTWEXBGS,VIX,GVZ`

Computes pairwise Pearson correlation over the last `window` trading days using daily close / daily value. Returns an N×N matrix.

```ts
interface CorrelationCell {
  pair: [string, string];
  corr: number;          // -1 to 1
  n: number;             // sample size
}

interface CorrelationResponse {
  window: number;
  labels: string[];      // ordered series names
  matrix: number[][];    // N×N symmetric
  cells: CorrelationCell[]; // flat list of upper-triangle pairs
  asOf: number;          // epoch ms
}
```

Compute (Node stub):
1. For each series in the request, fetch the last `window` daily values from `prices` (D1 close) or `series_data` (value).
2. Align by date (inner join on trading days).
3. Compute pairwise Pearson correlation: `Σ((xi-μx)(yi-μy)) / (σx·σy·n)`.
4. Return matrix + metadata.

Default series set (if none specified): `XAUUSD, US100, DGS10, DFII10, DTWEXBGS, VIX`.

#### Route: `GET /api/research/regression/:instrument`

Query params: `?vs=DGS10&window=60`

OLS regression of instrument daily returns against a macro series. Returns beta, R², intercept, residuals summary.

```ts
interface RegressionResponse {
  instrument: string;
  vs: string;
  window: number;
  beta: number;
  r2: number;
  intercept: number;
  correlation: number;
  n: number;
  scatter: { x: number; y: number }[];  // daily return pairs
  asOf: number;
}
```

Compute (Node stub):
1. Fetch D1 closes for both series over `window` days.
2. Compute daily log returns.
3. OLS: beta = cov(x,y)/var(x), intercept = μy - beta·μx, R² = corr².
4. Return scatter points for chart overlay.

#### Route: `GET /api/research/compare`

Query params: `?series=XAUUSD,US100,DGS10&window=60&mode=zscore`

Normalized comparison — z-score or percent-change rebased to 0.

```ts
interface CompareSeriesPoint {
  ts: number;
  values: Record<string, number>;  // series_name → normalized value
}

interface CompareResponse {
  series: string[];
  mode: 'zscore' | 'pctChange';
  window: number;
  data: CompareSeriesPoint[];
  asOf: number;
}
```

#### Route: `GET /api/research/spread`

Query params: `?long=XAUUSD&short=XAGUSD&mode=ratio`

Custom spread: ratio (A/B) or difference (A-B).

```ts
interface SpreadPoint {
  ts: number;
  value: number;
  longPrice: number;
  shortPrice: number;
}

interface SpreadResponse {
  long: string;
  short: string;
  mode: 'ratio' | 'difference';
  current: number;
  mean: number;
  stddev: number;
  zScore: number;
  percentile: number;
  data: SpreadPoint[];
  asOf: number;
}
```

#### Panels

**CorrelationPanel.tsx** (cross-instrument, span=6):
- SVG heatmap grid: rows × cols = series labels; cells colored by correlation (-1 red → 0 gray → +1 green).
- Window selector: 20d / 60d / 120d / 252d.
- Click cell → shows time-series overlay of the pair.
- Default series: XAUUSD, US100, DGS10, DFII10, DXY (DTWEXBGS), VIX.

**RegressionPanel.tsx** (cross-instrument, span=6):
- Scatter plot (daily returns) with regression line.
- Stats row: β, R², corr, n.
- Instrument selector + "vs" series selector.
- Default: XAUUSD vs DFII10.

**ComparePanel.tsx** (cross-instrument, span=6):
- Multi-line z-score overlay chart (SVG, same pattern as RealYieldOverlay).
- Series checkboxes (add/remove series).
- Mode toggle: z-score / % change.
- Color-coded lines with legend.

**SpreadPanel.tsx** (cross-instrument, span=6):
- Spread line chart with mean ± 1σ / 2σ bands (Bollinger-style).
- Current value, z-score badge, percentile.
- Long/short instrument selectors + mode toggle (ratio/difference).
- Default: gold/silver ratio (same data as GoldSilverPanel but with z-score/bands).

#### Acceptance criteria
- [ ] Correlation heatmap renders with ≥6 series, window selector works
- [ ] Regression scatter + stats render for any instrument vs any FRED/CBOE series
- [ ] Compare overlay shows ≥3 series normalized, mode toggle works
- [ ] Spread panel shows ratio/diff with z-score bands
- [ ] Oil (WTICO_USD) ingests and appears in correlation universe
- [ ] `tsc --noEmit` clean

---

### S5.2 — Regime-conditional correlation + flow consolidation

**Scope:** Filter correlation by risk regime; unified positioning/flow panel with contrarian signals.

#### Route: `GET /api/research/correlation/regime`

Query params: `?window=252&series=XAUUSD,US100,DGS10&regime=risk-on`

Same as `/correlation` but filters to days where the stored regime matches. Requires regime history — either store daily regime snapshots or compute on-the-fly from stored VIX/HY/DXY.

```ts
interface RegimeCorrelationResponse extends CorrelationResponse {
  regime: string;           // risk-on | neutral | risk-off | crisis
  regimeDays: number;       // how many days in this regime within window
}
```

Compute: recompute regime for each historical day (VIX/HY/DXY from series_data), filter price/series data to matching days, run correlation.

#### Route: `GET /api/research/positioning/:instrument`

Unified positioning view: COT (gold), ETF flows, put/call (when available). Contrarian flags when positioning is extreme.

```ts
interface PositioningResponse {
  instrument: string;
  cot?: CotSummary;
  etf?: { tonnes: number; delta: number; trend: string };
  contrarian: {
    flag: boolean;
    reason: string;  // e.g. "MM net long at 95th percentile — historically bearish"
  };
  asOf: number;
}
```

#### Panels

**RegimeCorrelationToggle** — adds a regime dropdown to CorrelationPanel (ALL / RISK-ON / NEUTRAL / RISK-OFF / CRISIS). Selecting a regime re-fetches with `?regime=` param.

**PositioningPanel.tsx** (instrument-conditional for XAUUSD, span=6):
- Consolidated view: COT gauge (reuse CotPanel internals) + ETF trend + contrarian flag.
- Red/green contrarian badge when positioning hits extremes.

#### Acceptance criteria
- [ ] Regime dropdown on correlation panel filters the matrix
- [ ] Positioning panel shows COT + ETF + contrarian flag for XAUUSD
- [ ] `tsc --noEmit` clean

---

### S5.3 — Enhanced seasonality module

**Scope:** Expand seasonality beyond monthly: week-of-year, day-of-week, session (Asia/London/NY), OpEx/quad-witching effects, significance testing.

#### Route: `GET /api/research/seasonality/:instrument` (enhanced)

Additional query params: `?granularity=monthly|weekly|dow|session&minSamples=10`

```ts
interface SeasonalBucket {
  label: string;         // "Jan", "W03", "Mon", "London"
  avgReturn: number;
  medianReturn: number;
  winRate: number;
  sampleSize: number;
  tStat: number;         // t-statistic vs 0
  pValue: number;        // significance
  significant: boolean;  // p < 0.05
}

interface EnhancedSeasonalityResponse {
  instrument: string;
  granularity: string;
  buckets: SeasonalBucket[];
  opexEffect?: {
    opexWeekAvg: number;
    nonOpexWeekAvg: number;
    significant: boolean;
  };
  asOf: number;
}
```

Compute (Node stub):
- Monthly: same as current but add median, t-stat, p-value.
- Weekly (WoY): group D1 returns by ISO week number.
- DoW: group by day of week (Mon-Fri).
- Session: requires intraday bars (H1); classify by session (Asia 00-08 UTC, London 08-13 UTC, NY 13-21 UTC).
- OpEx: third Friday of each month; compare OpEx-week returns to non-OpEx weeks.
- T-statistic: `t = avgReturn / (stdReturn / √n)`. p-value approximation or lookup.

#### Panel: Enhanced SeasonalityPanel.tsx

Replace existing SeasonalityPanel with richer version:
- Granularity tabs: Monthly | Weekly | Day-of-Week | Session
- Bar chart with significance markers (★ for p < 0.05, bold border).
- Win rate overlay dots.
- OpEx effect card (if granularity=monthly or weekly).
- Sample size shown per bucket.

#### Acceptance criteria
- [ ] All 4 granularity modes render
- [ ] Significance markers appear on statistically significant buckets
- [ ] OpEx effect shown for monthly/weekly views
- [ ] Backward compatible — monthly view looks the same as before plus significance
- [ ] `tsc --noEmit` clean

---

## Wire-up summary

All new panels are cross-instrument (shown on both tabs) except PositioningPanel (XAUUSD only, replaces standalone CotPanel + EtfFlowPanel in the gold section).

Signal.tsx additions:
- After RegimePanel: CorrelationPanel, RegressionPanel, ComparePanel, SpreadPanel
- XAUUSD section: replace CotPanel + EtfFlowPanel with PositioningPanel
- Both sections: replace SeasonalityPanel with EnhancedSeasonalityPanel

## Build order

S5.1 first (correlation/regression/compare/spread) — highest value, most Bloomberg-parity items. S5.3 second (seasonality enhancement — self-contained). S5.2 last (regime-conditional + flow consolidation — depends on S5.1 correlation + existing COT/ETF).
