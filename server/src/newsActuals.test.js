import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatActual, matchEvent, num, countriesFor } from './newsActuals.js';

const tv = [
  { currency: 'USD', date: '2026-09-16T12:30:00.000Z', title: 'Retail Sales MoM', actual: 1.2, forecast: 0.8, previous: -0.5, unit: '%' },
  { currency: 'USD', date: '2026-09-16T12:30:00.000Z', title: 'Retail Sales Ex Autos MoM', actual: 1.4, forecast: 0.5, previous: -0.2, unit: '%' },
  { currency: 'USD', date: '2026-09-16T12:30:00.000Z', title: 'Retail Sales Ex Gas/Autos MoM', actual: 1.2, forecast: null, previous: -0.3, unit: '%' },
  { currency: 'USD', date: '2026-09-16T12:30:00.000Z', title: 'Import Prices MoM', actual: 0.7, forecast: 0.4, previous: -0.3, unit: '%' },
  { currency: 'USD', date: '2026-09-16T18:00:00.000Z', title: 'Fed Interest Rate Decision', actual: 4, forecast: 4, previous: 3.75, unit: '%' },
  { currency: 'NZD', date: '2026-09-16T22:45:00.000Z', title: 'GDP Growth Rate QoQ', actual: 0.2, forecast: 0.1, previous: 0.9, unit: '%' },
  { currency: 'NZD', date: '2026-09-16T22:45:00.000Z', title: 'GDP Growth Rate YoY', actual: 2.6, forecast: 2.3, previous: 1.7, unit: '%' },
  { currency: 'GBP', date: '2026-09-16T06:00:00.000Z', title: 'Inflation Rate YoY', actual: 3.1, forecast: 3.1, previous: 2.9, unit: '%' },
  { currency: 'GBP', date: '2026-09-16T06:00:00.000Z', title: 'Core Inflation Rate YoY', actual: 2.6, forecast: 2.6, previous: 2.6, unit: '%' },
  { currency: 'USD', date: '2026-09-16T18:30:00.000Z', title: 'Fed Press Conference', actual: null },
];

const ff = (dt, currency, title, forecast = null, previous = null) => ({ dt, currency, title, forecast, previous });

test('matches FF titles to TradingView releases at the same minute', () => {
  assert.equal(matchEvent(ff('2026-09-16T12:30:00.000Z', 'USD', 'Retail Sales m/m', '0.8%', '-0.6%'), tv)?.title, 'Retail Sales MoM');
  assert.equal(matchEvent(ff('2026-09-16T12:30:00.000Z', 'USD', 'Core Retail Sales m/m', '0.6%', '-0.3%'), tv)?.title, 'Retail Sales Ex Autos MoM');
  assert.equal(matchEvent(ff('2026-09-16T18:00:00.000Z', 'USD', 'Federal Funds Rate', '4.00%', '3.75%'), tv)?.title, 'Fed Interest Rate Decision');
  assert.equal(matchEvent(ff('2026-09-16T22:45:00.000Z', 'NZD', 'GDP q/q', '0.1%', '0.8%'), tv)?.title, 'GDP Growth Rate QoQ');
  assert.equal(matchEvent(ff('2026-09-16T06:00:00.000Z', 'GBP', 'CPI y/y', '3.1%', '2.9%'), tv)?.title, 'Inflation Rate YoY');
});

test('no match without a clear signal, a different minute, or an actual', () => {
  assert.equal(matchEvent(ff('2026-09-16T18:30:00.000Z', 'USD', 'FOMC Press Conference'), tv), null);
  assert.equal(matchEvent(ff('2026-09-16T12:31:00.000Z', 'USD', 'Retail Sales m/m', '0.8%'), tv), null);
  assert.equal(matchEvent(ff('2026-09-16T12:30:00.000Z', 'EUR', 'Retail Sales m/m', '0.8%'), tv), null);
  assert.equal(matchEvent(ff('2026-09-16T18:00:00.000Z', 'USD', 'FOMC Statement'), tv), null);
});

test('formats actuals like the FF forecast beside them', () => {
  assert.equal(formatActual({ actual: 4, unit: '%' }, { forecast: '4.00%' }), '4.00%');
  assert.equal(formatActual({ actual: 8.3, scale: 'K' }, { forecast: null, previous: '-11.0K' }), '8.3K');
  assert.equal(formatActual({ actual: 32 }, { forecast: '34' }), '32');
  assert.equal(formatActual({ actual: null }, { forecast: '1' }), null);
  assert.equal(num('-11.0K'), -11);
  assert.deepEqual(countriesFor(['USD', 'USD', 'GBP', 'XXX']), ['US', 'GB']);
});
