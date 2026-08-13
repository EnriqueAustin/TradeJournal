# FEATURE-SPEC — Epic 3: Gold Cockpit

> Gold desk parity: driver scorecard, real-yield overlay, COT positioning, ETF flows, gold/silver ratio, seasonality, key levels. Forward curve deferred (free-data gap).

## Pre-existing gold infrastructure

| Component | Status | Location |
|---|---|---|
| OANDA price pipeline (XAU_USD) | **built** | `ingest/oanda.js`, all 7 TFs |
| Live WebSocket ticker | **built** | `ws.js` |
| GVZ vol panel | **built** | `VolPanel instrument="XAUUSD"`, route `/vol/:instrument` |
| AI daily brief | **built** | `BriefPanel instrument="XAUUSD"`, route `/brief/:instrument` |
| Gold drivers in FRED | **built** | DFII10, DFII5, T10YIE, T5YIE, DTWEXBGS, FEDFUNDS, BAMLH0A0HYM2 |
| `cot` table schema | **exists** | `schema.js:93` — no ingestor/route yet |
| `etf_holdings` table schema | **exists** | `schema.js:103` — no ingestor/route yet |
| TS types: CotRow, EtfHolding | **exists** | `types.ts:656,666` |
| Driver scorecard placeholder | **exists** | `Signal.tsx:175` — stub panel |

## Sessions

### S3.1 — Driver scorecard + composite gauge

**What:** Flagship gold panel showing how each macro driver is positioned relative to gold. Each driver gets a current value, z-score (60d), directional signal (bullish/neutral/bearish for gold), and a rolling correlation with gold. A composite score aggregates into a tailwind/headwind/neutral gauge.

**Drivers (7):**

| Driver | Series | Gold relationship | Signal logic |
|---|---|---|---|
| Real Yield 10Y | DFII10 | Inverse (↑ real yields → ↓ gold) | z < −0.5 → bullish, z > 0.5 → bearish |
| Real Yield 5Y | DFII5 | Inverse | same as DFII10 |
| USD Index | DTWEXBGS | Inverse (↑ DXY → ↓ gold) | z < −0.5 → bullish, z > 0.5 → bearish |
| Breakeven 10Y | T10YIE | Direct (↑ inflation exp → ↑ gold) | z > 0.5 → bullish, z < −0.5 → bearish |
| Gold Vol (GVZ) | GVZ | Direct (↑ fear → ↑ gold) | z > 1.0 → bullish, z < −0.5 → bearish |
| HY Spread | BAMLH0A0HYM2 | Direct (↑ stress → ↑ gold safe haven) | z > 0.5 → bullish, z < −0.5 → bearish |
| Fed Funds | FEDFUNDS | Inverse (↑ rates → ↓ gold, higher opp cost) | z < −0.5 → bullish, z > 0.5 → bearish |

**Compute (Node stub, Python deferred):**
```
For each driver:
  1. Pull last 120 data points from series_data
  2. z-score = (current − mean_60d) / stddev_60d
  3. Signal = apply threshold table above
  4. Rolling corr with gold D1 close (60-day window, align by date)
  5. Composite = sum of signals (bullish=+1, neutral=0, bearish=−1) / count
     → tailwind (>0.3), neutral (−0.3 to 0.3), headwind (<−0.3)
```

**Route:** `GET /api/research/drivers/XAUUSD`

**Response:**
```ts
interface DriverScore {
  id: string;           // series_id
  name: string;         // short display name
  value: number | null; // current
  zScore: number | null;
  signal: 'bullish' | 'neutral' | 'bearish';
  correlation: number | null; // 60d rolling corr with gold
  relationship: 'direct' | 'inverse';
}
interface DriversResponse {
  instrument: string;
  drivers: DriverScore[];
  composite: { score: number; label: 'tailwind' | 'neutral' | 'headwind' };
  freshness: Freshness;
}
```

**Panel:** `DriverScorecard.tsx`
- Panel header: "DRIVER SCORECARD" + composite badge (tailwind→ok, neutral→muted, headwind→warn)
- Each driver row: name | value | z-score bar (green/red gradient) | signal dot | corr value
- Composite score bar at bottom

---

### S3.2 — Real-yield inverse overlay

**What:** Dual-axis SVG chart showing gold price vs inverted DFII10 (10-year real yield). When gold and inverted real yields track together, the fundamental relationship holds. Divergence = potential trade signal.

**Data:** Already exists (gold D1 bars + DFII10 series_data). Follows existing overlay pattern (`/overlay/us100/rates`).

**Route:** `GET /api/research/overlay/xauusd/realyield?limit=250`

**Response:**
```ts
interface RealYieldOverlayResponse {
  gold: { ts: number; c: number }[];        // D1 close
  realYield: { ts: number; value: number }[]; // DFII10 (un-inverted; client inverts for display)
  correlation60d: number | null;             // trailing 60d rolling corr
}
```

**Panel:** `RealYieldOverlay.tsx`
- Dual-axis SVG: gold (amber line, left axis) vs inverted DFII10 (cyan line, right axis)
- Correlation badge: "CORR −0.82" with color (strong neg = green for gold, weak = amber)
- Divergence flag when |corr| < 0.4 in last 20 days → "DIVERGENCE" warn badge

---

### S3.3 — COT positioning gauge

**What:** CFTC Commitments of Traders (disaggregated) for gold futures — managed money net positioning, percentile rank, extreme flags.

**Data source:** CFTC Disaggregated Futures-Only reports (free, public):
- Current year: `https://www.cftc.gov/dea/newcot/f_disagg.txt` (fixed-width text)
- Historical bulk CSVs: `https://www.cftc.gov/files/dea/history/fut_disagg_txt_YYYY.zip` (annual)
- Market filter: CFTC code `088691` = "GOLD - COMMODITY EXCHANGE INC."
- Release schedule: Friday 3:30pm ET for Tuesday positions
- **Format:** pipe-delimited or comma-delimited depending on source. Key columns:
  - `Market_and_Exchange_Names` — filter for "GOLD"
  - `M_Money_Positions_Long_All`, `M_Money_Positions_Short_All` — managed money
  - `Prod_Merc_Positions_Long_All`, `Prod_Merc_Positions_Short_All` — commercial/producer
  - `Open_Interest_All`

**Ingestor:** `server/src/research/ingest/cftc.js`
1. Fetch current year disaggregated report (CSV format preferred for parsing)
2. Filter rows where market contains "GOLD" and exchange is "COMMODITY EXCHANGE"
3. Map to `cot` table columns: report_date (Tuesday), mm_long, mm_short, comm_long, comm_short, oi
4. Upsert into `cot` table
5. Trigger: `POST /api/research/ingest/cftc`

**Route:** `GET /api/research/cot/gold`

**Compute (Node):**
```
net_mm = mm_long − mm_short
pct_long = mm_long / (mm_long + mm_short) × 100
wow_change = current net − prior week net
Percentile rank = rank of current net within last 52/156 weeks
Extreme flag = percentile > 90 or < 10
```

**Response:**
```ts
interface CotSummary {
  reportDate: number;
  mmLong: number;
  mmShort: number;
  mmNet: number;
  pctLong: number;
  commLong: number;
  commShort: number;
  commNet: number;
  oi: number;
  wowChange: number;
  percentile1y: number;
  percentile3y: number;
  extreme: boolean;
}
interface CotResponse {
  current: CotSummary;
  history: CotRow[];  // last 52 weeks
  freshness: Freshness;
}
```

**Panel:** `CotPanel.tsx`
- Header: "COT POSITIONING" + extreme badge if triggered
- Summary row: Net MM | %Long | WoW Δ | Pctile (1Y)
- Horizontal percentile bar (0–100, current position marked)
- Mini area chart: net MM positioning over 52 weeks (green above 0, red below)

---

### S3.4 — ETF flows + trend

**What:** GLD (SPDR Gold Shares) total holdings in tonnes + daily change + trend.

**Data source:**
- GLD: World Gold Council / SPDR publishes daily holdings. The direct CSV at `https://www.spdrgoldshares.com/assets/dynamic/GLD/GLD_US_archive.csv` has historically been available (may require user-agent header). Columns include Date, GLD Close, Shares, Assets(tonnes), etc.
- IAU: iShares does not publish a clean CSV. **Defer IAU** — single ETF (GLD) is sufficient as the primary gold ETF proxy (largest by AUM).
- If GLD CSV is unavailable or changes URL → fall back to manual CSV import endpoint.

**Ingestor:** `server/src/research/ingest/etf.js`
1. Fetch GLD archive CSV
2. Parse rows: date, tonnes, shares (skip header rows / metadata)
3. Upsert into `etf_holdings` table (etf='GLD')
4. Trigger: `POST /api/research/ingest/etf`
5. Fallback: `POST /api/research/ingest/etf/upload` accepts CSV body for manual import

**Route:** `GET /api/research/etf-flows/gold`

**Compute (Node):**
```
dailyChange = current tonnes − yesterday tonnes
weeklyChange = current tonnes − 5-day-ago tonnes
trend = sign of 20-day SMA slope
```

**Response:**
```ts
interface EtfFlowResponse {
  etf: string;                     // 'GLD'
  latestDate: number;
  tonnes: number;
  dailyChangeTonnes: number;
  weeklyChangeTonnes: number;
  trend: 'inflow' | 'flat' | 'outflow';
  history: { date: number; tonnes: number }[]; // last 90 days
  freshness: Freshness;
}
```

**Panel:** `EtfFlowPanel.tsx`
- Header: "ETF FLOWS (GLD)" + trend badge (inflow→ok, flat→muted, outflow→warn)
- Summary: Total tonnes | Daily Δ | Weekly Δ
- Mini area chart: tonnes over 90 days

---

### S3.5 — Gold/silver ratio + seasonality + key levels

**Sub-panels bundled into one session:**

#### a) Gold/Silver Ratio

**Data:** Gold prices exist (OANDA XAU_USD). Silver needs XAG_USD added to OANDA ingest.

**Change:** Add `XAGUSD → XAG_USD` to `ingest/oanda.js` instrument map + seed instrument in schema.

**Route:** `GET /api/research/ratio/gold-silver?limit=250`

**Response:**
```ts
interface GoldSilverResponse {
  ratio: number;                   // current gold/silver
  avg1y: number;
  high1y: number;
  low1y: number;
  percentile1y: number;
  history: { ts: number; ratio: number }[]; // D1
  freshness: Freshness;
}
```

**Panel:** `GoldSilverPanel.tsx`
- Current ratio (big number) + percentile rank
- 1Y range bar with current position
- Mini line chart (250 days)

#### b) Seasonality

**Data:** Compute from existing gold D1 bars in `prices` table. Need at least 3 years of history.

**Route:** `GET /api/research/seasonality/XAUUSD`

**Compute (Node):**
```
For each month (Jan–Dec):
  Gather all monthly returns for XAUUSD
  avg_return = mean
  win_rate = % positive months
  sample_n = count
```

**Response:**
```ts
interface SeasonalMonth {
  month: number;          // 1-12
  label: string;          // 'Jan'...'Dec'
  avgReturn: number;      // percent
  winRate: number;        // 0-100
  sampleSize: number;
}
interface SeasonalityResponse {
  instrument: string;
  months: SeasonalMonth[];
  currentMonth: number;
  freshness: Freshness;
}
```

**Panel:** `SeasonalityPanel.tsx`
- Bar chart: 12 months, green (positive avg) / red (negative avg)
- Current month highlighted with amber border
- Win-rate label below each bar

#### c) Key Levels (auto-detected)

**Data:** Compute from existing D1 bars.

**Route:** `GET /api/research/levels/XAUUSD`

**Compute (Node):**
```
1. Round numbers: nearest $50 and $100 above/below current (gold-specific)
2. Pivot points: classic pivots from prior D1 (PP, R1/R2/R3, S1/S2/S3)
3. Prior day H/L, prior week H/L
```

**Response:**
```ts
interface KeyLevel {
  label: string;       // 'R1', 'S1', 'Round 2500', 'Prev Day H', etc.
  price: number;
  type: 'pivot' | 'round' | 'structure';
}
interface LevelsResponse {
  instrument: string;
  currentPrice: number;
  levels: KeyLevel[];
  freshness: Freshness;
}
```

**Panel:** `KeyLevelsPanel.tsx`
- Sorted list of levels above/below current price
- Color: green (support below), red (resistance above), amber (round numbers)
- Current price marked with cyan indicator

---

### S3.6 — Futures forward curve → **DEFERRED (gap)**

**Reason:** Free gold futures term-structure data (GC1–GC6+ settlement prices) is not reliably available via API. CME requires a data license; Stooq has limited historical data only. This is a known gap per BLOOMBERG-PARITY.md.

**When to revisit:** If user obtains Nasdaq Data Link (Quandl) key, or if a free CME feed is identified. The route and panel design are recorded here for future implementation.

**Planned route:** `GET /api/research/curve/gold`
**Planned panel:** `ForwardCurvePanel.tsx` — term structure chart (contango/backwardation) + roll-yield read.

---

## Build order

| Step | Session | Deliverables | New data needed? |
|---|---|---|---|
| 1 | S3.1 | Driver scorecard route + panel | No (all FRED/CBOE data exists) |
| 2 | S3.2 | Real-yield overlay route + panel | No |
| 3 | S3.5c | Key levels route + panel | No (compute from prices) |
| 4 | S3.5b | Seasonality route + panel | No (compute from prices) |
| 5 | S3.5a | Gold/silver ratio — add XAG_USD ingest + route + panel | Yes (silver via OANDA) |
| 6 | S3.3 | CFTC ingestor + COT route + panel | Yes (CFTC download) |
| 7 | S3.4 | GLD ETF ingestor + flow route + panel | Yes (SPDR CSV) |
| 8 | — | Wire all panels into Signal.tsx, replace placeholder, tsc, docs | — |

Steps 1–4 use existing data only (no new ingestors). Steps 5–7 add new data pipelines. Step 8 is integration + verification.

## New types needed in `web/src/types.ts`

```ts
// S3.1
interface DriverScore { id: string; name: string; value: number | null; zScore: number | null; signal: 'bullish' | 'neutral' | 'bearish'; correlation: number | null; relationship: 'direct' | 'inverse'; }
interface DriversResponse { instrument: string; drivers: DriverScore[]; composite: { score: number; label: 'tailwind' | 'neutral' | 'headwind' }; freshness: Freshness; }

// S3.2
interface RealYieldOverlayResponse { gold: { ts: number; c: number }[]; realYield: { ts: number; value: number }[]; correlation60d: number | null; }

// S3.3 (CotRow + CotResponse — CotRow already exists)
interface CotSummary { reportDate: number; mmLong: number; mmShort: number; mmNet: number; pctLong: number; commLong: number; commShort: number; commNet: number; oi: number; wowChange: number; percentile1y: number; percentile3y: number; extreme: boolean; }
interface CotResponse { current: CotSummary; history: CotRow[]; freshness: Freshness; }

// S3.4
interface EtfFlowResponse { etf: string; latestDate: number; tonnes: number; dailyChangeTonnes: number; weeklyChangeTonnes: number; trend: 'inflow' | 'flat' | 'outflow'; history: { date: number; tonnes: number }[]; freshness: Freshness; }

// S3.5a
interface GoldSilverResponse { ratio: number; avg1y: number; high1y: number; low1y: number; percentile1y: number; history: { ts: number; ratio: number }[]; freshness: Freshness; }

// S3.5b
interface SeasonalMonth { month: number; label: string; avgReturn: number; winRate: number; sampleSize: number; }
interface SeasonalityResponse { instrument: string; months: SeasonalMonth[]; currentMonth: number; freshness: Freshness; }

// S3.5c
interface KeyLevel { label: string; price: number; type: 'pivot' | 'round' | 'structure'; }
interface LevelsResponse { instrument: string; currentPrice: number; levels: KeyLevel[]; freshness: Freshness; }
```

## UI layout (gold tab after Epic 3)

```
┌─ XAUUSD tab ──────────────────────────────────────────┐
│ PricePanel (col-8)        │ LiveTicker (col-4)        │
│ DriverScorecard (col-6)   │ RealYieldOverlay (col-6)  │
│ VolPanel (col-4)  │ CotPanel (col-4) │ EtfFlow (col-4)│
│ GoldSilver (col-4)│ Seasonal (col-4) │ KeyLvls (col-4)│
│ BriefPanel (col-12)                                   │
│ RatesBoard (col-12)       ← shared macro              │
│ EconTracker (col-12)      ← shared macro              │
│ RegimePanel (col-12)      ← shared macro              │
└───────────────────────────────────────────────────────┘
```

## Acceptance criteria (per session)

- **S3.1:** `/api/research/drivers/XAUUSD` returns 7 drivers with z-scores + composite. Panel renders with signal colors.
- **S3.2:** Overlay chart shows gold (amber) vs inverted real yield (cyan). Correlation badge displayed.
- **S3.3:** `POST /ingest/cftc` fetches CFTC data. `/cot/gold` returns current + 52-week history. Panel shows percentile gauge.
- **S3.4:** `POST /ingest/etf` fetches GLD CSV. `/etf-flows/gold` returns tonnes + trend. Panel shows flow chart.
- **S3.5a:** Silver ingest added. `/ratio/gold-silver` returns ratio + percentile. Panel renders.
- **S3.5b:** `/seasonality/XAUUSD` returns 12-month breakdown. Bar chart panel renders.
- **S3.5c:** `/levels/XAUUSD` returns pivots + round numbers + structure. Panel renders sorted list.
- **S3.6:** Deferred (documented gap).
- **All:** `tsc --noEmit` clean. Docs updated. No console errors in browser.
