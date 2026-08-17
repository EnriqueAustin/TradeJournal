# BLOOMBERG-PARITY — master coverage matrix

Every Bloomberg Terminal capability a gold desk or a Nasdaq desk uses for **XAUUSD / US100**, mapped to a Signal feature, with build status. This is the **floor, not the ceiling** — before each epic, deep-research the domain and expand into `FEATURE-SPEC-<epic>.md`, then update the Status here.

**Status:** `planned` · `spec` (FEATURE-SPEC written) · `built` · `gap` (free data can't reach it — records paid upgrade path).

## Charting & technicals (both) → S0.4, S3/S1
| BBG fn | Feature | Session | Status |
|---|---|---|---|
| GP/GPO/G | Multi-TF candle chart + studies (MA/EMA/RSI/MACD/BB/ATR/VWAP/Ichimoku/Fib/pivots) | S0.4 | **built** (chart + 7 TFs; studies deferred to Epic 1+) |
| GIP | Intraday view + session shading | S0.4 | planned (chart renders intraday; session shading deferred) |
| HP | OHLCV table + CSV export | S0.4 | **built** (CSV export live) |
| TAS | Auto S/R, pivots, round numbers, prior H/L, event markers | S0.4/S4.3 | planned |
| GRAB | Panel share (html-to-image, exists) | S8.3 | planned |

## US100 — index analysis
| BBG fn | Feature | Session | Status |
|---|---|---|---|
| MOV/IMOV/GRR | Mag-7 + full contribution grid | S1.2 | **built** (weight×changePct, sortable, summary bar) |
| MEMB | Constituents + weights | S1.1 | **built** (top-40 QQQ + Alpaca quotes) |
| MRR | Member leaderboard | S1.2 | **built** (sortable by Impact/Weight/Chg%/A-Z) |
| IMAP | Sector/constituent treemap | S1.3 | **built** (mini heatmap + sector table) |
| WEI/WEIF | Global index board | S1.4 | planned |
| breadth | %>MA, A/D, new H/L, thrust | S1.3 | **built** (A/D ratio + bar; MA-based breadth planned) |
| WPE | Valuation / equity-risk-premium | S2 | planned |
| RV | Relative-value board | S1.6 | planned |
| EQS | Constituent screener | S1.6 | planned |
| ERN/EE/ANR | Earnings + est/surprise + importance | S1.6 | **built** (Finnhub, weight-ranked, surprise calc) |
| HDS/DVD | Ownership/dividend context | S1.6 | gap? (free-data limited) |
| SOX | Semis tell (SOX/NDX) | S1.4 | planned |

## Gold — commodity desk
| BBG fn | Feature | Session | Status |
|---|---|---|---|
| Forward curve | Term structure + contango/backwardation + roll | S3.6 | gap (free-data; deferred — see FEATURE-SPEC) |
| CFTC/COT | Positioning gauge + percentiles + extremes | S3.3 | **built** (CotPanel; net MM/%long/WoW/percentile/extreme) |
| SEAG | Seasonality + significance | S3.5/S5.3 | **built** (monthly/weekly/dow/session + t-stat significance + OpEx effect) |
| real-yield/DXY | Driver scorecard + composite gauge | S3.1 | **built** (7-driver z-score + composite gauge) |
| ETF holdings | GLD/IAU flows + trend | S3.4 | **built** (GLD only; IAU deferred) |
| CB demand | WGC structural demand | S3.4 | planned (manual/quarterly) |
| GVZ | Gold IV/RV + expected move | S3.5 | **built** (S1.5) |
| gold/silver | Ratio + percentile | S3.5 | **built** (GoldSilverPanel; ratio + 1Y percentile) |
| key levels | Auto pivots/rounds/structure | S3.5 | **built** (KeyLevelsPanel) |

## Rates & macro (both)
| BBG fn | Feature | Session | Status |
|---|---|---|---|
| WIRP | Fed rate-probability tracker | S2.2 | planned (Python compute deferred) |
| ECO | Forward economic calendar | S4.1 | **built** (CalendarPanel; date-grouped, impact filter, countdowns, risk badge) |
| ECST | Econ series board | S2.3 | **built** (CPI/PCE/PAYEMS/UNRATE + MoM/YoY + sparklines) |
| ECFC | Consensus vs prior | S2.3 | planned (surprise z-scores need Python) |
| ECSU | Surprise index | S2.3 | planned (Python compute deferred) |
| FOMC/FED | Fed-path context | S2.2 | planned (Python compute deferred) |
| BTMM | Rates board | S2.2 | **built** (18 series sectioned: nominal/real/breakevens/spreads/policy + yield curve) |
| YCRV | Treasury yield curve | S2.2 | **built** (SVG curve in RatesBoard) |
| FXIP/DXY | Dollar panel | S2.1 | **built** (DTWEXBGS in rates board + regime panel) |
| risk regime | Risk-on/off classifier | S2.4 | **built** (VIX/HY/breadth/DXY composite; Python compute deferred) |

## Options, vol & expected move (both)
| BBG fn | Feature | Session | Status |
|---|---|---|---|
| OMON | QQQ option monitor (free chains) | S1.7 | gap? |
| OVDV | Skew + term-structure read | S1.5/S3.5 | planned |
| HIVG/HVG | IV history + IV/RV + regime | S1.5/S3.5 | **built** (VXN/GVZ history + 60d percentile + sparkline) |
| expected move | Range bands on chart | S1.5 | **built** (daily/weekly 1σ from VXN/GVZ) |
| put/call | P/C + percentile | S1.7 | planned |

## Cross-asset & relative value (both)
| BBG fn | Feature | Session | Status |
|---|---|---|---|
| CORR | Rolling correlation matrix | S5.1 | **built** (CorrelationPanel; 20/60/120/252d windows, 6-series heatmap) |
| HRA/BETA | Regression + beta + lead/lag | S5.1 | **built** (RegressionPanel; OLS scatter, β/R²/corr stats) |
| COMP/TRAY | Normalized return compare | S5.1 | **built** (ComparePanel; z-score/% overlay, multi-series toggle) |
| CIX | Custom synthetic spread builder | S5.1 | **built** (SpreadPanel; ratio/diff + mean ± σ bands, z-score) |
| regime corr | Regime-conditional correlations | S5.2 | **built** (regime dropdown on CorrelationPanel; risk-on/neutral/risk-off/crisis) |

## News, research & AI (both)
| BBG fn | Feature | Session | Status |
|---|---|---|---|
| N/TOP/NI/CN | Tagged, sentiment-scored feed | S6.1 | **built** (NewsFeedPanel; GDELT+RSS, sentiment, instrument tags) |
| BI-style briefs | Daily AI brief + explain-this-move | S6.2/S6.3 | **built** (BriefPanel QUICK/FULL; WHY? on PricePanel) |

## Monitors, alerts, workspace (both)
| BBG fn | Feature | Session | Status |
|---|---|---|---|
| LAUNCHPAD | Draggable saved layouts + cmdk palette | S8.3 | planned |
| ALRT | Alerts (price/driver/event/positioning/vol/corr) | S8.1 | planned |
| MOST/BLP | Watchlist + most-active | S1/S8 | planned |
| BBXL | CSV/Excel export everywhere | S0.4+ | planned |

## Signal-only (Bloomberg has NONE of these — the moat)
| Feature | Session | Status |
|---|---|---|
| Trade-journal fusion (context snapshot per trade) | S7.1 | **built** (auto-capture on trade insert + manual/batch API) |
| Context tab + frozen snapshot dashboard | S7.2 | **built** (ContextTab on TradeDetail; 11 market sections) |
| Condition replay (frozen Signal panels from snapshot) | S7.2 | planned (deferred to Epic 8) |
| Edge analytics (P&L × driver states) | S7.3 | **built** (EdgePanel; 6 dimensions, min-5 bucket, best-edge callout) |
| Instrument-specific event-reaction studies | S4.2 | **built** (EventReactionPanel; 5-window stats + beat/miss segmentation) |
| AI debrief coach on captured trade context | S7.3 | **built** (DebriefPanel; structured coaching + regenerate) |

## Known free-data gaps (record, don't drop)
- **Options chains** (OMON/OVDV full depth) for gold — thin/absent free. Use VXN/GVZ/put-call proxies; paid feed = upgrade path.
- **Consolidated tick tape** — IEX single-venue + OANDA broker feed; paid SIP feed = upgrade path.
- **Ownership/analyst depth (HDS/ANR)** — Finnhub free is thinner than Bloomberg; note per-panel.
