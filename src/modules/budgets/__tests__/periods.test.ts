import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPeriodBounds, periodStartIso, periodEndIso } from '../periods';

// All dates use a fixed reference point (UTC) to avoid local-tz flakiness.
const JUN_15 = new Date('2026-06-15T14:30:00Z');
const JAN_01 = new Date('2026-01-01T00:00:00Z');
const MAR_31 = new Date('2026-03-31T23:59:59Z');
const DEC_31 = new Date('2026-12-31T23:59:59Z');

describe('getPeriodBounds — monthly', () => {
  it('starts on the first of the current month (UTC)', () => {
    const { start } = getPeriodBounds('monthly', JUN_15);
    assert.equal(start.toISOString(), '2026-06-01T00:00:00.000Z');
  });

  it('ends on the first of the next month (exclusive)', () => {
    const { end } = getPeriodBounds('monthly', JUN_15);
    assert.equal(end.toISOString(), '2026-07-01T00:00:00.000Z');
  });

  it('handles December → January rollover', () => {
    const { start, end } = getPeriodBounds('monthly', DEC_31);
    assert.equal(start.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(end.toISOString(), '2027-01-01T00:00:00.000Z');
  });
});

describe('getPeriodBounds — quarterly', () => {
  it('Q1: Jan-Mar (starts Jan 1, ends Apr 1)', () => {
    const { start, end } = getPeriodBounds('quarterly', JAN_01);
    assert.equal(start.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(end.toISOString(), '2026-04-01T00:00:00.000Z');
  });

  it('Q1 still covers Mar 31', () => {
    const { start, end } = getPeriodBounds('quarterly', MAR_31);
    assert.equal(start.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(end.toISOString(), '2026-04-01T00:00:00.000Z');
  });

  it('Q2: Apr-Jun', () => {
    const { start, end } = getPeriodBounds('quarterly', JUN_15);
    assert.equal(start.toISOString(), '2026-04-01T00:00:00.000Z');
    assert.equal(end.toISOString(), '2026-07-01T00:00:00.000Z');
  });

  it('Q4: Oct-Dec → ends Jan 1 next year', () => {
    const { start, end } = getPeriodBounds('quarterly', DEC_31);
    assert.equal(start.toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(end.toISOString(), '2027-01-01T00:00:00.000Z');
  });
});

describe('getPeriodBounds — annual', () => {
  it('starts Jan 1 of current year, ends Jan 1 next year', () => {
    const { start, end } = getPeriodBounds('annual', JUN_15);
    assert.equal(start.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(end.toISOString(), '2027-01-01T00:00:00.000Z');
  });
});

describe('getPeriodBounds — custom falls back to monthly', () => {
  it('behaves identically to monthly', () => {
    const monthly = getPeriodBounds('monthly', JUN_15);
    const custom = getPeriodBounds('custom', JUN_15);
    assert.equal(custom.start.toISOString(), monthly.start.toISOString());
    assert.equal(custom.end.toISOString(), monthly.end.toISOString());
  });
});

describe('periodStartIso / periodEndIso', () => {
  it('return ISO strings matching getPeriodBounds', () => {
    const { start, end } = getPeriodBounds('monthly', JUN_15);
    assert.equal(periodStartIso('monthly', JUN_15), start.toISOString());
    assert.equal(periodEndIso('monthly', JUN_15), end.toISOString());
  });
});
