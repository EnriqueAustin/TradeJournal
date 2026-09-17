import { useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { UTCTimestamp } from 'lightweight-charts';
import CandleChart, { type ChartMarker } from '../components/CandleChart';
import { LoadingBlock } from '../components/states';
import { useApi } from '../hooks/useApi';
import { shareApi, type PublicShare, type PublicTrade, type PublicKpis } from '../api/profiles';
import { setTheme, useTheme } from '../store/theme';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPct,
  formatR,
  sessionLabel,
  signClass,
} from '../utils/format';

// Public, read-only view of one shared trade / day / week. Rendered outside the
// app Layout (no sidebar, no filter bar) and only ever talks to /api/public.

function Shell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <div className="min-h-screen" style={{ background: 'var(--term-bg)', color: 'var(--term-text)' }}>
      <header
        className="flex items-center justify-between border-b px-4 py-2.5"
        style={{ borderColor: 'var(--term-border-2)', background: 'var(--term-panel-hd)' }}
      >
        <div
          className="text-[12px] font-bold uppercase"
          style={{ color: 'var(--term-amber)', letterSpacing: '0.06em' }}
        >
          TRADE<span style={{ color: 'var(--term-green)' }}>▮</span>JOURNAL
          <span className="ml-2 font-medium normal-case" style={{ color: 'var(--term-muted)' }}>
            · shared, read-only
          </span>
        </div>
        <button
          type="button"
          className="btn px-2 py-1 text-[11px]"
          onClick={() => setTheme(next)}
          aria-label={`Switch to ${next} theme`}
        >
          {theme === 'dark' ? '☾ Dark' : '☀ Light'}
        </button>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5">{children}</main>
    </div>
  );
}

function Tile({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="card flex flex-col gap-1 px-3 py-2.5">
      <span className="text-[11px] uppercase" style={{ color: 'var(--term-muted)', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span className={`num text-lg font-semibold ${cls}`}>{value}</span>
    </div>
  );
}

function toTime(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

function TradeView({ data }: { data: Extract<PublicShare, { kind: 'trade' }> }) {
  const t = data.trade;
  const bars = data.chart.bars;
  const markers = useMemo(() => {
    if (!bars.length) return [] as ChartMarker[];
    const times = bars.map((b) => toTime(b.t));
    // Snap to the bar the event falls in so the marker renders.
    const snap = (iso: string) => {
      const x = toTime(iso);
      let best = times[0];
      for (const bt of times) if (bt <= x) best = bt;
      return best;
    };
    const m: ChartMarker[] = [];
    const long = t.direction === 'long';
    if (t.entry_time)
      m.push({
        time: snap(t.entry_time),
        position: long ? 'belowBar' : 'aboveBar',
        color: '#6366f1',
        shape: long ? 'arrowUp' : 'arrowDown',
        text: `Entry ${t.entry_price ?? ''}`,
      });
    if (t.exit_time)
      m.push({
        time: snap(t.exit_time),
        position: long ? 'aboveBar' : 'belowBar',
        color: '#f59e0b',
        shape: 'square',
        text: `Exit ${t.exit_price ?? ''}`,
      });
    return m.sort((a, b) => (a.time as number) - (b.time as number));
  }, [bars, t]);

  const priceLines = [
    t.stop_price != null ? { price: t.stop_price, color: '#ef4444', title: 'SL' } : null,
    t.target_price != null ? { price: t.target_price, color: '#22c55e', title: 'TP' } : null,
  ].filter(Boolean) as { price: number; color: string; title: string }[];

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--term-text-hi)' }}>
          {t.instrument} <span className="capitalize">{t.direction}</span>
        </h1>
        <p className="text-sm" style={{ color: 'var(--term-muted)' }}>
          {formatDateTime(t.entry_time)} → {formatDateTime(t.exit_time)} · {sessionLabel(t.session)}
          {data.trade.setup ? ` · ${data.trade.setup}` : ''}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Net P&L" value={formatMoney(t.net_pnl, data.currency)} cls={signClass(t.net_pnl)} />
        <Tile label="R" value={formatR(t.r_multiple)} cls={signClass(t.r_multiple)} />
        <Tile label="Hold" value={formatDuration(t.hold_time_sec)} />
        <Tile label="Size" value={formatNumber(t.size, 2)} />
      </div>
      <div className="card p-2">
        {bars.length ? (
          <CandleChart bars={bars} markers={markers} priceLines={priceLines} height={360} />
        ) : (
          <p className="px-2 py-8 text-center text-sm" style={{ color: 'var(--term-muted)' }}>
            No price data for this trade.
          </p>
        )}
        <div className="px-2 pt-1 text-[11px]" style={{ color: 'var(--term-muted)' }}>
          {data.chart.tf} · entry {formatNumber(t.entry_price, 2)} · exit {formatNumber(t.exit_price, 2)}
          {t.stop_price != null && ` · SL ${formatNumber(t.stop_price, 2)}`}
          {t.target_price != null && ` · TP ${formatNumber(t.target_price, 2)}`}
        </div>
      </div>
      {data.trade.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.trade.tags.map((g) => (
            <span
              key={`${g.category}:${g.name}`}
              className="border px-2 py-0.5 text-[11px]"
              style={{ borderColor: 'var(--term-border-2)', borderRadius: 2, color: 'var(--term-text-dim)' }}
            >
              {g.category}: {g.name}
            </span>
          ))}
        </div>
      )}
      {data.notes && data.notes.length > 0 && (
        <div className="card flex flex-col gap-2 p-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--term-text-hi)' }}>
            Notes
          </h2>
          {data.notes.map((n, i) => (
            <p key={i} className="whitespace-pre-wrap text-sm" style={{ color: 'var(--term-text)' }}>
              {n.body}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

function Kpis({ k, currency }: { k: PublicKpis; currency: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Tile label="Net P&L" value={formatMoney(k.net_pnl, currency)} cls={signClass(k.net_pnl)} />
      <Tile label="Trades" value={String(k.trade_count)} />
      <Tile label="Win rate" value={k.trade_count ? formatPct(k.win_rate) : '—'} />
      <Tile label="Profit factor" value={formatNumber(k.profit_factor, 2)} />
      <Tile label="Total R" value={formatR(k.total_r)} cls={signClass(k.total_r)} />
    </div>
  );
}

function TradesTable({ trades, currency }: { trades: PublicTrade[]; currency: string }) {
  if (!trades.length)
    return (
      <p className="card px-4 py-6 text-center text-sm" style={{ color: 'var(--term-muted)' }}>
        No trades.
      </p>
    );
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase" style={{ borderColor: 'var(--term-border)', color: 'var(--term-muted)' }}>
            <th className="px-3 py-2 font-medium">Entry</th>
            <th className="px-3 py-2 font-medium">Instrument</th>
            <th className="px-3 py-2 font-medium">Side</th>
            <th className="px-3 py-2 font-medium">Session</th>
            <th className="px-3 py-2 text-right font-medium">Hold</th>
            <th className="px-3 py-2 text-right font-medium">R</th>
            <th className="px-3 py-2 text-right font-medium">Net</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="border-b" style={{ borderColor: 'var(--term-border)' }}>
              <td className="whitespace-nowrap px-3 py-1.5">{formatDateTime(t.entry_time)}</td>
              <td className="px-3 py-1.5">{t.instrument}</td>
              <td className="px-3 py-1.5 capitalize">{t.direction}</td>
              <td className="px-3 py-1.5">{sessionLabel(t.session)}</td>
              <td className="num px-3 py-1.5 text-right">{formatDuration(t.hold_time_sec)}</td>
              <td className={`num px-3 py-1.5 text-right ${signClass(t.r_multiple)}`}>{formatR(t.r_multiple)}</td>
              <td className={`num px-3 py-1.5 text-right ${signClass(t.net_pnl)}`}>{formatMoney(t.net_pnl, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RangeView({ data }: { data: Extract<PublicShare, { kind: 'day' | 'week' }> }) {
  const title =
    data.kind === 'day' ? `Trading day · ${formatDate(data.from)}` : `Week · ${formatDate(data.from)} – ${formatDate(data.to)}`;
  return (
    <>
      <h1 className="text-xl font-semibold" style={{ color: 'var(--term-text-hi)' }}>
        {title}
      </h1>
      <Kpis k={data.kpis} currency={data.currency} />
      {data.days && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
          {data.days.map((d) => (
            <div key={d.day} className="card flex flex-col gap-0.5 px-2.5 py-2">
              <span className="text-[11px]" style={{ color: 'var(--term-muted)' }}>
                {new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', timeZone: 'UTC' })}
              </span>
              <span className={`num text-sm font-semibold ${signClass(d.net_pnl)}`}>
                {d.trade_count ? formatMoney(d.net_pnl, data.currency) : '—'}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--term-muted)' }}>
                {d.trade_count} trade{d.trade_count === 1 ? '' : 's'}
              </span>
            </div>
          ))}
        </div>
      )}
      <TradesTable trades={data.trades} currency={data.currency} />
      {data.kind === 'day' && data.recap && (
        <div className="card flex flex-col gap-2 p-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--term-text-hi)' }}>Recap</h2>
          <p className="whitespace-pre-wrap text-sm">{data.recap}</p>
        </div>
      )}
      {data.days?.some((d) => d.recap) && (
        <div className="card flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--term-text-hi)' }}>Daily recaps</h2>
          {data.days
            .filter((d) => d.recap)
            .map((d) => (
              <div key={d.day}>
                <div className="text-[11px] uppercase" style={{ color: 'var(--term-muted)' }}>{formatDate(d.day)}</div>
                <p className="whitespace-pre-wrap text-sm">{d.recap}</p>
              </div>
            ))}
        </div>
      )}
    </>
  );
}

export default function SharePublic() {
  const { token = '' } = useParams();
  const { data, loading, error } = useApi(() => shareApi.getPublic(token), [token]);

  return (
    <Shell>
      {loading ? (
        <LoadingBlock label="Loading shared view…" />
      ) : error || !data ? (
        <div className="card px-4 py-10 text-center">
          <p className="text-base font-semibold" style={{ color: 'var(--term-text-hi)' }}>
            This link isn’t available
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--term-muted)' }}>
            {error || 'It may have been revoked or expired.'}
          </p>
        </div>
      ) : data.kind === 'trade' ? (
        <TradeView data={data} />
      ) : (
        <RangeView data={data} />
      )}
      {data?.expires_at && (
        <p className="text-center text-[11px]" style={{ color: 'var(--term-muted)' }}>
          Link expires {formatDateTime(data.expires_at)}
        </p>
      )}
    </Shell>
  );
}
