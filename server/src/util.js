// Shared helpers: time parsing, session derivation, instrument normalization.

// Parse MT5 "YYYY.MM.DD HH:MM:SS" (treated as UTC) → ISO 8601 string.
export function parseMt5Time(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(
    /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!m) {
    // fall back to Date parsing
    const d = new Date(s);
    return isNaN(d) ? null : d.toISOString();
  }
  const [, y, mo, d, h, mi, sec] = m;
  const dt = new Date(
    Date.UTC(+y, +mo - 1, +d, +h, +mi, sec ? +sec : 0)
  );
  return dt.toISOString();
}

// Parse a timestamp from various broker exports into an ISO 8601 UTC string.
// Handles MT5 year-first ("2026.08.05 09:03:43") and day-first European formats
// ("05/08/2026 09:03:43", used by Match-Trader). Day/month order is disambiguated
// per value (a field > 12 fixes it); when ambiguous, day-first is assumed since
// year-first is already handled above. Times are treated as UTC.
export function parseFlexibleTime(str) {
  if (!str) return null;
  const s = String(str).trim();
  // year-first: 2026.08.05 / 2026-08-05 / 2026/08/05  (also ISO with 'T')
  let m = s.match(
    /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    return new Date(
      Date.UTC(+y, +mo - 1, +d, +h, +mi, se ? +se : 0)
    ).toISOString();
  }
  // day/month-first: 05/08/2026 / 05.08.2026 / 05-08-2026
  m = s.match(
    /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (m) {
    let a = +m[1];
    let b = +m[2];
    const y = +m[3];
    const h = +m[4];
    const mi = +m[5];
    const se = m[6] ? +m[6] : 0;
    let day, mon;
    if (a > 12) [day, mon] = [a, b]; // clearly DD/MM
    else if (b > 12) [day, mon] = [b, a]; // clearly MM/DD
    else [day, mon] = [a, b]; // ambiguous → assume DD/MM (European)
    return new Date(Date.UTC(y, mon - 1, day, h, mi, se)).toISOString();
  }
  // epoch or other → reuse the bar-time parser.
  return parseBarTime(s);
}

// Parse a price-bar timestamp into an ISO 8601 UTC string.
// Accepts MT5 "YYYY.MM.DD HH:MM:SS", ISO 8601, or epoch (seconds or ms).
export function parseBarTime(str) {
  if (str === undefined || str === null || String(str).trim() === '') return null;
  const s = String(str).trim();
  // epoch (all digits, optional leading -)
  if (/^-?\d+$/.test(s)) {
    let n = Number(s);
    // < 1e12 → seconds; otherwise milliseconds
    if (Math.abs(n) < 1e12) n *= 1000;
    const d = new Date(n);
    return isNaN(d) ? null : d.toISOString();
  }
  return parseMt5Time(s);
}

// --- Timezone conversion (DST-aware, no external deps) ---
// Minutes a named IANA zone is ahead of UTC at a given instant (ms since epoch).
export function zoneOffsetMinutes(tz, ms) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  let hour = +p.hour;
  if (hour === 24) hour = 0; // some engines emit '24' for midnight
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return (asUTC - ms) / 60000;
}

// Build a true-UTC ISO string from wall-clock components interpreted in `tz`.
// tz null/'UTC' → treat the components as UTC (legacy behavior). DST-aware.
export function mkIso(y, mo, d, h, mi, s, tz) {
  const base = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!tz || tz === 'UTC') return new Date(base).toISOString();
  // Two-pass to settle DST boundaries (offset depends on the instant).
  let ms = base - zoneOffsetMinutes(tz, base) * 60000;
  ms = base - zoneOffsetMinutes(tz, ms) * 60000;
  return new Date(ms).toISOString();
}

// Reinterpret a "wall-clock-stored-as-UTC" ISO (how MT5 times were saved) as a
// wall clock in `tz`, returning the true-UTC ISO. No-op when tz is UTC/empty.
export function brokerIsoToUtc(iso, tz) {
  if (!iso || !tz || tz === 'UTC') return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return mkIso(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    tz
  );
}

// Derive session from a UTC entry_time ISO string.
export function sessionFromTime(iso) {
  if (!iso) return null;
  const h = new Date(iso).getUTCHours();
  if (h >= 7 && h <= 11) return 'london';
  if (h >= 12 && h <= 15) return 'overlap';
  if (h >= 16 && h <= 20) return 'ny';
  if (h === 21) return 'off';
  return 'asia'; // 22,23,0..6
}

// R-multiple = net P&L / initial risk, where risk = stop distance × cash-per-point.
// The cash value of a 1-price move (which folds in lot size AND the instrument's
// contract multiplier — e.g. XAUUSD is $100/point/lot, US100 $1) is inferred from
// the realized trade itself, so we never need a per-symbol multiplier table.
// Falls back to |entry-stop|*size (assumes $1/point/lot) only when no realized
// move is available (e.g. an open trade). Returns null when risk is undefined.
export function computeRMultiple({
  entry_price,
  exit_price,
  stop_price,
  size,
  gross_pnl,
  net_pnl,
}) {
  if (stop_price == null || entry_price == null || net_pnl == null) return null;
  const stopDist = Math.abs(entry_price - stop_price);
  if (!stopDist) return null;
  let riskCash = null;
  const move = exit_price != null ? Math.abs(exit_price - entry_price) : 0;
  if (move > 0 && gross_pnl != null && gross_pnl !== 0) {
    // |gross_pnl| / move = cash per price-point (already includes size × multiplier).
    riskCash = stopDist * (Math.abs(gross_pnl) / move);
  } else if (size) {
    riskCash = stopDist * Math.abs(size);
  }
  if (!riskCash) return null;
  return net_pnl / riskCash;
}

// Normalize instrument symbols to canonical names.
export function normalizeInstrument(sym) {
  if (!sym) return sym;
  let s = String(sym).trim().toUpperCase();
  // strip common broker suffixes (e.g. XAUUSD.m, US100-Z, NAS100_ecn)
  const base = s.replace(/[._\-].*$/, '');
  const gold = ['XAUUSD', 'GOLD'];
  const nas = ['US100', 'NAS100', 'USTEC', 'NDX', 'USTECH', 'NAS100USD'];
  if (gold.includes(base) || gold.includes(s)) return 'XAUUSD';
  if (nas.includes(base) || nas.includes(s)) return 'US100';
  return base || s;
}
