import { useEffect, useState, useCallback } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { ResearchHealth, ResearchProvider } from '../../../types';
import { Panel, DataRow, StatusBadge } from '../terminal';
import type { BadgeKind } from '../terminal';
import { fmtClock, useSignalTz, setSignalTz, TZ_OPTIONS } from '../lib/tz';
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
import CalendarPanel from '../panels/CalendarPanel';
import EventReactionPanel from '../panels/EventReactionPanel';
import CorrelationPanel from '../panels/CorrelationPanel';
import RegressionPanel from '../panels/RegressionPanel';
import ComparePanel from '../panels/ComparePanel';
import SpreadPanel from '../panels/SpreadPanel';
import PositioningPanel from '../panels/PositioningPanel';
import NewsFeedPanel from '../panels/NewsFeedPanel';
import EdgePanel from '../panels/EdgePanel';
import AdrPanel from '../panels/AdrPanel';
import SweepPanel from '../panels/SweepPanel';
import SessionsClock from '../../../components/SessionsClock';
import '../terminal/terminal.css';

const INSTRUMENTS = ['XAUUSD', 'US100'] as const;
type Instrument = (typeof INSTRUMENTS)[number];

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'macro', label: 'Macro' },
  { id: 'events', label: 'Events' },
  { id: 'positioning', label: 'Positioning' },
  { id: 'correlation', label: 'Correlation' },
  { id: 'news', label: 'News' },
] as const;
type Section = (typeof SECTIONS)[number]['id'];

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

export default function Signal() {
  const [instrument, setInstrument] = useState<Instrument>('US100');
  const [section, setSection] = useState<Section>('overview');
  const [now, setNow] = useState(() => new Date());
  const tz = useSignalTz();
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
        <select
          className="sig-tz-select"
          value={tz}
          onChange={(e) => setSignalTz(e.target.value)}
          title="Display timezone — converts all times below"
        >
          {TZ_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="sig-clock">{fmtClock(now.getTime(), tz)}</span>
      </div>

      {/* section tabs — split the cockpit into focused views */}
      <div className="sig-subtabs">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`sig-tab${s.id === section ? ' is-active' : ''}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* panel grid */}
      <div className="sig-grid">
        {/* ── OVERVIEW ─────────────────────────────────────────── */}
        {section === 'overview' && (
          <>
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
            <LiveTicker instrument={instrument} onTick={handleTick} onSelect={(sym) => setInstrument(sym as Instrument)} />
            {/* Market sessions clock (cross-instrument), in the header timezone */}
            <Panel title="Sessions" tag={`local · ${tz.split('/')[1]?.replace('_', ' ') ?? tz}`} span={6}>
              <div style={{ padding: '4px 2px' }}>
                <SessionsClock tz={tz} />
              </div>
            </Panel>
            <RegimePanel />
            {instrument === 'US100' && (
              <>
                <ContributionGrid />
                <VolPanel instrument="US100" />
                <BriefPanel instrument="US100" />
              </>
            )}
            {instrument === 'XAUUSD' && (
              <>
                <DriverScorecard />
                <SweepPanel instrument="XAUUSD" />
                <AdrPanel instrument="XAUUSD" />
                <VolPanel instrument="XAUUSD" />
                <KeyLevelsPanel instrument="XAUUSD" />
                <BriefPanel instrument="XAUUSD" />
              </>
            )}
          </>
        )}

        {/* ── MACRO — Epic 2 ───────────────────────────────────── */}
        {section === 'macro' && (
          <>
            <RatesBoard />
            <EconTracker />
            {instrument === 'US100' && <RateOverlay />}
            {instrument === 'XAUUSD' && <RealYieldOverlay />}
          </>
        )}

        {/* ── EVENTS — Epic 4 ──────────────────────────────────── */}
        {section === 'events' && (
          <>
            <CalendarPanel />
            <EventReactionPanel instrument={instrument} />
            {instrument === 'US100' && <EarningsPanel />}
            {instrument === 'XAUUSD' && <SeasonalityPanel instrument="XAUUSD" />}
          </>
        )}

        {/* ── POSITIONING — Epic 1 / Epic 3 ────────────────────── */}
        {section === 'positioning' && (
          <>
            {instrument === 'US100' && (
              <>
                <BreadthPanel />
                <SectorPanel />
                <ConstituentTable />
              </>
            )}
            {instrument === 'XAUUSD' && (
              <>
                <PositioningPanel instrument="XAUUSD" />
                <CotPanel />
                <EtfFlowPanel />
                <GoldSilverPanel />
              </>
            )}
          </>
        )}

        {/* ── CORRELATION — Epic 5 (cross-instrument) ──────────── */}
        {section === 'correlation' && (
          <>
            <CorrelationPanel />
            <RegressionPanel />
            <ComparePanel />
            <SpreadPanel />
          </>
        )}

        {/* ── NEWS — Epic 6 + Epic 7 edge ──────────────────────── */}
        {section === 'news' && (
          <>
            <NewsFeedPanel instrument={instrument} />
            <EdgePanel instrument={instrument} />
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
