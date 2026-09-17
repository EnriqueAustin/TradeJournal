import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { KILL_ZONE_WINDOWS } from '../components/killZonePrimitive';
import { rangeFilters, todayUtc } from '../utils/review';

// End-of-session journaling nudge. When a session window ends (defaults: the
// London / NY kill-zone ends the charts shade, 10:00 and 15:00 UTC) and today
// has unreviewed trades, show an in-app banner and — if allowed — a browser
// notification. Config persists in localStorage; notifications dedupe per
// (day, session) the way useSetupAlerts dedupes signals.

export interface ReminderConfig {
  enabled: boolean; // in-app banner
  notify: boolean; // browser notification
  londonEnd: string; // HH:MM UTC
  nyEnd: string; // HH:MM UTC
}

const CFG_KEY = 'tj-review-reminders';
const FIRED_KEY = 'tj-review-reminders-fired';
const DISMISSED_KEY = 'tj-review-reminders-dismissed';
const CFG_EVENT = 'tj-review-reminders-cfg';
const NOTIFY_WINDOW_MIN = 180; // don't notify for a session that ended hours ago

const hhmm = (h: number) => `${String(h).padStart(2, '0')}:00`;
export const DEFAULT_REMINDER_CFG: ReminderConfig = {
  enabled: true,
  notify: false,
  londonEnd: hhmm(KILL_ZONE_WINDOWS.find((w) => w.kind === 'LON')?.endH ?? 10),
  nyEnd: hhmm(KILL_ZONE_WINDOWS.find((w) => w.kind === 'NY')?.endH ?? 15),
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function pushList(key: string, value: string) {
  try {
    const next = [value, ...readList(key).filter((x) => x !== value)].slice(0, 20);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function loadReminderCfg(): ReminderConfig {
  return readJson(CFG_KEY, DEFAULT_REMINDER_CFG);
}

export function saveReminderCfg(cfg: ReminderConfig) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CFG_EVENT));
}

function toMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The most recent session end that has passed today (UTC), if any. Pure. */
export function lastSessionEnded(
  cfg: Pick<ReminderConfig, 'londonEnd' | 'nyEnd'>,
  now: Date
): { session: 'London' | 'New York'; endMin: number } | null {
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const ends = (
    [
      ['London', toMin(cfg.londonEnd)],
      ['New York', toMin(cfg.nyEnd)],
    ] as const
  )
    .filter((e): e is readonly ['London' | 'New York', number] => e[1] != null && nowMin >= e[1])
    .sort((a, b) => b[1] - a[1]);
  return ends.length ? { session: ends[0][0], endMin: ends[0][1] } : null;
}

export interface ReminderBanner {
  key: string;
  day: string;
  session: 'London' | 'New York';
  count: number;
}

export function useReminderConfig() {
  const [cfg, setCfg] = useState<ReminderConfig>(loadReminderCfg);
  useEffect(() => {
    const on = () => setCfg(loadReminderCfg());
    window.addEventListener(CFG_EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(CFG_EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  const update = useCallback((patch: Partial<ReminderConfig>) => {
    const next = { ...loadReminderCfg(), ...patch };
    saveReminderCfg(next);
  }, []);
  return [cfg, update] as const;
}

export function useReviewReminders(account: number | null, onOpen?: (day: string) => void) {
  const [cfg] = useReminderConfig();
  const [banner, setBanner] = useState<ReminderBanner | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const ended = lastSessionEnded(cfg, now);
    if (!ended || (!cfg.enabled && !cfg.notify)) {
      setBanner(null);
      return;
    }
    const day = todayUtc();
    const key = `${day}|${ended.session}`;
    api
      .getTradesTotals(rangeFilters(account, day, day), { needs: 'unreviewed' })
      .then((t) => {
        if (cancelled) return;
        if (!t.count) {
          setBanner(null);
          return;
        }
        const b = { key, day, session: ended.session, count: t.count };
        setBanner(cfg.enabled && !readList(DISMISSED_KEY).includes(key) ? b : null);

        const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
        if (
          cfg.notify &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted' &&
          nowMin - ended.endMin <= NOTIFY_WINDOW_MIN &&
          !readList(FIRED_KEY).includes(key)
        ) {
          pushList(FIRED_KEY, key);
          try {
            const n = new Notification(`${t.count} trade${t.count === 1 ? '' : 's'} unreviewed — review now`, {
              body: `${ended.session} session is over. Grade and tag today's trades while they're fresh.`,
              tag: `tj-review-${key}`,
            });
            n.onclick = () => {
              window.focus();
              onOpen?.(day);
              n.close();
            };
          } catch {
            /* notification blocked */
          }
        }
      })
      .catch(() => {
        if (!cancelled) setBanner(null);
      });
    return () => {
      cancelled = true;
    };
    // onOpen is a navigation callback; re-running for its identity is pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, account, tick]);

  const dismiss = useCallback(() => {
    if (banner) pushList(DISMISSED_KEY, banner.key);
    setBanner(null);
  }, [banner]);

  return { banner, dismiss, cfg };
}
