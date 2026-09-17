import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useReminderConfig, useReviewReminders } from '../hooks/useReviewReminders';

/** In-app "N trades unreviewed" banner shown after a session ends. */
export function ReviewReminderBanner({ account }: { account: number | null }) {
  const navigate = useNavigate();
  const { banner, dismiss } = useReviewReminders(account, (day) => navigate(`/review/day/${day}`));
  if (!banner) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2.5 text-sm">
      <span className="text-amber-300">
        🔔 {banner.session} session is over —{' '}
        <span className="num font-semibold">{banner.count}</span> trade{banner.count === 1 ? '' : 's'} unreviewed today.
      </span>
      <Link to={`/review/day/${banner.day}`} className="btn btn-primary px-3 py-1 text-xs">
        Review now →
      </Link>
      <button className="ml-auto text-xs text-slate-400 hover:text-slate-200" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}

/** Small popover to toggle reminders, set session end times and allow notifications. */
export function ReminderSettingsButton() {
  const [cfg, update] = useReminderConfig();
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const enableNotify = async (on: boolean) => {
    if (!on) return update({ notify: false });
    if (typeof Notification === 'undefined') return;
    let p = Notification.permission;
    if (p === 'default') {
      try {
        p = await Notification.requestPermission();
      } catch {
        /* ignore */
      }
    }
    setPerm(p);
    update({ notify: p === 'granted' });
  };

  const active = cfg.enabled || cfg.notify;
  return (
    <div className="relative" ref={ref}>
      <button
        className={`btn px-2 py-1 text-xs ${active ? '' : 'text-slate-500'}`}
        onClick={() => setOpen((o) => !o)}
        title="Journaling reminders after London / NY"
        aria-expanded={open}
      >
        🔔 Reminders {active ? 'on' : 'off'}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm shadow-lg">
          <div className="mb-2 font-semibold text-slate-200">Review reminders</div>
          <label className="mb-2 flex items-center gap-2 text-slate-300">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
            In-app banner
          </label>
          <label className="mb-1 flex items-center gap-2 text-slate-300">
            <input
              type="checkbox"
              checked={cfg.notify}
              disabled={perm === 'unsupported' || perm === 'denied'}
              onChange={(e) => enableNotify(e.target.checked)}
            />
            Browser notification
          </label>
          {(perm === 'denied' || perm === 'unsupported') && (
            <p className="mb-2 text-xs text-slate-500">
              {perm === 'denied' ? 'Notifications are blocked for this site in the browser.' : 'Not supported here.'}
            </p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">
              London ends (UTC)
              <input
                type="time"
                className="input mt-0.5 w-full py-1"
                value={cfg.londonEnd}
                onChange={(e) => update({ londonEnd: e.target.value })}
              />
            </label>
            <label className="text-xs text-slate-500">
              NY ends (UTC)
              <input
                type="time"
                className="input mt-0.5 w-full py-1"
                value={cfg.nyEnd}
                onChange={(e) => update({ nyEnd: e.target.value })}
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Defaults are the London / NY kill-zone ends. Fires once per session when today has unreviewed trades.
          </p>
        </div>
      )}
    </div>
  );
}
