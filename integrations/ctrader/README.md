# cTrader integration (Open API alternative)

MetaTrader 5 users get the drop-in `TradeJournalEA.mq5` Expert Advisor (see
`integrations/mt5/`). cTrader has no MQL/EA equivalent, but you can feed the same
Trade Journal webhook two ways. This folder is documentation only — no code is
shipped yet.

## Option A — cAlgo cBot (simplest, runs inside cTrader)

cTrader Automate (cAlgo) lets you write C# **cBots**. A cBot can subscribe to
position events and POST to the journal, mirroring the MT5 EA.

- Handle `Positions.Closed` (event args expose the closed `Position`).
- Build the same JSON payload the MT5 EA sends:
  `ext_id` (use `position.Id`), `instrument` (`position.SymbolName`),
  `direction` (`position.TradeType` → long/short), entry/exit time+price,
  `size` (`position.VolumeInUnits` or lots), `commission`, `swap`, `gross_pnl`
  (`position.GrossProfit`), `net_pnl` (`position.NetProfit`).
- POST with `System.Net.Http.HttpClient` to
  `http://localhost:4000/webhook/trade` with header
  `Authorization: Bearer <EA_TOKEN>` and `Content-Type: application/json`.
- Reference the cTrader Automate API docs for `Position`, `Positions.Closed`,
  and `Symbol`. Network access from a cBot may require enabling access in the
  cBot settings, similar to MT5's WebRequest allow-list.

Prefer running the cBot on a **read-only / view** login where possible — the
journal only needs to read closed trades, never to place orders.

## Option B — cTrader Open API (out-of-process, no cBot)

The [cTrader Open API](https://help.ctrader.com/open-api/) is a protobuf-over-TLS
service (OAuth 2.0). A small external worker (Node/Python) can:

1. OAuth against `connect.spotware.com`, obtain an access token, and pick the
   trading account (`ProtoOAAccountAuthReq`).
2. Subscribe to execution events (`ProtoOAExecutionEvent`) or poll closed
   positions / deals (`ProtoOADealListReq`).
3. Map each closed position to the journal payload (same fields as above) and
   POST it to `http://localhost:4000/webhook/trade` with the Bearer token.

This keeps credentials out of the journal server and works even when cTrader
desktop is closed. Use it when you want a headless bridge or you already run a
server-side sync process.

## Payload contract (shared with MT5)

```json
{
  "ext_id": "<broker position id>",
  "instrument": "XAUUSD",
  "direction": "long",
  "entry_time": "2026-07-20T07:03:11Z",
  "exit_time":  "2026-07-20T07:09:44Z",
  "entry_price": 2410.25,
  "exit_price":  2413.10,
  "size": 0.50,
  "gross_pnl": 142.50,
  "commission": -7.00,
  "swap": 0.0,
  "net_pnl": 135.50,
  "account_id": 1
}
```

The server dedupes by `ext_id`, normalizes the instrument, and derives
session / hold time / net P&L, so re-sending the same position id is safe.
`account_id` is optional (omit to use the server's first account).
