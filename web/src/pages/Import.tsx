import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import type { ImportResult, BarsImportResult, BarsFetchResult } from '../types';
import { Spinner } from '../components/states';

export default function Import() {
  const { refreshAccounts, accounts, filters, setFilters } = useFilters();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [account, setAccount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagResult, setTagResult] = useState<{
    tagged: number;
    requested: number;
    error?: string;
  } | null>(null);

  const pick = (f: File | null) => {
    setFile(f);
    setResult(null);
    setError(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pick(f);
  };

  // Effective target account: explicit pick → global filter → first account.
  const targetAccount = account ?? filters.account ?? accounts[0]?.id ?? null;

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setTagResult(null);
    try {
      const res = await api.importFile(file, targetAccount);
      setResult(res);
      setAccount(res.account_id);
      setFilters({
        account: res.account_id,
        instrument: 'All',
        session: 'All',
        setup: 'All',
        from: '',
        to: '',
      });
      refreshAccounts();
    } catch (e: any) {
      setError(e?.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const autoTag = async () => {
    if (!result) return;
    setTagBusy(true);
    setTagResult(null);
    try {
      const r = await api.autoTag({
        account_id: result.account_id,
        all_untagged: true,
      });
      setTagResult(r);
    } catch (e: any) {
      setTagResult({ tagged: 0, requested: 0, error: e?.message || 'Auto-tag failed' });
    } finally {
      setTagBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Import</h1>
        <p className="text-sm text-slate-500">
          Upload a MetaTrader 5 History report (HTML, CSV, XLSX/"Open XML", or
          XML) or a Match-Trader "Closed Positions" CSV. Trades are deduped by
          broker id.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition ${
          dragging
            ? 'border-indigo-500 bg-indigo-500/10'
            : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
        }`}
      >
        <div className="text-3xl text-slate-500">⤓</div>
        <div className="text-sm text-slate-300">
          {file ? (
            <span className="font-medium text-slate-100">{file.name}</span>
          ) : (
            <>
              <span className="font-medium text-indigo-400">Click to browse</span>{' '}
              or drag a report here
            </>
          )}
        </div>
        {file && (
          <div className="num text-xs text-slate-500">
            {(file.size / 1024).toFixed(1)} KB
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.htm,.html,.xlsx,.xml,text/csv,text/html,application/xml,text/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {accounts.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="label mb-0" htmlFor="import-account">
              Import into
            </label>
            <select
              id="import-account"
              className="input w-56"
              value={targetAccount ?? ''}
              onChange={(e) => {
                const next = e.target.value ? Number(e.target.value) : null;
                setAccount(next);
                if (next != null) setFilters({ account: next });
              }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
          className="btn btn-primary"
          onClick={upload}
          disabled={!file || busy}
        >
          {busy ? (
            <>
              <Spinner className="h-4 w-4" /> Importing…
            </>
          ) : (
            'Import file'
          )}
        </button>
        {file && !busy && (
          <button className="btn" onClick={() => pick(null)}>
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Import complete
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-slate-800/50 p-3">
              <div className="text-xs uppercase text-slate-500">Inserted</div>
              <div className="num mt-1 text-2xl font-semibold text-emerald-400">
                {result.inserted}
              </div>
            </div>
            <div className="rounded-lg bg-slate-800/50 p-3">
              <div className="text-xs uppercase text-slate-500">Skipped</div>
              <div className="num mt-1 text-2xl font-semibold text-amber-400">
                {result.skipped}
              </div>
            </div>
            <div className="rounded-lg bg-slate-800/50 p-3">
              <div className="text-xs uppercase text-slate-500">Account</div>
              <div className="num mt-1 text-2xl font-semibold text-slate-200">
                #{result.account_id}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              to="/trades"
              className="text-sm text-indigo-400 hover:text-indigo-300"
            >
              View imported trades →
            </Link>
            <button
              className="btn"
              onClick={autoTag}
              disabled={tagBusy || result.inserted === 0}
              title="Classify untagged trades with AI (setup + tags). Requires ANTHROPIC_API_KEY."
            >
              {tagBusy ? (
                <>
                  <Spinner className="h-4 w-4" /> Tagging…
                </>
              ) : (
                'Auto-tag with AI'
              )}
            </button>
            {tagResult && !tagResult.error && (
              <span className="text-sm text-emerald-400">
                Tagged {tagResult.tagged} / {tagResult.requested}
              </span>
            )}
            {tagResult?.error && (
              <span className="text-sm text-red-400">{tagResult.error}</span>
            )}
          </div>
        </div>
      )}

      <BarsImport />
    </div>
  );
}

function BarsImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [instrument, setInstrument] = useState('XAUUSD');
  const [tf, setTf] = useState('M1');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BarsImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live feed (OANDA) state.
  const [oanda, setOanda] = useState<boolean | null>(null);
  const [days, setDays] = useState(7);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feed, setFeed] = useState<BarsFetchResult | null>(null);
  const [feedErr, setFeedErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getBarsStatus()
      .then((s) => setOanda(s.oanda))
      .catch(() => setOanda(false));
  }, []);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.importBars(file, instrument, tf);
      setResult(res);
    } catch (e: any) {
      setError(e?.message || 'Bars import failed');
    } finally {
      setBusy(false);
    }
  };

  const updateFromFeed = async () => {
    setFeedBusy(true);
    setFeedErr(null);
    setFeed(null);
    try {
      const res = await api.fetchBars({
        instruments: ['XAUUSD', 'US100'],
        days,
      });
      setFeed(res);
    } catch (e: any) {
      setFeedErr(e?.message || 'Live fetch failed');
    } finally {
      setFeedBusy(false);
    }
  };

  return (
    <div className="card mt-4 flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">
          Import price bars
        </h2>
        <p className="text-xs text-slate-500">
          CSV with columns <span className="num">time,open,high,low,close,vol</span>{' '}
          for Replay and Backtest. Deduped on (instrument, tf, time). M1 auto-aggregates
          to M5/M15/M30/H1.
        </p>
      </div>

      {/* Live feed (OANDA) */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              Live feed{' '}
              {oanda === null ? (
                <span className="text-xs font-normal text-slate-500">…</span>
              ) : oanda ? (
                <span className="text-xs font-normal text-emerald-400">
                  ● OANDA connected
                </span>
              ) : (
                <span className="text-xs font-normal text-amber-400">
                  ● not configured
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Pull M1 candles for XAUUSD + US100 straight from OANDA. Trades also
              auto-fetch their bars on import.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="label" htmlFor="feed-days">
                Last N days
              </label>
              <input
                id="feed-days"
                type="number"
                min={1}
                max={90}
                className="input w-24"
                value={days}
                onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={updateFromFeed}
              disabled={feedBusy || oanda === false}
              title={oanda === false ? 'Set OANDA_API_TOKEN in server/.env' : undefined}
            >
              {feedBusy ? (
                <>
                  <Spinner className="h-4 w-4" /> Updating…
                </>
              ) : (
                'Update bars'
              )}
            </button>
          </div>
        </div>

        {oanda === false && (
          <p className="mt-2 text-xs text-amber-400/90">
            Add <span className="num">OANDA_API_TOKEN=…</span> to{' '}
            <span className="num">server/.env</span> (free practice token) and
            restart the server.
          </p>
        )}
        {feedErr && (
          <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/30 p-2 text-sm text-red-300">
            {feedErr}
          </div>
        )}
        {feed && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {feed.results.map((r) => (
              <span
                key={r.instrument}
                className={`rounded-full border px-2.5 py-1 ${
                  r.error
                    ? 'border-red-900/50 text-red-300'
                    : 'border-slate-700 text-slate-300'
                }`}
              >
                <span className="font-semibold">{r.instrument}</span>{' '}
                {r.error ? r.error : `${r.upserted} bars`}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="bars-inst">
            Instrument
          </label>
          <input
            id="bars-inst"
            className="input w-32"
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="bars-tf">
            Timeframe
          </label>
          <input
            id="bars-tf"
            className="input w-24"
            value={tf}
            onChange={(e) => setTf(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <label className="label">File</label>
          <button
            className="btn w-full justify-start"
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            {file ? file.name : 'Choose CSV…'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
        </div>
        <button
          className="btn btn-primary"
          onClick={upload}
          disabled={!file || busy || !instrument || !tf}
        >
          {busy ? (
            <>
              <Spinner className="h-4 w-4" /> Importing…
            </>
          ) : (
            'Import bars'
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg bg-slate-800/50 p-3">
            <div className="text-xs uppercase text-slate-500">Inserted</div>
            <div className="num mt-1 text-xl font-semibold text-emerald-400">
              {result.inserted}
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/50 p-3">
            <div className="text-xs uppercase text-slate-500">Skipped</div>
            <div className="num mt-1 text-xl font-semibold text-amber-400">
              {result.skipped}
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/50 p-3">
            <div className="text-xs uppercase text-slate-500">
              {result.instrument} {result.tf}
            </div>
            <div className="num mt-1 text-xl font-semibold text-slate-200">
              {result.total}
            </div>
          </div>
          <div className="flex items-center">
            <Link
              to={`/backtest`}
              className="text-sm text-indigo-400 hover:text-indigo-300"
            >
              Open Backtest →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
