// Plain-JS runtime validators for the research module (the server stays JS, no
// Zod). Ingestors normalize raw feed rows through these before writing to
// market.db. Each row validator returns { value, errors: string[] } — value is
// the coerced row when errors is empty. See docs/signal/CONVENTIONS.md.

// --- primitives -----------------------------------------------------------
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Accepts Date | ISO string | epoch (s or ms) → epoch MILLISECONDS (UTC) | null.
export function toEpochMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') {
    // Heuristic: 10-digit values are seconds, 13-digit are ms.
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// --- row validators -------------------------------------------------------
export function validatePrice(row) {
  const errors = [];
  const instrument_id = num(row.instrument_id);
  const ts = toEpochMs(row.ts);
  const timeframe = str(row.timeframe);
  if (instrument_id == null) errors.push('instrument_id required');
  if (ts == null) errors.push('ts invalid');
  if (!timeframe) errors.push('timeframe required');
  const value = {
    instrument_id,
    ts,
    timeframe,
    o: num(row.o),
    h: num(row.h),
    l: num(row.l),
    c: num(row.c),
    v: num(row.v),
  };
  if (value.c == null) errors.push('close (c) required');
  return { value, errors };
}

export function validateSeriesPoint(row) {
  const errors = [];
  const series_id = str(row.series_id);
  const ts = toEpochMs(row.ts);
  if (!series_id) errors.push('series_id required');
  if (ts == null) errors.push('ts invalid');
  return { value: { series_id, ts, value: num(row.value) }, errors };
}

export function validateCalendarEvent(row) {
  const errors = [];
  const id = str(row.id);
  const ts = toEpochMs(row.ts);
  if (!id) errors.push('id required');
  if (ts == null) errors.push('ts invalid');
  return {
    value: {
      id,
      ts,
      country: str(row.country),
      name: str(row.name),
      impact: str(row.impact),
      consensus: num(row.consensus),
      prior: num(row.prior),
      actual: num(row.actual),
    },
    errors,
  };
}

// Generic guard: ensure the listed fields are present & non-null on obj.
export function require(obj, fields) {
  const errors = [];
  for (const f of fields) {
    if (obj?.[f] === null || obj?.[f] === undefined || obj?.[f] === '') {
      errors.push(`${f} required`);
    }
  }
  return errors;
}
