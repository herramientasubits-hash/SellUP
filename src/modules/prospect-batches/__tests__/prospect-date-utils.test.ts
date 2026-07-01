import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatProspectDate,
  isProspectCreatedToday,
  isProspectCreatedWithinDateRange,
} from '../prospect-date-utils';

const BOGOTA_TZ = 'America/Bogota';

function bogotaDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BOGOTA_TZ }).format(date);
}

describe('formatProspectDate', () => {
  it('contains month abbreviation and year', () => {
    const result = formatProspectDate('2026-07-01T12:00:00.000Z');
    assert.match(result, /jul/i);
    assert.match(result, /2026/);
  });

  it('does not contain a raw ISO timestamp', () => {
    const result = formatProspectDate('2026-06-30T21:53:47.670422+00:00');
    assert.doesNotMatch(result, /T\d{2}:/);
    assert.doesNotMatch(result, /\.\d{3}/);
    assert.doesNotMatch(result, /\+\d{2}:\d{2}/);
  });

  it('uses Bogota timezone — 04:30Z maps to Jun 30 in Bogota', () => {
    // 2026-07-01T04:30:00Z = Jun 30 23:30 Bogota (UTC-5)
    const result = formatProspectDate('2026-07-01T04:30:00.000Z');
    assert.match(result, /jun/i);
  });

  it('uses Bogota timezone — 06:00Z maps to Jul 01 in Bogota', () => {
    // 2026-07-01T06:00:00Z = Jul 01 01:00 Bogota (UTC-5)
    const result = formatProspectDate('2026-07-01T06:00:00.000Z');
    assert.match(result, /jul/i);
  });
});

describe('isProspectCreatedToday', () => {
  it('returns true for a timestamp from today in Bogota', () => {
    const todayBogota = bogotaDateString(new Date());
    const isoStr = `${todayBogota}T12:00:00-05:00`;
    assert.equal(isProspectCreatedToday(isoStr), true);
  });

  it('returns false for a timestamp from yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayBogota = bogotaDateString(yesterday);
    const isoStr = `${yesterdayBogota}T12:00:00-05:00`;
    assert.equal(isProspectCreatedToday(isoStr), false);
  });

  it('returns false for a 30-day-old record', () => {
    const old = new Date();
    old.setDate(old.getDate() - 30);
    assert.equal(isProspectCreatedToday(old.toISOString()), false);
  });

  it('handles UTC near midnight: 04:30Z is still Jun 30 in Bogota', () => {
    // Hardcoded: 2026-07-01T04:30Z = Jun 30 23:30 Bogota
    const ts = '2026-07-01T04:30:00.000Z';
    const expectedDate = bogotaDateString(new Date(ts));
    const todayBogota = bogotaDateString(new Date());
    assert.equal(isProspectCreatedToday(ts), expectedDate === todayBogota);
  });
});

describe('isProspectCreatedWithinDateRange', () => {
  it('returns true when no range is set', () => {
    assert.equal(isProspectCreatedWithinDateRange('2026-06-30T12:00:00.000Z', null, null), true);
  });

  it('returns true when both from and to are undefined', () => {
    assert.equal(isProspectCreatedWithinDateRange('2026-06-30T12:00:00.000Z', undefined, undefined), true);
  });

  it('includes records on the fromDate (inclusive)', () => {
    assert.equal(isProspectCreatedWithinDateRange('2026-07-01T15:00:00-05:00', '2026-07-01', undefined), true);
  });

  it('includes records on the toDate (inclusive)', () => {
    assert.equal(isProspectCreatedWithinDateRange('2026-07-01T15:00:00-05:00', undefined, '2026-07-01'), true);
  });

  it('excludes records before fromDate', () => {
    assert.equal(isProspectCreatedWithinDateRange('2026-06-30T15:00:00-05:00', '2026-07-01', '2026-07-31'), false);
  });

  it('excludes records after toDate', () => {
    assert.equal(isProspectCreatedWithinDateRange('2026-08-01T15:00:00-05:00', '2026-07-01', '2026-07-31'), false);
  });

  it('includes records within the range', () => {
    assert.equal(isProspectCreatedWithinDateRange('2026-07-15T12:00:00-05:00', '2026-07-01', '2026-07-31'), true);
  });

  it('handles single-day range (from === to)', () => {
    assert.equal(isProspectCreatedWithinDateRange('2026-07-01T12:00:00-05:00', '2026-07-01', '2026-07-01'), true);
    assert.equal(isProspectCreatedWithinDateRange('2026-06-30T12:00:00-05:00', '2026-07-01', '2026-07-01'), false);
  });

  it('uses Bogota TZ: 04:30Z is Jun 30 in Bogota, excluded from Jul-01 range', () => {
    // 2026-07-01T04:30:00Z = Jun 30 23:30 Bogota (UTC-5) → not in Jul 01 range
    assert.equal(isProspectCreatedWithinDateRange('2026-07-01T04:30:00.000Z', '2026-07-01', '2026-07-01'), false);
  });

  it('uses Bogota TZ: 06:00Z is Jul 01 in Bogota, included in Jul-01 range', () => {
    // 2026-07-01T06:00:00Z = Jul 01 01:00 Bogota → in Jul 01 range
    assert.equal(isProspectCreatedWithinDateRange('2026-07-01T06:00:00.000Z', '2026-07-01', '2026-07-01'), true);
  });
});
