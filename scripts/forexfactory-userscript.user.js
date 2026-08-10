// ==UserScript==
// @name         Trade Journal — ForexFactory calendar bridge
// @namespace    tradejournal.local
// @version      1.0
// @description  Scrape the ForexFactory calendar (actuals + event links) from YOUR browser session and POST it to the local Trade Journal server, bypassing the Cloudflare/CORS wall the server hits.
// @match        https://www.forexfactory.com/calendar*
// @match        https://forexfactory.com/calendar*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

// WHY THIS EXISTS
// The server (and any plain fetch) is Cloudflare-blocked from ForexFactory, and
// the free JSON feed carries no `actual` values or event links. But your real
// browser loads the calendar fine — and FF ships the full dataset as a JS object
// on the page (window.calendarComponentStates), including UTC `dateline`,
// `actual`, `impactName`, and a per-event `url`. This script reads that object
// (no extra request to FF, so no rate limit) and forwards it to the app every
// few seconds, so actuals appear in the journal within seconds of release.
//
// Setup: install Tampermonkey, add this script, open forexfactory.com/calendar
// (week view recommended so the whole week is scraped). Adjust INGEST_URL if the
// app isn't at localhost:8080.

(function () {
  'use strict';

  const INGEST_URL = 'http://localhost:8080/api/news/ingest';
  const INTERVAL_MS = 15_000; // re-forward the in-page data every 15s
  const FF_BASE = 'https://www.forexfactory.com';

  // Pull every event out of FF's in-page calendar state. Uses `dateline`
  // (absolute UTC seconds) so the UTC timestamp matches the server's exactly and
  // scraped rows UPDATE the feed-ingested rows rather than duplicating them.
  function collectEvents() {
    const states = unsafeWindow.calendarComponentStates;
    if (!states) return null; // page not ready / structure changed
    const items = [];
    for (const key of Object.keys(states)) {
      const st = states[key];
      if (!st || !Array.isArray(st.days)) continue;
      for (const day of st.days) {
        for (const e of day.events || []) {
          if (!e || !e.dateline || !e.name) continue;
          items.push({
            title: String(e.name),
            currency: String(e.currency || ''),
            date: new Date(e.dateline * 1000).toISOString(),
            impact: String(e.impactName || 'low'),
            forecast: e.forecast || '',
            previous: e.previous || '',
            actual: e.actual || '',
            url: e.url
              ? FF_BASE + e.url
              : e.soloUrl
                ? FF_BASE + e.soloUrl
                : '',
          });
        }
      }
    }
    return items;
  }

  function post(items) {
    GM_xmlhttpRequest({
      method: 'POST',
      url: INGEST_URL,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(items),
      onload: (res) => {
        if (res.status >= 200 && res.status < 300) {
          let n = items.length;
          try {
            n = JSON.parse(res.responseText).inserted ?? n;
          } catch (_) {
            /* ignore parse noise */
          }
          console.log(`[TJ bridge] ingested ${n} events → ${INGEST_URL}`);
        } else {
          console.warn(`[TJ bridge] ingest HTTP ${res.status}: ${res.responseText}`);
        }
      },
      onerror: (err) =>
        console.warn('[TJ bridge] ingest failed (is the app running?)', err),
    });
  }

  function tick() {
    const items = collectEvents();
    if (!items) {
      console.warn('[TJ bridge] calendarComponentStates not found on this page');
      return;
    }
    if (items.length) post(items);
  }

  // First pass shortly after load, then keep forwarding so live actuals flow.
  setTimeout(tick, 2000);
  setInterval(tick, INTERVAL_MS);
  console.log('[TJ bridge] active — forwarding ForexFactory calendar to', INGEST_URL);
})();
