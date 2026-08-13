# analytics — Signal quant microservice

FastAPI + pandas. Heavy quant for the Signal research module. Reads `market.db`
read-only; returns JSON; Node (`server/`) owns caching and serving.

## Run locally (dev)
```bash
cd analytics
python -m venv .venv
# Windows: .venv\Scripts\activate    |    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```
Then `GET http://localhost:8001/health` and interactive docs at `/docs`.

Point Node at it with `ANALYTICS_URL` (default `http://localhost:8001`).

## Run via Docker (with the whole stack)
```bash
docker compose up --build
```
`market.db` is mounted read-only at `/data/market.db` (env `MARKET_DB_PATH`).

## Layout
```
app/
  main.py        # FastAPI app + /health (S0.1)
  routers/       # /compute/* endpoints (added per docs/signal/ROADMAP.md)
  compute/       # pure quant functions (unit-tested against market.db fixtures)
```
See `docs/signal/API-CONTRACT.md` for the endpoint plan and `CONVENTIONS.md`.
