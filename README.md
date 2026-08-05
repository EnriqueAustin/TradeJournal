# Trade Journal

Local, single-user trade journal for scalping **XAUUSD** and **US100**. JS stack, runs on your PC.

## Stack
- **server/** — Node + Express + better-sqlite3 (SQLite). REST API on :4000.
- **web/** — React + Vite + TS + Tailwind. UI on :5173 (proxies `/api`).
- **docs/CONTRACT.md** — API + data model spec.

## Quick start
```bash
npm install                # root (concurrently)
npm run install:all        # installs server + web deps
npm run dev                # runs both server + web
```
Open http://localhost:5173 → **Import** page → drop an MT5 history export (see `samples/`).

## Run with Docker
```bash
docker compose up --build     # → http://localhost:8080
```
Two containers: `server` (API) and `web` (nginx serving the built SPA and
proxying `/api`). The SQLite database + screenshots persist in the named volume
`journal-data` (survives restarts). Copy `.env.example` → `.env` to set
`EA_TOKEN` / `ANTHROPIC_API_KEY`.

## Import
MT5: *History → right-click → Report → Save as*. All four export formats work:
**HTML**, **CSV**, **XLSX** ("Open XML (MS Office)"), and **XML** (SpreadsheetML).
Upload on the Import page. Trades are deduped by broker deal/position id.
Sample: `samples/mt5_deals_sample.csv`.

## Roadmap (see docs/CONTRACT.md for Phase 0 detail)
- **Phase 0 (this)** — CSV/HTML import, stats, equity curve, P&L calendar, session/instrument filters.
- **Phase 1** — EA webhook real-time capture, session heatmap, setups/playbook, hold-time & MAE/MFE.
- **Phase 2** — prop-firm rule tracking, rule-adherence, tilt detection.
- **Phase 3** — trade replay, backtesting, AI session review.

## Safety
If you later add the EA webhook, use the **investor (read-only)** password only, and protect `/webhook/trade` with the Bearer token.
