/**
 * Tests for deriveMeasurementStatus (Hito I).
 * Pure function — no DB, no mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveMeasurementStatus } from '../provider-measurement';

describe('deriveMeasurementStatus', () => {
  // ── not_measured ────────────────────────────────────────────────────────────

  it('returns not_measured for samu_ia regardless of connection', () => {
    assert.equal(deriveMeasurementStatus('samu_ia', true, true), 'not_measured');
    assert.equal(deriveMeasurementStatus('samu_ia', false, false), 'not_measured');
    assert.equal(deriveMeasurementStatus('SAMU_IA', false, true), 'not_measured');
  });

  // ── active ──────────────────────────────────────────────────────────────────

  it('returns active when provider has tracked consumption', () => {
    assert.equal(deriveMeasurementStatus('tavily', true, true), 'active');
    assert.equal(deriveMeasurementStatus('apollo', true, true), 'active');
  });

  it('returns active even if isConnected is false when hasTrackedConsumption is true', () => {
    assert.equal(deriveMeasurementStatus('tavily', true, false), 'active');
  });

  // ── connected ───────────────────────────────────────────────────────────────

  it('returns connected when API is configured but no tracked consumption', () => {
    assert.equal(deriveMeasurementStatus('anthropic', false, true), 'connected');
    assert.equal(deriveMeasurementStatus('lusha', false, true), 'connected');
  });

  // ── prepared ────────────────────────────────────────────────────────────────

  it('returns prepared when neither connected nor tracked', () => {
    assert.equal(deriveMeasurementStatus('openai', false, false), 'prepared');
    assert.equal(deriveMeasurementStatus('gemini', false, false), 'prepared');
    assert.equal(deriveMeasurementStatus('unknown_provider', false, false), 'prepared');
  });

  // ── case insensitivity ───────────────────────────────────────────────────────

  it('normalises provider key to lowercase', () => {
    assert.equal(deriveMeasurementStatus('Tavily', true, true), 'active');
    assert.equal(deriveMeasurementStatus('ANTHROPIC', false, true), 'connected');
  });
});
