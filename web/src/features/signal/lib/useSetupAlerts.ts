import { useCallback, useEffect, useRef, useState } from 'react';
import type { RadarResponse, RadarSignal } from '../../../types';

// --- Alert delivery loop -----------------------------------------------------
// The Setup Radar computes signals but is silent — you only see them if you're
// staring at the panel. This closes the loop: it watches the polled radar feed,
// detects *newly appeared* actionable signals, and delivers them (browser
// notification + a short beep) so a wick-fill trigger reaches you even when the
// tab is backgrounded. Fired alerts are logged for review. All config persists.

export type AlertMode = 'confirmed' | 'hot' | 'all';

export interface FiredAlert {
  key: string;
  severity: RadarSignal['severity'];
  kind: string;
  title: string;
  detail: string;
  instrument: string;
  ts: number; // when we fired it (ms epoch)
}

interface AlertConfig {
  enabled: boolean; // master switch for delivery (notify + sound)
  sound: boolean;
  mode: AlertMode; // which signals are worth interrupting for
}

const CFG_KEY = 'sig-alerts-cfg';
const LOG_KEY = 'sig-alerts-log';
const LOG_CAP = 50;

const DEFAULT_CFG: AlertConfig = { enabled: false, sound: true, mode: 'confirmed' };

function loadCfg(): AlertConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) return { ...DEFAULT_CFG, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_CFG;
}

function loadLog(): FiredAlert[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

// Stable identity for a signal so the same live condition only fires once. Sweep
// / structure signals carry a `ts` we bucket on; proximity signals key on the
// level (they persist while price hovers, so they must not re-fire each poll).
function signalKey(s: RadarSignal): string {
  const parts = [s.kind, s.level ?? '', s.direction ?? ''];
  if (s.ts != null) parts.push(String(Math.round(s.ts / 60000))); // 1-min bucket
  return parts.join('|');
}

// Does this signal clear the interrupt bar the user set?
function alertable(s: RadarSignal, mode: AlertMode): boolean {
  if (mode === 'all') return s.severity === 'hot' || s.severity === 'warn';
  if (mode === 'hot') return s.severity === 'hot';
  // 'confirmed' — only the full sweep→shift trigger and session kill-zone opens.
  return s.kind === 'confirmed-setup';
}

// Short WebAudio blip — no asset to bundle. Two tones so it reads as an alert.
function beep() {
  try {
    const Ctx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t = now + i * 0.14;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.14);
    });
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {
    /* audio blocked — silent */
  }
}

export function useSetupAlerts(data: RadarResponse | undefined, instrument: string) {
  const [cfg, setCfg] = useState<AlertConfig>(loadCfg);
  const [perm, setPerm] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [log, setLog] = useState<FiredAlert[]>(loadLog);
  const [unseen, setUnseen] = useState(0);

  // Keys already delivered this session — the dedupe memory driving the loop.
  const seen = useRef<Set<string>>(new Set());
  // Skip the very first radar payload after (re)mount: those signals are
  // pre-existing state, not fresh events, and shouldn't all fire at once.
  const primed = useRef(false);

  useEffect(() => {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }, [cfg]);

  // Reset dedupe + priming when the watched instrument changes.
  useEffect(() => {
    seen.current = new Set();
    primed.current = false;
  }, [instrument]);

  // The loop body: runs each time a fresh radar payload arrives.
  useEffect(() => {
    if (!data?.signals?.length) return;
    const candidates = data.signals.filter((s) => alertable(s, cfg.mode));

    if (!primed.current) {
      // Seed the dedupe set from the first payload without firing.
      for (const s of candidates) seen.current.add(signalKey(s));
      primed.current = true;
      return;
    }

    const fresh: FiredAlert[] = [];
    for (const s of candidates) {
      const key = signalKey(s);
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      fresh.push({
        key,
        severity: s.severity,
        kind: s.kind,
        title: s.title,
        detail: s.detail,
        instrument,
        ts: Date.now(),
      });
    }
    if (!fresh.length) return;

    // Deliver — only when armed; the log always records so history is complete.
    if (cfg.enabled) {
      if (perm === 'granted' && typeof Notification !== 'undefined') {
        for (const a of fresh) {
          try {
            new Notification(`${a.instrument} · ${a.title}`, {
              body: a.detail,
              tag: a.key, // collapse repeats in the OS tray
              silent: !cfg.sound,
            });
          } catch {
            /* notification blocked */
          }
        }
      }
      if (cfg.sound) beep();
    }

    setLog((prev) => {
      const next = [...fresh.reverse(), ...prev].slice(0, LOG_CAP);
      localStorage.setItem(LOG_KEY, JSON.stringify(next));
      return next;
    });
    setUnseen((n) => n + fresh.length);
  }, [data, cfg.mode, cfg.enabled, cfg.sound, perm, instrument]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p === 'granted') setCfg((c) => ({ ...c, enabled: true }));
    } catch {
      /* ignore */
    }
  }, []);

  const setEnabled = useCallback((enabled: boolean) => setCfg((c) => ({ ...c, enabled })), []);
  const setSound = useCallback((sound: boolean) => setCfg((c) => ({ ...c, sound })), []);
  const setMode = useCallback((mode: AlertMode) => setCfg((c) => ({ ...c, mode })), []);
  const clearUnseen = useCallback(() => setUnseen(0), []);
  const clearLog = useCallback(() => {
    setLog([]);
    localStorage.removeItem(LOG_KEY);
  }, []);

  return {
    cfg,
    perm,
    log,
    unseen,
    requestPermission,
    setEnabled,
    setSound,
    setMode,
    clearUnseen,
    clearLog,
  };
}
