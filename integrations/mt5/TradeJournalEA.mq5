//+------------------------------------------------------------------+
//|                                              TradeJournalEA.mq5   |
//|              Posts closed MT5 positions to the Trade Journal API  |
//+------------------------------------------------------------------+
//
//  WHAT IT DOES
//  ------------
//  On every trade transaction it watches for a closing deal
//  (DEAL_ENTRY_OUT / DEAL_ENTRY_INOUT). When a position closes it reads
//  the position's history (entry + exit deals), builds a JSON payload and
//  POSTs it to the Trade Journal webhook:
//
//      POST http://localhost:4000/webhook/trade
//      Authorization: Bearer <EA_TOKEN>
//      Content-Type: application/json
//
//  The server dedupes by ext_id (the broker position id), derives the
//  session / hold time / net P&L, and inserts the trade. Re-sending the
//  same position id is safe (it is skipped).
//
//  INSTALL
//  -------
//  1. Copy this file to:  <MT5 data folder>/MQL5/Experts/TradeJournalEA.mq5
//     (In MetaTrader:  File -> Open Data Folder -> MQL5 -> Experts)
//  2. Open MetaEditor, open the file, press F7 to compile.
//  3. In MetaTrader 5:  Tools -> Options -> Expert Advisors
//       - Tick "Allow WebRequest for listed URL"
//       - Add:   http://localhost:4000
//     (WebRequest is BLOCKED until the exact URL/host is on this allow list.
//      Both /webhook/trade and /webhook/positions live under this host.)
//  4. Drag "TradeJournalEA" onto ANY chart (one instance is enough — it
//     receives transactions for the whole account). Tick "Allow Algo
//     Trading" and make sure the Algo Trading toolbar button is green.
//  5. Set the inputs below:
//       - InpApiUrl   : keep the default unless the server runs elsewhere.
//       - InpToken    : MUST match EA_TOKEN in server/.env  (default "changeme").
//       - InpAccountId: optional; leave 0 to use the server's first account.
//
//  SECURITY / SAFETY
//  -----------------
//  * This EA only READS trade history and sends it out — it NEVER places,
//    modifies or closes orders. It is safe to run on a live account, but if
//    your broker offers an INVESTOR (read-only) password, prefer logging in
//    with that: it cannot trade at all, which removes any risk entirely.
//  * The token is a shared secret sent as a Bearer header. Keep the server
//    bound to localhost. Do not expose the webhook to the public internet
//    without TLS and a strong token.
//  * WebRequest is synchronous; keep the server responsive so the trading
//    thread is not blocked. Failures are logged to the Experts tab and the
//    position is retried on the next matching transaction/restart is not
//    automatic, so check the log if trades are missing.
//+------------------------------------------------------------------+
#property copyright "Trade Journal"
#property version   "1.00"
#property strict

input string InpApiUrl        = "http://localhost:4000/webhook/trade";     // Closed-trade webhook URL
input string InpPositionsUrl  = "http://localhost:4000/webhook/positions"; // Open-positions snapshot URL
input string InpToken         = "changeme";                                // Bearer token (= EA_TOKEN)
input long   InpAccountId     = 0;                                         // Journal account id (0 = server default)
input int    InpTimeoutMs     = 5000;                                      // WebRequest timeout (ms)
input int    InpLiveIntervalS = 3;                                         // Live snapshot interval (s, 0 = off)

//+------------------------------------------------------------------+
int OnInit()
  {
   PrintFormat("[TradeJournal] EA started. Closed -> %s ; Live -> %s", InpApiUrl, InpPositionsUrl);
   if(StringFind(InpApiUrl, "http://localhost") < 0 && StringFind(InpApiUrl, "http://127.0.0.1") < 0)
      Print("[TradeJournal] NOTE: remember to add the host to Tools->Options->Expert Advisors->Allow WebRequest.");
   if(InpLiveIntervalS > 0)
      EventSetTimer(InpLiveIntervalS);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

// Required for an EA; no per-tick logic needed.
void OnTick() { }

// Snapshot open positions on a timer for the live dashboard.
void OnTimer()
  {
   PostOpenPositions();
  }

//+------------------------------------------------------------------+
//| React to trade transactions — fire when a position closes.       |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;

   ulong deal_ticket = trans.deal;
   if(deal_ticket == 0)
      return;

   if(!HistoryDealSelect(deal_ticket))
      return;

   long entry = (long)HistoryDealGetInteger(deal_ticket, DEAL_ENTRY);
   if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT)
      return; // only act on the closing deal

   ulong position_id = (ulong)HistoryDealGetInteger(deal_ticket, DEAL_POSITION_ID);
   if(position_id == 0)
      return;

   PostPosition(position_id);
  }

//+------------------------------------------------------------------+
//| Aggregate all deals of a position and POST the round-trip.       |
//+------------------------------------------------------------------+
void PostPosition(ulong position_id)
  {
   if(!HistorySelectByPosition(position_id))
     {
      PrintFormat("[TradeJournal] could not select history for position %I64u", position_id);
      return;
     }

   int total = HistoryDealsTotal();

   string   symbol       = "";
   long     dir_type     = -1;      // POSITION type derived from the entry deal
   datetime entry_time   = 0, exit_time = 0;
   double   entry_px_vol = 0, exit_px_vol = 0;
   double   entry_vol    = 0, exit_vol   = 0;
   double   gross_pnl = 0, commission = 0, swap = 0, fee = 0;

   for(int i = 0; i < total; i++)
     {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      if((ulong)HistoryDealGetInteger(ticket, DEAL_POSITION_ID) != position_id) continue;

      long     entry  = (long)HistoryDealGetInteger(ticket, DEAL_ENTRY);
      double   vol    = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double   price  = HistoryDealGetDouble(ticket, DEAL_PRICE);
      datetime t      = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      long     dtype  = (long)HistoryDealGetInteger(ticket, DEAL_TYPE);

      if(symbol == "") symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);

      gross_pnl  += HistoryDealGetDouble(ticket, DEAL_PROFIT);
      commission += HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      swap       += HistoryDealGetDouble(ticket, DEAL_SWAP);
      #ifdef DEAL_FEE
      fee        += HistoryDealGetDouble(ticket, DEAL_FEE);
      #endif

      if(entry == DEAL_ENTRY_IN || (entry == DEAL_ENTRY_INOUT && entry_vol == 0))
        {
         entry_px_vol += price * vol;
         entry_vol    += vol;
         if(entry_time == 0 || t < entry_time) entry_time = t;
         // DEAL_TYPE_BUY(0) opening = long ; DEAL_TYPE_SELL(1) opening = short
         if(dir_type < 0) dir_type = dtype;
        }
      else // DEAL_ENTRY_OUT / closing side of INOUT
        {
         exit_px_vol += price * vol;
         exit_vol    += vol;
         if(t > exit_time) exit_time = t;
        }
     }

   if(entry_vol <= 0) { PrintFormat("[TradeJournal] position %I64u had no entry volume", position_id); return; }

   double entry_price = entry_px_vol / entry_vol;
   double exit_price  = exit_vol > 0 ? exit_px_vol / exit_vol : entry_price;
   double net_pnl     = gross_pnl + commission + swap; // commission/swap already signed (negative)
   string direction   = (dir_type == DEAL_TYPE_BUY) ? "long" : "short";

   string payload = "{";
   payload += "\"ext_id\":\""     + IntegerToString((long)position_id) + "\",";
   payload += "\"instrument\":\"" + JsonEscape(symbol) + "\",";
   payload += "\"direction\":\""  + direction + "\",";
   payload += "\"entry_time\":\"" + IsoUtc(entry_time) + "\",";
   payload += "\"exit_time\":\""  + IsoUtc(exit_time)  + "\",";
   payload += "\"entry_price\":"  + DoubleToString(entry_price, _Digits) + ",";
   payload += "\"exit_price\":"   + DoubleToString(exit_price, _Digits) + ",";
   payload += "\"size\":"         + DoubleToString(entry_vol, 2) + ",";
   payload += "\"gross_pnl\":"    + DoubleToString(gross_pnl, 2) + ",";
   payload += "\"commission\":"   + DoubleToString(commission, 2) + ",";
   payload += "\"swap\":"         + DoubleToString(swap, 2) + ",";
   payload += "\"net_pnl\":"      + DoubleToString(net_pnl, 2);
   if(InpAccountId > 0)
      payload += ",\"account_id\":" + IntegerToString(InpAccountId);
   payload += "}";

   SendJson(payload, position_id);
  }

//+------------------------------------------------------------------+
//| Snapshot every open position and POST as one array.              |
//+------------------------------------------------------------------+
void PostOpenPositions()
  {
   int total = PositionsTotal();
   string items = "";
   int emitted = 0;

   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;

      long   pos_id  = (long)PositionGetInteger(POSITION_IDENTIFIER);
      string symbol  = PositionGetString(POSITION_SYMBOL);
      long   ptype   = (long)PositionGetInteger(POSITION_TYPE);
      double vol     = PositionGetDouble(POSITION_VOLUME);
      double open_px = PositionGetDouble(POSITION_PRICE_OPEN);
      double cur_px  = PositionGetDouble(POSITION_PRICE_CURRENT);
      double profit  = PositionGetDouble(POSITION_PROFIT)
                       + PositionGetDouble(POSITION_SWAP);
      datetime otime = (datetime)PositionGetInteger(POSITION_TIME);
      string dir     = (ptype == POSITION_TYPE_BUY) ? "long" : "short";

      int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
      if(digits <= 0) digits = _Digits;

      if(emitted > 0) items += ",";
      items += "{";
      items += "\"ext_id\":\""       + IntegerToString(pos_id) + "\",";
      items += "\"instrument\":\""   + JsonEscape(symbol) + "\",";
      items += "\"direction\":\""    + dir + "\",";
      items += "\"size\":"           + DoubleToString(vol, 2) + ",";
      items += "\"entry_price\":"    + DoubleToString(open_px, digits) + ",";
      items += "\"entry_time\":\""   + IsoUtc(otime) + "\",";
      items += "\"current_price\":"  + DoubleToString(cur_px, digits) + ",";
      items += "\"unrealized_pnl\":" + DoubleToString(profit, 2);
      items += "}";
      emitted++;
     }

   string payload = "{\"positions\":[" + items + "]";
   if(InpAccountId > 0)
      payload += ",\"account_id\":" + IntegerToString(InpAccountId);
   payload += "}";

   SendPositions(payload, emitted);
  }

//+------------------------------------------------------------------+
//| HTTP POST to the positions snapshot endpoint.                    |
//+------------------------------------------------------------------+
void SendPositions(string payload, int count)
  {
   char post[];
   char resultData[];
   string resultHeaders;
   int len = StringToCharArray(payload, post, 0, StringLen(payload), CP_UTF8);
   if(len > 0) ArrayResize(post, len - 1);

   string headers = "Content-Type: application/json\r\n";
   headers += "Authorization: Bearer " + InpToken + "\r\n";

   ResetLastError();
   int status = WebRequest("POST", InpPositionsUrl, headers, InpTimeoutMs, post, resultData, resultHeaders);
   if(status == -1)
     {
      int err = GetLastError();
      PrintFormat("[TradeJournal] positions WebRequest failed (err %d). Is '%s' allow-listed?",
                  err, InpPositionsUrl);
     }
   // Success is silent to keep the Experts log clean; server logs handle audit.
  }

//+------------------------------------------------------------------+
//| HTTP POST via WebRequest.                                        |
//+------------------------------------------------------------------+
void SendJson(string payload, ulong position_id)
  {
   char post[];
   char resultData[];
   string resultHeaders;
   int len = StringToCharArray(payload, post, 0, StringLen(payload), CP_UTF8);
   if(len > 0) ArrayResize(post, len - 1); // drop trailing null

   string headers = "Content-Type: application/json\r\n";
   headers += "Authorization: Bearer " + InpToken + "\r\n";

   ResetLastError();
   int status = WebRequest("POST", InpApiUrl, headers, InpTimeoutMs, post, resultData, resultHeaders);

   if(status == -1)
     {
      int err = GetLastError();
      PrintFormat("[TradeJournal] WebRequest failed (err %d). Is '%s' on the Allow WebRequest list?",
                  err, InpApiUrl);
      return;
     }

   string body = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
   PrintFormat("[TradeJournal] position %I64u -> HTTP %d %s", position_id, status, body);
  }

//+------------------------------------------------------------------+
//| Helpers.                                                         |
//+------------------------------------------------------------------+
string IsoUtc(datetime t)
  {
   // MT5 server time is treated as UTC by the journal (same convention as CSV import).
   MqlDateTime st;
   TimeToStruct(t, st);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       st.year, st.mon, st.day, st.hour, st.min, st.sec);
  }

string JsonEscape(string s)
  {
   string out = s;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   return out;
  }
//+------------------------------------------------------------------+
