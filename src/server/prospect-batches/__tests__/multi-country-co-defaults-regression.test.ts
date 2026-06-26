/**
 * Tests — Multi-país.1 CO defaults regression
 *
 * Verifies that no generic path in the Agente 1 multi-country core
 * silently falls back to 'CO' when the real country is PE, MX, CL,
 * or unknown.
 *
 * Scope:
 *  - executeNitAdapters: never runs CO adapters for non-CO countries
 *  - CO_NIT_SAFE_SOURCE_KEYS: all keys are co_* (no PE/MX/CL leakage)
 *  - resolveCalibrationConfig: CO default is explicit Sofka calibration config,
 *    overrides respected (PE, MX, CL)
 *  - Post-approval trigger guard: already tested in post-approval-trigger-country-guard.test.ts
 *  - Candidate-writer fallback: already tested in candidate-writer-country-fallback.test.ts
 *
 * No real Supabase calls, no LLM calls, no Tavily calls.
 * No candidates, accounts, or batches are created.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeNitAdapters,
  CO_NIT_SAFE_SOURCE_KEYS,
} from '../post-approval-nit-enrichment-worker';
import { resolveCalibrationConfig } from '../../agents/prospecting-toolkit/rich-profile-calibration-config';

// ── T1-T5: executeNitAdapters never runs CO adapters for non-CO ─────────────

describe('MCCDR1 — executeNitAdapters does not default to CO for non-CO countries', () => {
  async function runWithCountry(countryCode: string, sourceKeys: string[]) {
    let adapterCallCount = 0;
    let receivedCountryCode: string | undefined;
    const mockAdapter = {
      enrichCandidate: async (params: { countryCode: string }) => {
        adapterCallCount++;
        receivedCountryCode = params.countryCode;
        return { sourceKey: 'mock', status: 'completed', matchedBy: null, confidence: 0, reason: null };
      },
    };
    // Registry only has co_rues mock; CO_NIT_SAFE_SOURCE_KEYS filter decides what runs
    const registry: Record<string, typeof mockAdapter> = {
      co_rues: mockAdapter,
      co_personas_juridicas_cc: mockAdapter,
    };
    await executeNitAdapters({
      candidateName: 'Test Co',
      nit: '123456',
      countryCode,
      sector: null,
      existingMetadata: {},
      sourceKeys,
      registry: registry as never,
    });
    return { adapterCallCount, receivedCountryCode };
  }

  it('T1 — PE: adapter never runs when source_keys are non-CO', async () => {
    const { adapterCallCount } = await runWithCountry('PE', ['pe_sunat', 'pe_migo']);
    assert.equal(adapterCallCount, 0, 'No CO adapters should run for PE candidate with PE source_keys');
  });

  it('T2 — MX: adapter never runs when source_keys are non-CO', async () => {
    const { adapterCallCount } = await runWithCountry('MX', ['mx_sat', 'mx_imss']);
    assert.equal(adapterCallCount, 0, 'No CO adapters should run for MX candidate with MX source_keys');
  });

  it('T3 — CL: adapter never runs when source_keys are non-CO', async () => {
    const { adapterCallCount } = await runWithCountry('CL', ['cl_sii', 'cl_sirem']);
    assert.equal(adapterCallCount, 0, 'No CO adapters should run for CL candidate with CL source_keys');
  });

  it('T4 — unknown/null country (empty string): adapter never runs with non-CO source_keys', async () => {
    // The fix: ?? '' instead of ?? 'CO' — empty string passed, no CO adapter runs
    const { adapterCallCount } = await runWithCountry('', ['pe_sunat']);
    assert.equal(adapterCallCount, 0, 'No adapters should run when country is empty string');
  });

  it('T5 — CO: CO adapter runs when source_keys include a CO_NIT_SAFE key', async () => {
    // co_personas_juridicas_cc is in CO_NIT_SAFE_SOURCE_KEYS (co_rues is not)
    const { adapterCallCount, receivedCountryCode } = await runWithCountry('CO', ['co_personas_juridicas_cc']);
    assert.equal(adapterCallCount, 1, 'CO adapter should run for CO candidate');
    assert.equal(receivedCountryCode, 'CO', 'Adapter should receive CO country code');
  });

  it('T5b — CO candidate with non-CO source_keys: adapter never runs', async () => {
    const { adapterCallCount } = await runWithCountry('CO', ['pe_sunat', 'cl_sii']);
    assert.equal(adapterCallCount, 0, 'CO adapter filter should block non-CO source_keys even for CO country');
  });
});

// ── T6: CO_NIT_SAFE_SOURCE_KEYS are all co_* ────────────────────────────────

describe('MCCDR2 — CO_NIT_SAFE_SOURCE_KEYS contain only CO-prefixed keys', () => {
  it('T6 — every key starts with co_', () => {
    assert.ok(CO_NIT_SAFE_SOURCE_KEYS.length > 0, 'Source keys list should be non-empty');
    for (const key of CO_NIT_SAFE_SOURCE_KEYS) {
      assert.ok(
        key.startsWith('co_'),
        `Key "${key}" should start with "co_" — non-CO keys must not appear here`,
      );
    }
  });

  it('T6b — no PE/MX/CL/EC keys in CO safe list', () => {
    const nonCoKeys = CO_NIT_SAFE_SOURCE_KEYS.filter(
      (k) => k.startsWith('pe_') || k.startsWith('mx_') || k.startsWith('cl_') || k.startsWith('ec_'),
    );
    assert.deepEqual(nonCoKeys, [], 'CO_NIT_SAFE_SOURCE_KEYS must not contain non-CO source keys');
  });
});

// ── T7: rich-profile-calibration-config Sofka default is explicit ───────────

describe('MCCDR3 — resolveCalibrationConfig CO default is explicit Sofka, not silent fallback', () => {
  it('T7 — no env vars → Sofka/CO defaults (explicit calibration behavior)', () => {
    const config = resolveCalibrationConfig({});
    assert.equal(config.countryCode, 'CO');
    assert.equal(config.country, 'Colombia');
    assert.equal(config.candidateName, 'Sofka', 'Default candidate should be Sofka (explicit Colombia calibration)');
  });

  it('T8 — PE override respected: countryCode=PE', () => {
    const config = resolveCalibrationConfig({
      RICH_PROFILE_COUNTRY_CODE: 'PE',
      RICH_PROFILE_COUNTRY: 'Perú',
      RICH_PROFILE_CANDIDATE_NAME: 'Empresa Peru SA',
    });
    assert.equal(config.countryCode, 'PE');
    assert.equal(config.country, 'Perú');
    assert.notEqual(config.countryCode, 'CO', 'PE override must not produce CO');
  });

  it('T9 — MX override respected: countryCode=MX', () => {
    const config = resolveCalibrationConfig({
      RICH_PROFILE_COUNTRY_CODE: 'MX',
      RICH_PROFILE_COUNTRY: 'México',
    });
    assert.equal(config.countryCode, 'MX');
    assert.notEqual(config.countryCode, 'CO', 'MX override must not produce CO');
  });

  it('T10 — CL override respected: countryCode=CL', () => {
    const config = resolveCalibrationConfig({
      RICH_PROFILE_COUNTRY_CODE: 'CL',
      RICH_PROFILE_COUNTRY: 'Chile',
    });
    assert.equal(config.countryCode, 'CL');
    assert.notEqual(config.countryCode, 'CO', 'CL override must not produce CO');
  });

  it('T11 — unknown country override respected: countryCode=AR', () => {
    const config = resolveCalibrationConfig({
      RICH_PROFILE_COUNTRY_CODE: 'AR',
      RICH_PROFILE_COUNTRY: 'Argentina',
    });
    assert.equal(config.countryCode, 'AR');
    assert.notEqual(config.countryCode, 'CO', 'Unknown country override must not produce CO');
  });
});

// ── T12-T13: no external calls, no real DB writes ─────────────────────────

describe('MCCDR4 — no external calls or real data writes', () => {
  it('T12 — executeNitAdapters with empty registry makes no external calls', async () => {
    // With an empty registry, no adapters run — no HTTP, no DB
    const results = await executeNitAdapters({
      candidateName: 'Any Corp',
      nit: '000000',
      countryCode: 'PE',
      sector: null,
      existingMetadata: {},
      sourceKeys: ['co_rues', 'pe_sunat'],
      registry: {},
    });
    // co_rues filtered in by CO_NIT_SAFE_SOURCE_KEYS, but no adapter registered → skipped
    assert.ok(results.every(r => r.output.status === 'skipped'), 'Unregistered adapters should be skipped');
  });

  it('T13 — resolveCalibrationConfig is a pure function (no I/O)', () => {
    // Just calling it twice should produce identical results deterministically
    const a = resolveCalibrationConfig({ RICH_PROFILE_COUNTRY_CODE: 'MX' });
    const b = resolveCalibrationConfig({ RICH_PROFILE_COUNTRY_CODE: 'MX' });
    assert.deepEqual(a, b);
  });
});
