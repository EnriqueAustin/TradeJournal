import { useEffect, useState, useCallback } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { ResearchHealth, ResearchProvider } from '../../../types';
import { Panel, DataRow, StatusBadge } from '../terminal';
import type { BadgeKind } from '../terminal';
import PricePanel from '../panels/PricePanel';
import LiveTicker from '../panels/LiveTicker';
import ConstituentTable from '../panels/ConstituentTable';
import ContributionGrid from '../panels/ContributionGrid';
import BreadthPanel from '../panels/BreadthPanel';
import RateOverlay from '../panels/RateOverlay';
import EarningsPanel from '../panels/EarningsPanel';
import SectorPanel from '../panels/SectorPanel';
import VolPanel from '../panels/VolPanel';
import BriefPanel from '../panels/BriefPanel';
import RatesBoard from '../panels/RatesBoard';
import EconTracker from '../panels/EconTracker';
import RegimePanel from '../panels/RegimePanel';
import DriverScorecard from '../panels/DriverScorecard';
import RealYieldOverlay from '../panels/RealYieldOverlay';
import KeyLevelsPanel from '../panels/KeyLevelsPanel';
import SeasonalityPanel from '../panels/SeasonalityPanel';
import CotPanel from '../panels/CotPanel';
import EtfFlowPanel from '../panels/EtfFlowPanel';
import GoldSilverPanel from '../panels/GoldSilverPanel';
import '../terminal/terminal.css';

const INSTRUMENTS = ['XAUUSD', 'US100'] as const;
type Instrument = (typeof INSTRUMENTS)[number];

const PROVIDER_LABELS: Record<ResearchProvider, string> = {
  oanda: 'OANDA · price',
  fred: 'FRED · macro',
  finnhub: 'FINNHUB · earnings',
  alpaca: 'ALPACA · IEX RT',
};

function analyticsBadge(status: ResearchHealth['analytics']): BadgeKind {
  if (status === 'ok') return 'ok';
  if (status === 'unreachable') return 'warn';
  return 'err';
}

function utcClock(d: Date): string {
  return d.toISOString().slice(11, 19) + ' UTC';
}

export default function Signal() {
  const [instrument, setInstrument] = useState<Instrument>('US100');
  const [now, setNow] = useState(() => new Date());
  const [livePrice, setLivePrice] = useState<Record<string, number>>({});
  const { data: health, loading, error, reload } = useApi<ResearchHealth>(
    () => api.getResearchHealth(),
    []
  );

  const handleTick = useCallback((sym: string, mid: number) => {
    setLivePrice((prev) => ({ ...prev, [sym]: mid }));
  }, []);

  // Header clock ticks every second.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="sig">
      {/* top header */}
      <div className="sig-header">
        <span className="sig-brand">
          SIGNAL<b>▮</b> RESEARCH TERMINAL
        </span>
        <div className="sig-tabs">
          {INSTRUMENTS.map((sym) => (
            <button
              key={sym}
              className={`sig-tab${sym === instrument ? ' is-active' : ''}`}
              onClick={() => setInstrument(sym)}
            >
              {sym}
            </button>
          ))}
        </div>
        <span className="sig-spacer" />
        <span className="sig-clock">{utcClock(now)}</span>
      </div>

      {/* panel grid */}
      <div className="sig-grid">
        {/* System status — the S0.3 proof panel */}
        <Panel
          title="System Status"
          tag="/api/research/health"
          span={6}
          right={
            <button className="sig-tab" onClick={reload} title="Refresh">
              ⟳
            </button>
          }
        >
          {loading && <div className="sig-ph">Connecting…</div>}
          {error && (
            <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
              API unreachable — is the server on :4000?
            </div>
          )}
          {health && (
            <>
              <DataRow
                label="Server"
                value={<StatusBadge kind="ok" label="OK" />}
              />
              <DataRow
                label="Market DB"
                value={
                  <StatusBadge
                    kind={health.marketDb === 'ok' ? 'ok' : 'err'}
                    label={`${health.marketDb} · v${health.schema_version ?? '?'}`}
                  />
                }
              />
              <DataRow
                label="Analytics (Py)"
                value={
                  <StatusBadge
                    kind={analyticsBadge(health.analytics)}
                    label={health.analytics}
                  />
                }
              />
            </>
          )}
        </Panel>

        {/* Data providers */}
        <Panel title="Data Feeds" tag="free tier" span={6}>
          {health ? (
            (Object.keys(PROVIDER_LABELS) as ResearchProvider[]).map((p) => (
              <DataRow
                key={p}
                label={PROVIDER_LABELS[p]}
                value={
                  <StatusBadge
                    kind={health.providers[p] ? 'ok' : 'muted'}
                    label={health.providers[p] ? 'ON' : 'OFF'}
                  />
                }
              />
            ))
          ) : (
            <div className="sig-ph">…</div>
          )}
        </Panel>

        {/* Price chart — S0.4 + live last price from S0.5 */}
        <PricePanel instrument={instrument} livePrice={livePrice[instrument]} />
        {/* Live ticker — S0.5 */}
        <LiveTicker instrument={instrument} onTick={handleTick} />
        {/* Macro panels — Epic 2 (cross-instrument) */}
        <RatesBoard />
        <EconTracker />
        <RegimePanel />
        {/* US100 cockpit panels — Epic 1 */}
        {instrument === 'US100' && (
          <>
            <ContributionGrid />
            <BreadthPanel />
            <RateOverlay />
            <SectorPanel />
            <VolPanel instrument="US100" />
            <EarningsPanel />
            <BriefPanel instrument="US100" />
            <ConstituentTable />
          </>
        )}
        {instrument === 'XAUUSD' && (
          <>
            {/* Epic 3 — Gold cockpit */}
            <DriverScorecard />
            <RealYieldOverlay />
            <VolPanel instrument="XAUUSD" />
            <CotPanel />
            <EtfFlowPanel />
            <GoldSilverPanel />
            <SeasonalityPanel instrument="XAUUSD" />
            <KeyLevelsPanel instrument="XAUUSD" />
            <BriefPanel instrument="XAUUSD" />
          </>
        )}
      </div>

      {/* compliance footer (persistent, per spec) */}
      <div className="sig-footer">
        <span>Signal · analysis &amp; research only — not financial advice · no execution</span>
        <span className="sig-spacer" />
        <span>Data: free/public sources · delays apply</span>
      </div>
    </div>
  );
}
