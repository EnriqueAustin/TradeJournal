import { useState } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { ContributionResponse, ContributionMember } from '../../../types';
import { Panel, TickerCell } from '../terminal';

type SortKey = 'contribution' | 'weight' | 'changePct' | 'symbol';

export default function ContributionGrid() {
  const { data, loading, error, reload } = useApi<ContributionResponse>(
    () => api.getContribution(),
    []
  );
  const [sortKey, setSortKey] = useState<SortKey>('contribution');
  const [showAll, setShowAll] = useState(false);

  const sorted = data
    ? [...data.members].sort((a, b) => {
        if (sortKey === 'symbol') return a.symbol.localeCompare(b.symbol);
        if (sortKey === 'contribution')
          return Math.abs(b.contribution) - Math.abs(a.contribution);
        return Math.abs(b[sortKey] ?? 0) - Math.abs(a[sortKey] ?? 0);
      })
    : [];

  const display = showAll ? sorted : sorted.slice(0, 15);

  return (
    <Panel
      title="US100 · Contribution"
      tag="MOV/GRR"
      span={8}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Loading contribution…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          Failed to load
        </div>
      )}
      {data && (
        <>
          {/* summary bar */}
          <div className="sig-contrib-summary">
            <SummaryCell label="Total" value={data.summary.totalContrib} />
            <SummaryCell label="Mag-7" value={data.summary.mag7Contrib} />
            <SummaryCell label="Broad" value={data.summary.broadContrib} />
            <div className="sig-contrib-cell">
              <span className="sig-muted">Mag-7 Wt</span>
              <TickerCell value={data.summary.mag7Weight} dp={1} suffix="%" />
            </div>
          </div>

          {/* sort tabs */}
          <div className="sig-sort-bar">
            {(['contribution', 'weight', 'changePct', 'symbol'] as SortKey[]).map((k) => (
              <button
                key={k}
                className={`sig-tab${sortKey === k ? ' is-active' : ''}`}
                onClick={() => setSortKey(k)}
              >
                {k === 'contribution' ? 'Impact' : k === 'changePct' ? 'Chg%' : k === 'weight' ? 'Weight' : 'A-Z'}
              </button>
            ))}
          </div>

          {/* grid */}
          <div className="sig-scroll">
            <table className="sig-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="sig-right">Wt%</th>
                  <th className="sig-right">Price</th>
                  <th className="sig-right">Chg%</th>
                  <th className="sig-right">Contrib</th>
                  <th>Bar</th>
                </tr>
              </thead>
              <tbody>
                {display.map((m) => (
                  <ContribRow key={m.symbol} m={m} maxContrib={sorted[0]?.contribution ?? 1} />
                ))}
              </tbody>
            </table>
          </div>

          {sorted.length > 15 && (
            <button
              className="sig-tab"
              style={{ marginTop: '4px', width: '100%' }}
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show Top 15' : `Show All ${sorted.length}`}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

function ContribRow({ m, maxContrib }: { m: ContributionMember; maxContrib: number }) {
  const barWidth = maxContrib ? Math.min(Math.abs(m.contribution / maxContrib) * 100, 100) : 0;
  const barColor = m.contribution >= 0 ? 'var(--sig-green)' : 'var(--sig-red)';

  return (
    <tr className={m.mag7 ? 'sig-mag7' : ''}>
      <td>
        <span className="sig-symbol">{m.symbol}</span>
        {m.mag7 && <span className="sig-tag-mag7">M7</span>}
      </td>
      <td className="sig-right">
        <TickerCell value={m.weight} dp={2} suffix="%" />
      </td>
      <td className="sig-right">
        <TickerCell value={m.price} dp={2} />
      </td>
      <td className="sig-right">
        <TickerCell value={m.changePct} dp={2} signed colorize suffix="%" />
      </td>
      <td className="sig-right">
        <TickerCell value={m.contribution} dp={3} signed colorize suffix="bp" />
      </td>
      <td style={{ width: '80px' }}>
        <div className="sig-bar-track">
          <div
            className="sig-bar-fill"
            style={{ width: `${barWidth}%`, background: barColor }}
          />
        </div>
      </td>
    </tr>
  );
}

function SummaryCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="sig-contrib-cell">
      <span className="sig-muted">{label}</span>
      <TickerCell value={value} dp={2} signed colorize suffix="bp" />
    </div>
  );
}
