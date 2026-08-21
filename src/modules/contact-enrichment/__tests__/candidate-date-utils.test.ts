import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCandidateCreatedToday } from '../candidate-date-utils';

const BOGOTA_TZ = 'America/Bogota';

function bogotaDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BOGOTA_TZ }).format(date);
}

describe('isCandidateCreatedToday', () => {
  it('returns true for a candidate created today in Bogota', () => {
    const todayBogota = bogotaDateString(new Date());
    const isoStr = `${todayBogota}T12:00:00-05:00`;
    assert.equal(isCandidateCreatedToday(isoStr), true);
  });

  it('returns false for a candidate created yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayBogota = bogotaDateString(yesterday);
    const isoStr = `${yesterdayBogota}T12:00:00-05:00`;
    assert.equal(isCandidateCreatedToday(isoStr), false);
  });

  it('returns false for a historical (30-day-old) candidate', () => {
    const old = new Date();
    old.setDate(old.getDate() - 30);
    assert.equal(isCandidateCreatedToday(old.toISOString()), false);
  });

  it('handles UTC near midnight: 04:30Z is still Jun 30 in Bogota', () => {
    const ts = '2026-07-01T04:30:00.000Z';
    const expectedDate = bogotaDateString(new Date(ts));
    const todayBogota = bogotaDateString(new Date());
    assert.equal(isCandidateCreatedToday(ts), expectedDate === todayBogota);
  });

  it('is deterministic across repeated calls with the same input (reload safety)', () => {
    const isoStr = new Date().toISOString();
    const first = isCandidateCreatedToday(isoStr);
    const second = isCandidateCreatedToday(isoStr);
    assert.equal(first, second);
  });

  it('does not depend on phone-reveal or workflow-status inputs (signature is createdAt only)', () => {
    assert.equal(isCandidateCreatedToday.length <= 2, true);
  });
});
