/**
 * Tests — Agent 1 v1.16H-D-pre — Calibration Config Parameterization
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * F1  — env vars custom reemplazan candidato default (Globant)
 * F2  — defaults siguen funcionando sin env vars (Sofka)
 * F3  — searchDepth acepta basic/advanced; invalid → basic
 * F4  — maxResults acepta número válido; invalid → 5
 * F5  — no se altera DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG (sigue false)
 * F6  — no se altera DEFAULT_LINKEDIN_SEARCH_CONFIG (sigue false)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCalibrationConfig } from '../rich-profile-calibration-config';
import { DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG } from '../rich-profile-enrichment';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../linkedin-company-search';

// ─── F1 — env vars custom reemplazan candidato default ───────────────────────

describe('F1 — env vars custom reemplazan candidato default (Globant)', () => {
  it('todos los campos de Globant sobrescriben los defaults', () => {
    const config = resolveCalibrationConfig({
      RICH_PROFILE_CANDIDATE_NAME: 'Globant',
      RICH_PROFILE_DOMAIN: 'globant.com',
      RICH_PROFILE_WEBSITE: 'https://www.globant.com',
      RICH_PROFILE_COUNTRY: 'Argentina',
      RICH_PROFILE_COUNTRY_CODE: 'AR',
      RICH_PROFILE_INDUSTRY: 'Tecnología',
      RICH_PROFILE_MAX_RESULTS: '5',
      RICH_PROFILE_SEARCH_DEPTH: 'basic',
    });

    assert.equal(config.candidateName, 'Globant');
    assert.equal(config.domain, 'globant.com');
    assert.equal(config.website, 'https://www.globant.com');
    assert.equal(config.country, 'Argentina');
    assert.equal(config.countryCode, 'AR');
    assert.equal(config.industry, 'Tecnología');
    assert.equal(config.maxResults, 5);
    assert.equal(config.searchDepth, 'basic');
  });

  it('candidateName y domain de Globant reemplazan Sofka', () => {
    const config = resolveCalibrationConfig({
      RICH_PROFILE_CANDIDATE_NAME: 'Globant',
      RICH_PROFILE_DOMAIN: 'globant.com',
    });

    assert.equal(config.candidateName, 'Globant');
    assert.equal(config.domain, 'globant.com');
    assert.notEqual(config.candidateName, 'Sofka');
    assert.notEqual(config.domain, 'sofka.com.co');
  });
});

// ─── F2 — defaults siguen funcionando sin env vars ────────────────────────────

describe('F2 — defaults siguen funcionando sin env vars (Sofka)', () => {
  it('env vacío → todos los defaults de Sofka', () => {
    const config = resolveCalibrationConfig({});

    assert.equal(config.candidateName, 'Sofka');
    assert.equal(config.domain, 'sofka.com.co');
    assert.equal(config.website, 'https://www.sofka.com.co');
    assert.equal(config.country, 'Colombia');
    assert.equal(config.countryCode, 'CO');
    assert.equal(config.industry, 'Tecnología');
    assert.equal(config.maxResults, 5);
    assert.equal(config.searchDepth, 'basic');
  });

  it('env parcial (solo domain) → otros campos usan defaults', () => {
    const config = resolveCalibrationConfig({ RICH_PROFILE_DOMAIN: 'custom.com' });

    assert.equal(config.domain, 'custom.com');
    assert.equal(config.candidateName, 'Sofka', 'candidateName debe ser el default Sofka');
    assert.equal(config.country, 'Colombia', 'country debe ser el default Colombia');
  });
});

// ─── F3 — searchDepth acepta basic/advanced ───────────────────────────────────

describe('F3 — searchDepth acepta basic/advanced; inválido → basic', () => {
  it('basic → basic', () => {
    const config = resolveCalibrationConfig({ RICH_PROFILE_SEARCH_DEPTH: 'basic' });
    assert.equal(config.searchDepth, 'basic');
  });

  it('advanced → advanced', () => {
    const config = resolveCalibrationConfig({ RICH_PROFILE_SEARCH_DEPTH: 'advanced' });
    assert.equal(config.searchDepth, 'advanced');
  });

  it('valor inválido → basic (fallback seguro)', () => {
    const config = resolveCalibrationConfig({ RICH_PROFILE_SEARCH_DEPTH: 'turbo' });
    assert.equal(config.searchDepth, 'basic');
  });

  it('ausente → basic', () => {
    const config = resolveCalibrationConfig({});
    assert.equal(config.searchDepth, 'basic');
  });
});

// ─── F4 — maxResults acepta número válido ─────────────────────────────────────

describe('F4 — maxResults acepta número válido; inválido → 5', () => {
  it('3 → 3', () => {
    const config = resolveCalibrationConfig({ RICH_PROFILE_MAX_RESULTS: '3' });
    assert.equal(config.maxResults, 3);
  });

  it('10 → 10', () => {
    const config = resolveCalibrationConfig({ RICH_PROFILE_MAX_RESULTS: '10' });
    assert.equal(config.maxResults, 10);
  });

  it('string no numérico → 5 (default)', () => {
    const config = resolveCalibrationConfig({ RICH_PROFILE_MAX_RESULTS: 'diez' });
    assert.equal(config.maxResults, 5);
  });

  it('ausente → 5 (default)', () => {
    const config = resolveCalibrationConfig({});
    assert.equal(config.maxResults, 5);
  });

  it('número con decimales (no entero puro) → 5 (default)', () => {
    const config = resolveCalibrationConfig({ RICH_PROFILE_MAX_RESULTS: '3.5' });
    assert.equal(config.maxResults, 5);
  });
});

// ─── F5 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG sigue false ──────────────────

describe('F5 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG no alterado', () => {
  it('enabled sigue false después de resolveCalibrationConfig', () => {
    resolveCalibrationConfig({
      RICH_PROFILE_CANDIDATE_NAME: 'Globant',
      RICH_PROFILE_DOMAIN: 'globant.com',
    });

    assert.equal(
      DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled,
      false,
      'resolveCalibrationConfig NO debe activar el config global',
    );
  });
});

// ─── F6 — DEFAULT_LINKEDIN_SEARCH_CONFIG sigue false ──────────────────────────

describe('F6 — DEFAULT_LINKEDIN_SEARCH_CONFIG no alterado', () => {
  it('enabled sigue false', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
  });
});
