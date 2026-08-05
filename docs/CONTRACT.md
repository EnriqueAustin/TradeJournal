# Trade Journal — Shared Contract (Phase 0 MVP)

Local single-user app. JS stack. Server = Node/Express/better-sqlite3. Web = React/Vite/TS/Tailwind.
All times stored UTC. Money in account currency. Session derived from entry_time.

## Monorepo layout
```
/server   Node ESM API + SQLite
/web      Vite React TS app
/docs     this contract
/samples  example MT5 report(s) for import testing
```

## Run
- server: `npm run dev` in /server → http://localhost:4000
- web:    `npm run dev` in /web → http://localhost:5173 (proxy /api → 4000)

## Sessions (UTC hour of entry_time)
- asia:    22:00–06:59
- london:  07:00–11:59
- overlap: 12:00–15:59  (London/NY)
- ny:      16:00–20:59
- off:     21:00–21:59

## Data model (SQLite)
accounts(id, name, broker, platform, account_type, currency, starting_balance, prop_daily_loss, prop_max_dd, prop_target, created_at)
trades(id, account_id, instrument, direction[long|short], entry_time, exit_time,
  entry_price, exit_price, size, gross_pnl, commission, swap, net_pnl, r_multiple,
  stop_price, target_price, mae, mfe, hold_time_sec, session, source[csv|html|ea|api], ext_id, created_at)
executions(id, trade_id, exec_time, price, size, side[in|out])
tags(id, category[setup|session|emotion|mistake|grade], name)
trade_tags(trade_id, tag_id)
notes(id, trade_id NULL, day NULL, body, rules_followed[0|1], created_at)
screenshots(id, trade_id, url)

- net_pnl = gross_pnl - commission - swap (parser computes if absent)
- r_multiple = net_pnl / risk, risk = abs(entry_price-stop_price)*size ; NULL if no stop
- session derived on insert
- ext_id = broker deal/position id for dedupe (unique per account)

## REST API (prefix /api)
GET  /accounts
POST /accounts                      {name,broker,platform,account_type,currency,starting_balance,prop_*}
GET  /trades?account&instrument&session&from&to&limit&offset  → {rows,total}
GET  /trades/:id                    → trade + executions + tags + notes + screenshots
PATCH /trades/:id                   {stop_price,target_price,notes...} editable fields
POST /trades/:id/tags               {category,name} → adds tag
DELETE /trades/:id/tags/:tagId
POST /trades/:id/notes              {body,rules_followed}
GET  /stats/summary?account&instrument&session&from&to
     → {net_pnl,gross_pnl,trade_count,win_rate,profit_factor,expectancy,avg_win,avg_loss,
        avg_r,largest_win,largest_loss,commission,swap}
GET  /stats/equity?...              → [{t,cum_pnl}]   (ordered by exit_time)
GET  /stats/calendar?...&month=YYYY-MM → [{day,net_pnl,trade_count,r}]
GET  /stats/session?...             → [{session,instrument,net_pnl,trade_count,win_rate,avg_r}]
GET  /stats/hourly?...              → [{hour,instrument,net_pnl,trade_count}]  (0-23 UTC)
POST /import  (multipart file)      → parses MT5 CSV or HTML report → inserts trades/executions
     resp {inserted,skipped,account_id}
POST /webhook/trade  (Bearer token) → single trade JSON from EA (stub for Phase 1)

All endpoints JSON. Errors: {error:string} + proper status.

## Import parser (Phase 0)
Support MetaTrader 5 History report exports:
- HTML report ("Save as Report") — parse the Deals/Positions table.
- CSV/XLSX-as-CSV export — parse Positions rows.
Map broker deals → round-trip trades (group by position id). Compute net_pnl, session, hold_time.
Dedupe by (account_id, ext_id). Detect instrument (XAUUSD, US100/NAS100/USTEC → normalize US100; XAUUSD/GOLD → XAUUSD).

## Frontend pages
- Dashboard: summary stat tiles, equity curve, P&L calendar, session heatmap. Global filters: account, instrument, session, date range.
- Trades: filterable table → row click → Trade detail (edit stop/target, tags, notes, screenshots).
- Import: drag-drop file upload → result.
- Accounts: list + create.

Charts: Lightweight-Charts for equity/price, Recharts for heatmap/bars. Tailwind dark theme.

---

# Phase 1 — Frictionless capture + edge (spec)
Schema additions (ALTER/CREATE IF NOT EXISTS, keep migrations idempotent):
- setups(id, name, instrument NULL, rules TEXT, created_at)
- trades.setup_id (FK NULL)
- (mae, mfe, hold_time_sec already exist on trades)
API:
- GET/POST/PATCH/DELETE /api/setups
- PATCH /api/trades/:id  → also accepts setup_id, mae, mfe
- GET /api/stats/setup?filters   → [{setup_id,name,net_pnl,trade_count,win_rate,avg_r,expectancy}]
- GET /api/stats/holdtime?filters → buckets [{bucket,label,net_pnl,trade_count,win_rate}] by hold_time_sec (e.g. <30s,30-60s,1-2m,2-5m,5-15m,>15m); also split winners vs losers avg hold time
- GET /api/stats/excursion?filters → MAE/MFE aggregates (avg mae/mfe of winners vs losers, % that hit >1R MFE then lost)
- POST /webhook/trade already exists — harden it (validate, normalize instrument, dedupe by ext_id, derive session/hold/net).
EA: create `integrations/mt5/TradeJournalEA.mq5` — an MT5 Expert Advisor that on OnTradeTransaction (deal added, entry=out) reads the closed position and POSTs JSON to http://localhost:4000/webhook/trade with Bearer EA_TOKEN. Include a comment header with install steps. Fields: ext_id(position id), instrument, direction, entry/exit time+price, size, commission, swap, gross_pnl. Also `integrations/ctrader/` a short README on the Open API alternative (no code needed).
Web: new **Playbook** page (setups CRUD + per-setup performance table from /stats/setup). Add setup selector on Trade detail + setup column/filter on Trades. New **Analytics** page (or Dashboard section): hold-time bucket bar chart + MAE/MFE panel. Add setup to global filter bar.

# Phase 2 — Discipline & prop-firm (spec)
Schema: (accounts.prop_* already exist). Add daily_stats materialization optional; compute on the fly is fine.
API:
- GET /api/stats/prop?account → {starting_balance, current_equity, day_pnl, day_loss_limit, day_loss_used_pct, max_dd, max_dd_used_pct, target, target_progress_pct, breaches:[...], status:ok|warn|breach}
- GET /api/stats/adherence?filters → rule-followed % (from notes.rules_followed + grade tags A+/A/B/C distribution), adherence vs pnl correlation
- GET /api/stats/streaks?filters → current/max win & loss streaks, consistency (best day % of total), by-day table
- GET /api/stats/tilt?filters → flag days/sequences with rapid re-entries after a loss (e.g. next trade <120s after a losing exit), revenge-trade clusters → [{time,instrument,gap_sec,pnl}]
Web: new **Risk** page — prop guardrail meters (daily loss, max DD, target) with green/amber/red, adherence score card, streaks/consistency, tilt warnings list.

# Phase 3 — Replay, backtest, AI (spec)
Schema:
- price_bars(id, instrument, tf, t, open, high, low, close, volume)  unique(instrument,tf,t)
API:
- POST /api/bars/import (multipart CSV: time,open,high,low,close,vol; +instrument,tf fields) → bulk insert
- GET /api/bars?instrument&tf&from&to → OHLC array for chart
- GET /api/trades/:id/replay → bars window around entry/exit + entry/exit/stop/target markers
- Backtest: POST /api/backtest {instrument,tf,from,to,setup_id?} → returns bars + lets UI log hypothetical trades; POST /api/backtest/trades to save hypothetical trades (flag is_backtest)
- AI: POST /api/ai/review {date|from,to,filters} → calls Anthropic API (model claude-opus-4-8 or claude-sonnet-5) with the day's stats+notes+trades, returns {summary, patterns:[...], suggestions:[...]}. Key from env ANTHROPIC_API_KEY. Use @anthropic-ai/sdk. Degrade gracefully if key missing.
Web: **Replay** page (lightweight-charts, plot bars + entry/exit/stop/target, step controls), **Backtest** page (pick range/setup, click chart to log hypothetical trades, see results), **AI Review** panel on Dashboard (button → renders summary/patterns/suggestions).
