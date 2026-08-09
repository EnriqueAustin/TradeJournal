import { useMemo } from 'react';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import StatTile from '../components/StatTile';
import {
  formatMoney,
  formatPct,
  formatDate,
  formatDateTime,
  formatDuration,
  signClass,
} from '../utils/format';
import type { PropStats } from '../types';
import { getPreset } from '../data/propPresets';
import RiskCalculator from '../components/RiskCalculator';

function SectionCard({
  title,
  right,
  children,
  className = '',
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

// Traffic-light colours from a used-% (fraction). warn ~80%, breach ≥100%.
function meterColor(pct: number | null): { bar: string; text: string } {
  if (pct == null) return { bar: 'bg-slate-600', text: 'text-slate-400' };
  if (pct >= 1) return { bar: 'bg-red-500', text: 'text-red-400' };
  if (pct >= 0.8) return { bar: 'bg-amber-500', text: 'text-amber-400' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-400' };
}

function GuardMeter({
  label,
  used_pct,
  limit,
  value,
  currency,
  invert = false,
  note,
}: {
  label: string;
  used_pct: number | null;
  limit: number | null;
  value: string;
  currency: string;
  // invert=true → progress meter (green as it fills, not a danger meter)
  invert?: boolean;
  note?: string;
}) {
  const width = used_pct == null ? 0 : Math.min(100, Math.max(0, used_pct * 100));
  const danger = meterColor(used_pct);
  const bar = invert ? 'bg-indigo-500' : danger.bar;
  const pctText = invert ? 'text-indigo-300' : danger.text;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {label}
        </span>
        <span className={`num text-xs font-semibold ${pctText}`}>
          {used_pct == null ? 'no limit' : formatPct(used_pct)}
        </span>
      </div>
      <div className="num mt-1.5 text-lg font-semibold text-slate-100">{value}</div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all ${bar}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="num mt-1.5 text-[11px] text-slate-500">
        {limit == null
          ? 'Set a limit on the account to track this.'
          : `${invert ? 'Target' : 'Limit'} ${formatMoney(limit, currency)}${
              note ? ` · ${note}` : ''
            }`}
      </div>
    </div>
  );
}

function statusBadge(status: PropStats['status']) {
  const map = {
    ok: 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300',
    warn: 'border-amber-800/60 bg-amber-950/40 text-amber-300',
    breach: 'border-red-800/60 bg-red-950/40 text-red-300',
  } as const;
  const label = { ok: 'OK', warn: 'Warning', breach: 'Breach' }[status];
  return (
    <span
      className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${map[status]}`}
    >
      {label}
    </span>
  );
}

type RuleStatus = 'pass' | 'warn' | 'fail' | 'info' | 'na';

function RuleRow({
  rule,
  status,
  value,
  limit,
  note,
}: {
  rule: string;
  status: RuleStatus;
  value: string;
  limit?: string;
  note?: string;
}) {
  const icon = {
    pass: { bg: 'bg-emerald-900/40', text: 'text-emerald-400', label: 'PASS' },
    warn: { bg: 'bg-amber-900/40', text: 'text-amber-400', label: 'WARN' },
    fail: { bg: 'bg-red-900/40', text: 'text-red-400', label: 'FAIL' },
    info: { bg: 'bg-slate-800', text: 'text-slate-400', label: 'INFO' },
    na: { bg: 'bg-slate-800/50', text: 'text-slate-600', label: 'N/A' },
  }[status];

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800/60 bg-slate-900/30 px-3 py-2">
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${icon.bg} ${icon.text}`}>
        {icon.label}
      </span>
      <div className="flex-1">
        <div className="text-sm text-slate-200">{rule}</div>
        {note && <div className="text-[11px] text-slate-500">{note}</div>}
      </div>
      <div className="text-right">
        <div className={`num text-sm font-medium ${icon.text}`}>{value}</div>
        {limit && <div className="num text-[10px] text-slate-500">{limit}</div>}
      </div>
    </div>
  );
}

function pctToStatus(pct: number | null): RuleStatus {
  if (pct == null) return 'na';
  if (pct >= 1) return 'fail';
  if (pct >= 0.8) return 'warn';
  return 'pass';
}

function PropRulesCompliance({ p, currency }: { p: PropStats; currency: string }) {
  const preset = p.prop_firm && p.prop_plan ? getPreset(p.prop_firm, p.prop_plan) : null;
  const firmLabel = preset ? (p.prop_firm === 'equity_edge' ? 'Equity Edge' : p.prop_firm) : null;
  const planLabel = preset ? preset.label : null;

  const hasAnyRule = p.day_loss_limit != null || p.max_dd_limit != null || p.target != null
    || p.consistency_pct != null || p.min_trading_days != null || p.news_window_min != null
    || p.weekend_hold != null || p.profit_split != null;
  if (!hasAnyRule) return null;

  const lossSizePass = p.largest_single_loss === 0 || Math.abs(p.largest_single_loss) <= p.largest_single_win;

  return (
    <SectionCard
      title="Prop Rules Compliance"
      right={
        firmLabel ? (
          <span className="text-xs text-slate-500">{firmLabel} · {planLabel}</span>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2">
        {p.day_loss_limit != null && (
          <RuleRow
            rule="Daily Loss Limit"
            status={pctToStatus(p.day_loss_used_pct)}
            value={formatMoney(p.day_pnl < 0 ? p.day_pnl : 0, currency)}
            limit={`Limit ${formatMoney(p.day_loss_limit, currency)}`}
            note={p.current_day ? `Resets daily · today ${formatDate(p.current_day)}` : undefined}
          />
        )}
        {p.max_dd_limit != null && (
          <RuleRow
            rule={`Max Drawdown (${p.dd_type === 'trailing' ? 'trailing' : 'static'})`}
            status={pctToStatus(p.max_dd_used_pct)}
            value={formatMoney(-p.max_dd, currency)}
            limit={`Limit ${formatMoney(p.max_dd_limit, currency)}`}
            note={p.dd_type === 'trailing' ? 'Tracks from highest equity reached' : 'From starting balance'}
          />
        )}
        {p.target != null && (
          <RuleRow
            rule="Profit Target"
            status={p.target_progress_pct != null && p.target_progress_pct >= 1 ? 'pass' : 'info'}
            value={formatMoney(Math.max(0, p.total_pnl), currency)}
            limit={`Target ${formatMoney(p.target, currency)}`}
            note={p.target_progress_pct != null ? `${formatPct(p.target_progress_pct)} complete` : undefined}
          />
        )}
        {p.consistency_pct != null && (
          <RuleRow
            rule={`Consistency Rule (${p.consistency_pct}%)`}
            status={pctToStatus(p.consistency_used_pct)}
            value={p.best_day_pct_of_total != null ? `${(p.best_day_pct_of_total * 100).toFixed(1)}% best day` : '—'}
            limit={`Best day max ${p.consistency_pct}% of total profit`}
            note={`Best day: ${formatMoney(p.best_day_pnl, currency)} of ${formatMoney(p.total_pnl, currency)} total`}
          />
        )}
        {p.min_trading_days != null && p.min_trading_days > 0 && (
          <RuleRow
            rule="Minimum Trading Days"
            status={p.trading_days_count >= p.min_trading_days ? 'pass' : 'info'}
            value={`${p.trading_days_count} / ${p.min_trading_days}`}
            note={p.trading_days_count >= p.min_trading_days ? 'Requirement met' : `Need ${p.min_trading_days - p.trading_days_count} more day${p.min_trading_days - p.trading_days_count === 1 ? '' : 's'}`}
          />
        )}
        {preset && (
          <RuleRow
            rule="Largest Loss vs Largest Win"
            status={p.largest_single_win === 0 && p.largest_single_loss === 0 ? 'na' : lossSizePass ? 'pass' : 'fail'}
            value={`${formatMoney(p.largest_single_loss, currency)} / ${formatMoney(p.largest_single_win, currency)}`}
            note="Largest single loss must not exceed largest single win"
          />
        )}
        {p.min_hold_sec != null && p.min_hold_sec > 0 && (
          <RuleRow
            rule={`Average Hold Time (min ${formatDuration(p.min_hold_sec)})`}
            status={p.avg_hold_ok === null ? 'na' : p.avg_hold_ok ? 'pass' : 'fail'}
            value={p.avg_hold_sec != null ? formatDuration(p.avg_hold_sec) : 'No trades'}
            note={p.avg_hold_ok === false ? 'Average trade duration is below minimum' : 'Average of all trade durations'}
          />
        )}
        {p.min_hold_sec != null && p.min_hold_sec > 0 && (
          <RuleRow
            rule="Profit at Risk (sub-hold trades)"
            status={p.sub_hold_at_risk ? 'fail' : p.sub_hold_count > 0 ? 'warn' : 'pass'}
            value={`${p.sub_hold_count} trades · ${formatMoney(p.sub_hold_profit, currency)}`}
            limit={p.sub_hold_pct_of_profit != null ? `${(p.sub_hold_pct_of_profit * 100).toFixed(1)}% of total profit` : undefined}
            note={p.sub_hold_at_risk
              ? `Exceeds ${p.hold_deduct_threshold_pct}% threshold — payout will be rejected`
              : p.sub_hold_count > 0
                ? `Profit from trades held < ${formatDuration(p.min_hold_sec)} will be deducted at payout`
                : `No winning trades held under ${formatDuration(p.min_hold_sec)}`}
          />
        )}
        {p.safety_buffer_pct != null && (
          <RuleRow
            rule={`Safety Buffer (${p.safety_buffer_pct}%)`}
            status={p.safety_buffer_met === null ? 'na' : p.safety_buffer_met ? 'pass' : 'info'}
            value={formatMoney(Math.max(0, p.total_pnl), currency)}
            limit={p.safety_buffer_amount != null ? `Need ${formatMoney(p.safety_buffer_amount, currency)} before payout` : undefined}
            note={p.safety_buffer_met ? 'Buffer met — eligible for payout' : `First ${p.safety_buffer_pct}% profit serves as DD cushion after payout`}
          />
        )}
        {p.max_inactivity_days != null && (
          <RuleRow
            rule={`Inactivity Limit (${p.max_inactivity_days} days)`}
            status={p.days_since_last_trade != null && p.days_since_last_trade >= p.max_inactivity_days ? 'fail'
              : p.days_since_last_trade != null && p.days_since_last_trade >= p.max_inactivity_days * 0.8 ? 'warn' : 'pass'}
            value={p.days_since_last_trade != null ? `${p.days_since_last_trade}d since last trade` : 'No trades'}
            note={p.last_trade_date ? `Last trade: ${formatDate(p.last_trade_date)}` : 'Place a trade to start the clock'}
          />
        )}
        {p.news_window_min != null && p.news_window_min > 0 && (
          <RuleRow
            rule="News Trading Window"
            status="info"
            value={`${p.news_window_min} min`}
            note={`No opens/closes ${Math.floor(p.news_window_min / 2)}min before/after high-impact news`}
          />
        )}
        {p.weekend_hold != null && (
          <RuleRow
            rule="Weekend Holding"
            status="info"
            value={p.weekend_hold ? 'Allowed' : 'Not allowed'}
            note={p.weekend_hold ? 'Positions may be held over weekends' : 'All positions must be closed before market close Friday'}
          />
        )}
        {p.profit_split != null && (
          <RuleRow
            rule="Profit Split"
            status="info"
            value={`${p.profit_split}%`}
            note={p.phase > 0 ? 'Applies after passing to funded phase' : 'Your share of profits on payout'}
          />
        )}
      </div>
    </SectionCard>
  );
}

export default function Risk() {
  const { filters, accounts } = useFilters();
  const currency = useMemo(
    () => accounts.find((a) => a.id === filters.account)?.currency ?? 'USD',
    [accounts, filters.account]
  );

  const key = filterKey(filters);
  const prop = useApi(() => api.getProp(filters), [key]);
  const adh = useApi(() => api.getAdherence(filters), [key]);
  const streaks = useApi(() => api.getStreaks(filters), [key]);
  const tilt = useApi(() => api.getTilt(filters), [key]);

  const p = prop.data;
  const noPropLimits =
    !!p && p.day_loss_limit == null && p.max_dd_limit == null && p.target == null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Risk &amp; Discipline</h1>
        <p className="text-sm text-slate-500">
          Prop-firm guardrails, rule adherence, streaks and tilt warnings for the
          current filters.
        </p>
      </div>

      {/* Prop guardrails */}
      <SectionCard
        title="Prop Guardrails"
        right={p && !prop.loading ? statusBadge(p.status) : undefined}
      >
        <AsyncBoundary
          loading={prop.loading}
          error={prop.error}
          onRetry={prop.reload}
          loadingLabel="Loading prop guardrails…"
        >
          {p && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile
                  label="Equity"
                  value={formatMoney(p.current_equity, currency)}
                  sub={`Start ${formatMoney(p.starting_balance, currency)}`}
                  valueClass="text-slate-100"
                />
                <StatTile
                  label="Total P&L"
                  value={formatMoney(p.total_pnl, currency)}
                  valueClass={signClass(p.total_pnl)}
                />
                <StatTile
                  label="Day P&L"
                  value={formatMoney(p.day_pnl, currency)}
                  valueClass={signClass(p.day_pnl)}
                  sub={p.current_day ? formatDate(p.current_day) : 'no trades'}
                />
                <StatTile
                  label="Max Drawdown"
                  value={formatMoney(-p.max_dd, currency)}
                  valueClass={p.max_dd > 0 ? 'text-red-400' : 'text-slate-300'}
                  sub={p.dd_type === 'trailing' ? 'trailing' : 'peak-to-trough'}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <GuardMeter
                  label="Daily Loss"
                  used_pct={p.day_loss_used_pct}
                  limit={p.day_loss_limit}
                  value={formatMoney(p.day_pnl < 0 ? p.day_pnl : 0, currency)}
                  currency={currency}
                  note={p.current_day ? formatDate(p.current_day) : undefined}
                />
                <GuardMeter
                  label={`Max DD${p.dd_type === 'trailing' ? ' (trailing)' : ''}`}
                  used_pct={p.max_dd_used_pct}
                  limit={p.max_dd_limit}
                  value={formatMoney(-p.max_dd, currency)}
                  currency={currency}
                />
                <GuardMeter
                  label="Profit Target"
                  used_pct={p.target_progress_pct}
                  limit={p.target}
                  value={formatMoney(Math.max(0, p.total_pnl), currency)}
                  currency={currency}
                  invert
                />
              </div>

              {p.breaches.length > 0 && (
                <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                  Limit breached:{' '}
                  {p.breaches
                    .map((b) =>
                      b === 'daily_loss' ? 'daily loss' : b === 'consistency' ? 'consistency' : 'max drawdown'
                    )
                    .join(', ')}
                  .
                </div>
              )}

              {(p.phase > 0 || p.min_trading_days || p.profit_split || p.news_window_min || p.weekend_hold != null || p.consistency_pct) && (
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {p.phase > 0 && (
                    <span className="rounded bg-indigo-900/50 px-2 py-0.5 text-indigo-300">
                      Phase {p.phase}
                    </span>
                  )}
                  {p.phase === 0 && p.profit_split && (
                    <span className="rounded bg-emerald-900/50 px-2 py-0.5 text-emerald-300">
                      Funded — {p.profit_split}% split
                    </span>
                  )}
                  {p.min_trading_days != null && p.min_trading_days > 0 && (
                    <span className={`rounded px-2 py-0.5 ${p.trading_days_count >= p.min_trading_days ? 'bg-emerald-900/50 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                      {p.trading_days_count}/{p.min_trading_days} min days
                    </span>
                  )}
                  {p.consistency_pct != null && (
                    <span className={`rounded px-2 py-0.5 ${p.consistency_used_pct != null && p.consistency_used_pct >= 1 ? 'bg-red-900/50 text-red-300' : p.consistency_used_pct != null && p.consistency_used_pct >= 0.8 ? 'bg-amber-900/50 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>
                      {p.consistency_pct}% consistency {p.consistency_used_pct != null ? `(${(p.consistency_used_pct * 100).toFixed(0)}% used)` : ''}
                    </span>
                  )}
                  {p.news_window_min != null && p.news_window_min > 0 && (
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-400">
                      {p.news_window_min}min news window
                    </span>
                  )}
                  {p.weekend_hold === false && (
                    <span className="rounded bg-amber-900/40 px-2 py-0.5 text-amber-300">
                      No weekend hold
                    </span>
                  )}
                </div>
              )}
              {noPropLimits && (
                <p className="text-xs text-slate-500">
                  This account has no prop limits set. Add daily-loss / max-DD /
                  target on the Accounts page (or PATCH the account) to activate the
                  meters.
                </p>
              )}
            </div>
          )}
        </AsyncBoundary>
      </SectionCard>

      {/* Prop rules compliance — full rule-by-rule status */}
      {p && <PropRulesCompliance p={p} currency={currency} />}

      {/* Position-size / risk calculator */}
      <SectionCard
        title="Position Size Calculator"
        right={<span className="text-xs text-slate-500">lot size from risk %</span>}
      >
        <RiskCalculator
          key={filters.account ?? 'all'}
          currency={currency}
          equity={p?.current_equity ?? null}
        />
      </SectionCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Adherence */}
        <SectionCard title="Rule Adherence">
          <AsyncBoundary
            loading={adh.loading}
            error={adh.error}
            onRetry={adh.reload}
            loadingLabel="Loading adherence…"
          >
            {adh.data && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <StatTile
                    label="Rules Followed"
                    value={
                      adh.data.rules_followed_pct == null
                        ? '—'
                        : formatPct(adh.data.rules_followed_pct)
                    }
                    valueClass={
                      adh.data.rules_followed_pct == null
                        ? 'text-slate-300'
                        : adh.data.rules_followed_pct >= 0.8
                          ? 'text-emerald-400'
                          : adh.data.rules_followed_pct >= 0.5
                            ? 'text-amber-400'
                            : 'text-red-400'
                    }
                    sub={`${adh.data.followed_count}/${adh.data.graded_count} logged`}
                  />
                  <StatTile
                    label="Avg P&L · Followed"
                    value={
                      adh.data.avg_pnl_followed == null
                        ? '—'
                        : formatMoney(adh.data.avg_pnl_followed, currency)
                    }
                    valueClass={signClass(adh.data.avg_pnl_followed)}
                  />
                  <StatTile
                    label="Avg P&L · Broke"
                    value={
                      adh.data.avg_pnl_broken == null
                        ? '—'
                        : formatMoney(adh.data.avg_pnl_broken, currency)
                    }
                    valueClass={signClass(adh.data.avg_pnl_broken)}
                  />
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Grade Distribution
                  </div>
                  {adh.data.grades.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No grade tags yet. Tag trades with a grade (A+/A/B/C) on the
                      Trade detail page.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {adh.data.grades.map((g) => (
                        <div
                          key={g.grade}
                          className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                        >
                          <div className="num text-lg font-semibold text-slate-100">
                            {g.grade}
                          </div>
                          <div className="num text-[11px] text-slate-500">
                            {g.trade_count}t ·{' '}
                            <span className={signClass(g.net_pnl)}>
                              {formatMoney(g.net_pnl, currency)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </AsyncBoundary>
        </SectionCard>

        {/* Streaks & consistency */}
        <SectionCard title="Streaks &amp; Consistency">
          <AsyncBoundary
            loading={streaks.loading}
            error={streaks.error}
            onRetry={streaks.reload}
            loadingLabel="Loading streaks…"
          >
            {streaks.data && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile
                    label="Current"
                    value={
                      streaks.data.current_win_streak > 0
                        ? `${streaks.data.current_win_streak}W`
                        : streaks.data.current_loss_streak > 0
                          ? `${streaks.data.current_loss_streak}L`
                          : '—'
                    }
                    valueClass={
                      streaks.data.current_win_streak > 0
                        ? 'text-emerald-400'
                        : streaks.data.current_loss_streak > 0
                          ? 'text-red-400'
                          : 'text-slate-300'
                    }
                  />
                  <StatTile
                    label="Max Win"
                    value={`${streaks.data.max_win_streak}W`}
                    valueClass="text-emerald-400"
                  />
                  <StatTile
                    label="Max Loss"
                    value={`${streaks.data.max_loss_streak}L`}
                    valueClass="text-red-400"
                  />
                  <StatTile
                    label="Consistency"
                    value={
                      streaks.data.best_day_pct == null
                        ? '—'
                        : formatPct(streaks.data.best_day_pct)
                    }
                    valueClass={
                      streaks.data.best_day_pct != null &&
                      streaks.data.best_day_pct > 0.5
                        ? 'text-amber-400'
                        : 'text-slate-100'
                    }
                    sub="best day % of net"
                  />
                </div>

                {streaks.data.by_day.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No trading days in range.
                  </p>
                ) : (
                  <div className="max-h-[220px] overflow-y-auto rounded-lg border border-slate-800">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-900">
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-2 font-medium">Day</th>
                          <th className="px-3 py-2 text-right font-medium">
                            Trades
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Net P&L
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {streaks.data.by_day
                          .slice()
                          .reverse()
                          .map((d) => (
                            <tr
                              key={d.day}
                              className="border-t border-slate-800/60"
                            >
                              <td className="px-3 py-1.5 text-slate-300">
                                {formatDate(d.day)}
                              </td>
                              <td className="num px-3 py-1.5 text-right text-slate-400">
                                {d.trade_count}
                              </td>
                              <td
                                className={`num px-3 py-1.5 text-right font-medium ${signClass(
                                  d.net_pnl
                                )}`}
                              >
                                {formatMoney(d.net_pnl, currency)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </AsyncBoundary>
        </SectionCard>
      </div>

      {/* Tilt warnings */}
      <SectionCard
        title="Tilt / Revenge Warnings"
        right={
          tilt.data && (
            <span className="text-xs text-slate-500">
              re-entry &lt; {tilt.data.threshold_sec}s after a loss
            </span>
          )
        }
      >
        <AsyncBoundary
          loading={tilt.loading}
          error={tilt.error}
          onRetry={tilt.reload}
          isEmpty={!!tilt.data && tilt.data.count === 0}
          emptyMessage="No rapid re-entries after losses. Clean discipline."
          loadingLabel="Loading tilt analysis…"
        >
          {tilt.data && tilt.data.count > 0 && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <StatTile
                  label="Tilt Trades"
                  value={tilt.data.count}
                  valueClass="text-amber-400"
                />
                <StatTile
                  label="Tilt P&L"
                  value={formatMoney(tilt.data.tilt_pnl, currency)}
                  valueClass={signClass(tilt.data.tilt_pnl)}
                />
                <StatTile
                  label="Tilt Days"
                  value={tilt.data.by_day.length}
                  valueClass="text-slate-100"
                />
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2 font-medium">Entry Time</th>
                      <th className="px-3 py-2 font-medium">Instrument</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Gap After Loss
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Result
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tilt.data.events.map((e, i) => (
                      <tr
                        key={`${e.time}-${i}`}
                        className="border-t border-slate-800/60"
                      >
                        <td className="px-3 py-1.5 text-slate-300">
                          {formatDateTime(e.time)}
                        </td>
                        <td className="px-3 py-1.5 text-slate-400">
                          {e.instrument}
                        </td>
                        <td className="num px-3 py-1.5 text-right text-amber-400">
                          {formatDuration(e.gap_sec)}
                        </td>
                        <td
                          className={`num px-3 py-1.5 text-right font-medium ${signClass(
                            e.pnl
                          )}`}
                        >
                          {formatMoney(e.pnl, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </AsyncBoundary>
      </SectionCard>
    </div>
  );
}
