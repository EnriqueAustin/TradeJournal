# Trade Journal

Local, single-user trade journal for scalping **XAUUSD** and **US100**. JS stack, runs on your PC.

## Stack
- **server/** — Node + Express + better-sqlite3 (SQLite). REST API on :4000.
- **web/** — React + Vite + TS + Tailwind. UI on :5173 (proxies `/api`).
- **docs/CONTRACT.md** — API + data model spec.

## Run without Docker (local dev)

**Prerequisites**
- [Node.js 22+](https://nodejs.org/) and npm.
- A C/C++ build toolchain, since `better-sqlite3` compiles a native module on install:
  - Windows: `npm install -g windows-build-tools` or install "Desktop development with C++" via Visual Studio Build Tools.
  - macOS: Xcode Command Line Tools (`xcode-select --install`).
  - Linux: `build-essential`/`python3`.

```bash
git clone <this-repo-url>
cd TradeJournal
npm install                # root (concurrently)
npm run install:all        # installs server + web deps
npm run dev                # runs both server + web
```
Open http://localhost:5173 → **Import** page → drop an MT5 history export (see `samples/`).

## Run with Docker

**Prerequisites**
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose) — Windows/macOS/Linux. Make sure it's running before the next step.
- [Git](https://git-scm.com/downloads), to clone the repo.
- No Node.js install needed — the containers build everything.

**First-time setup**
```bash
git clone <this-repo-url>
cd TradeJournal
cp .env.example .env      # edit .env if you want AI review / EA webhook (both optional)
docker compose up --build
```
Then open **http://localhost:8080**.

Two containers: `server` (API) and `web` (nginx serving the built SPA and
proxying `/api`). The SQLite database + screenshots persist in the named volume
`journal-data` (survives restarts and `docker compose down`; use `docker compose down -v`
to wipe it). All `.env` values are optional — the app runs with just the defaults:
- `EA_TOKEN` — bearer token protecting the `/webhook/trade` EA endpoint. Only matters if you wire up the MT5 EA later.
- `ANTHROPIC_API_KEY` — enables AI trade review/auto-tag endpoints. Leave blank to disable them (the app degrades gracefully, no crash).
- `AI_MODEL` / `AI_MODEL_FALLBACK` — override which Claude models are used for AI review.
- `OANDA_API_TOKEN` / `OANDA_ENV` — optional price-data source for replay.

**Common commands**
```bash
docker compose up --build     # (re)build and start
docker compose up -d          # start in background
docker compose logs -f        # tail logs
docker compose down           # stop (keeps data)
docker compose down -v        # stop and wipe the journal-data volume
```

**Updating after a `git pull`**
```bash
docker compose up --build
```
Compose only rebuilds images whose source changed, so this is safe to run every time.

## Import
MT5: *History → right-click → Report → Save as*. All four export formats work:
**HTML**, **CSV**, **XLSX** ("Open XML (MS Office)"), and **XML** (SpreadsheetML).
Upload on the Import page. Trades are deduped by broker deal/position id.
Sample: `samples/mt5_deals_sample.csv`.

### Watch folder (auto-import)
Point the server at a folder and it polls it every 30s (`IMPORT_WATCH_SEC`) for
`.csv/.htm/.html/.xlsx/.xml` reports. Each file goes through the same pipeline as
an upload (broker-tz → UTC, dedupe by broker id, bar auto-fetch, MAE/MFE), then
moves to `processed/` — or to `failed/` with a `<file>.log` explaining why (a file
that yields zero trades counts as failed). Files modified in the last 5s are left
for the next scan so half-written exports aren't picked up.

- Configure on the Import page (saved in the DB), or with env vars, which win:
  `IMPORT_WATCH_DIR` (absolute path) and `IMPORT_WATCH_ACCOUNT` (account id).
- Default account: `IMPORT_WATCH_ACCOUNT` / the saved one / else the first account.
  Per-file override: prefix the name with `acc<id>_`, e.g. `acc3_ReportHistory.html`.
- Docker: the folder must exist inside the `server` container — add a bind mount,
  e.g. `- "C:/Users/you/Documents/MT5 Reports:/import"` under `server.volumes`,
  and set `IMPORT_WATCH_DIR=/import`.

## Backups & restore
- **Automatic:** while the server runs it snapshots the journal daily (on startup
  if the newest backup is >24h old, then every 24h). `BACKUP_AUTO=0` disables it.
- **Manual:** Accounts page → *Backup now* (or `POST /api/backup`).
- **Where:** `BACKUP_DIR`, default `backups/` next to the journal DB
  (`server/data/backups`; in Docker `/app/data/backups` inside the `journal-data`
  volume — mount a host folder there if you want copies outside Docker).
  Each backup is `journal-YYYYMMDD-HHMMSS.db` (UTC; a consistent SQLite online
  backup, safe while the app is writing) plus a sibling
  `journal-YYYYMMDD-HHMMSS-screenshots/` with copies of the screenshot files trades
  reference. The newest `BACKUP_KEEP` (default 14) are kept.
- **Download:** Accounts page backup list, or `GET /api/backups/<name>/download`
  (the `.db` file; screenshots stay in the backup folder).
- **Export:** *Export all (JSON)* / `GET /api/export/all` dumps every journal table
  (trades, executions, notes, tags, setups, accounts, goals, missed trades, custom
  fields, plans, backtest sessions, …) for portability. Price bars, the news cache
  and live positions are excluded (re-fetchable).

**Restore (manual, on purpose — there is no restore API):**
1. Stop the server (`Ctrl+C`, or `docker compose stop server`).
2. Keep the current DB aside: rename `server/data/journal.db` to e.g.
   `journal.db.before-restore`, and **delete** `journal.db-wal` / `journal.db-shm`
   if present (stale WAL files would be replayed onto the restored DB).
3. Copy the chosen `journal-YYYYMMDD-HHMMSS.db` to `server/data/journal.db`.
4. Copy the files from `journal-YYYYMMDD-HHMMSS-screenshots/` into
   `server/data/screenshots/` (existing files with the same name are identical).
5. Start the server. Migrations run on startup, so older backups upgrade in place.

Docker: do the same inside the volume, e.g.
`docker compose run --rm --entrypoint sh server` then work in `/app/data`
(backups are in `/app/data/backups`).

## Roadmap (see docs/CONTRACT.md for Phase 0 detail)
- **Phase 0 (this)** — CSV/HTML import, stats, equity curve, P&L calendar, session/instrument filters.
- **Phase 1** — EA webhook real-time capture, session heatmap, setups/playbook, hold-time & MAE/MFE.
- **Phase 2** — prop-firm rule tracking, rule-adherence, tilt detection.
- **Phase 3** — trade replay, backtesting, AI session review.

## Safety
If you later add the EA webhook, use the **investor (read-only)** password only, and protect `/webhook/trade` with the Bearer token.
