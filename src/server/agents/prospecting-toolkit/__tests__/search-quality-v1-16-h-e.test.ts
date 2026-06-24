/**
 * Tests — Agent 1 v1.16H-E-pre — Globant Write Smoke Readiness
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * W1  — resolveWriteSmokeConfig con Globant env vars → smokeType y scriptName correctos
 * W2  — resolveWriteSmokeConfig defaults (sin env vars) → Sofka + valores v1.16F
 * W3  — searchDepth basic/advanced soportado por resolveWriteSmokeConfig
 * W4  — maxResults válido y fallback a 5
 * W5  — batch metadata smoke_type correcto para Globant
 * W6  — candidate mock city=null → requires_human_review=true, missing_fields incluye city
 * W7  — candidate mock size_range=10001+ → size.estimated_range correcto post-merge
 * W8  — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled=false no alterado
 * W9  — DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled=false no alterado
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCalibrationConfig,
  resolveWriteSmokeConfig,
} from '../rich-profile-calibration-config';
import { DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG, mergeRichProfileEnrichmentResult } from '../rich-profile-enrichment';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../linkedin-company-search';
import { buildCandidateRichProfileV1 } from '../candidate-rich-profile';

// ─── Globant env fixture ──────────────────────────────────────────────────────

const GLOBANT_ENV = {
  RICH_PROFILE_CANDIDATE_NAME: 'Globant',
  RICH_PROFILE_DOMAIN: 'globant.com',
  RICH_PROFILE_WEBSITE: 'https://www.globant.com',
  RICH_PROFILE_COUNTRY: 'Argentina',
  RICH_PROFILE_COUNTRY_CODE: 'AR',
  RICH_PROFILE_INDUSTRY: 'Tecnología',
  RICH_PROFILE_MAX_RESULTS: '5',
  RICH_PROFILE_SEARCH_DEPTH: 'basic',
  RICH_PROFILE_SMOKE_TYPE: 'rich_profile_flow_globant_v1_16h_e',
  RICH_PROFILE_SCRIPT_NAME: 'v1_16h_e_globant_rich_profile_write_smoke',
};

// ─── W1 — resolveWriteSmokeConfig con Globant env vars ───────────────────────

describe('W1 — resolveWriteSmokeConfig con Globant env vars → smokeType y scriptName correctos', () => {
  it('smokeType es rich_profile_flow_globant_v1_16h_e', () => {
    const config = resolveWriteSmokeConfig(GLOBANT_ENV);
    assert.equal(config.smokeType, 'rich_profile_flow_globant_v1_16h_e');
  });

  it('scriptName es v1_16h_e_globant_rich_profile_write_smoke', () => {
    const config = resolveWriteSmokeConfig(GLOBANT_ENV);
    assert.equal(config.scriptName, 'v1_16h_e_globant_rich_profile_write_smoke');
  });

  it('todos los campos de Globant están presentes', () => {
    const config = resolveWriteSmokeConfig(GLOBANT_ENV);
    assert.equal(config.candidateName, 'Globant');
    assert.equal(config.domain, 'globant.com');
    assert.equal(config.website, 'https://www.globant.com');
    assert.equal(config.country, 'Argentina');
    assert.equal(config.countryCode, 'AR');
    assert.equal(config.industry, 'Tecnología');
    assert.equal(config.maxResults, 5);
    assert.equal(config.searchDepth, 'basic');
  });
});

// ─── W2 — defaults sin env vars → Sofka + v1.16F ─────────────────────────────

describe('W2 — resolveWriteSmokeConfig defaults (sin env vars) → Sofka + valores v1.16F', () => {
  it('env vacío → candidato Sofka', () => {
    const config = resolveWriteSmokeConfig({});
    assert.equal(config.candidateName, 'Sofka');
    assert.equal(config.domain, 'sofka.com.co');
    assert.equal(config.website, 'https://www.sofka.com.co');
    assert.equal(config.country, 'Colombia');
    assert.equal(config.countryCode, 'CO');
  });

  it('env vacío → smokeType default = rich_profile_flow_v1_16f', () => {
    const config = resolveWriteSmokeConfig({});
    assert.equal(config.smokeType, 'rich_profile_flow_v1_16f');
  });

  it('env vacío → scriptName default = v1_16f_rich_profile_flow_write_smoke', () => {
    const config = resolveWriteSmokeConfig({});
    assert.equal(config.scriptName, 'v1_16f_rich_profile_flow_write_smoke');
  });

  it('resolveWriteSmokeConfig y resolveCalibrationConfig producen mismos campos base', () => {
    const base = resolveCalibrationConfig({});
    const smoke = resolveWriteSmokeConfig({});
    assert.equal(smoke.candidateName, base.candidateName);
    assert.equal(smoke.domain, base.domain);
    assert.equal(smoke.maxResults, base.maxResults);
    assert.equal(smoke.searchDepth, base.searchDepth);
  });
});

// ─── W3 — searchDepth basic/advanced ─────────────────────────────────────────

describe('W3 — searchDepth basic/advanced soportado por resolveWriteSmokeConfig', () => {
  it('basic → basic', () => {
    assert.equal(resolveWriteSmokeConfig({ RICH_PROFILE_SEARCH_DEPTH: 'basic' }).searchDepth, 'basic');
  });

  it('advanced → advanced', () => {
    assert.equal(resolveWriteSmokeConfig({ RICH_PROFILE_SEARCH_DEPTH: 'advanced' }).searchDepth, 'advanced');
  });

  it('inválido → basic', () => {
    assert.equal(resolveWriteSmokeConfig({ RICH_PROFILE_SEARCH_DEPTH: 'turbo' }).searchDepth, 'basic');
  });
});

// ─── W4 — maxResults válido y fallback ───────────────────────────────────────

describe('W4 — maxResults válido y fallback a 5', () => {
  it('5 → 5', () => {
    assert.equal(resolveWriteSmokeConfig({ RICH_PROFILE_MAX_RESULTS: '5' }).maxResults, 5);
  });

  it('inválido → 5', () => {
    assert.equal(resolveWriteSmokeConfig({ RICH_PROFILE_MAX_RESULTS: 'cinco' }).maxResults, 5);
  });

  it('ausente → 5', () => {
    assert.equal(resolveWriteSmokeConfig({}).maxResults, 5);
  });
});

// ─── W5 — batch metadata smoke_type correcto para Globant ────────────────────

describe('W5 — batch metadata smoke_type correcto para Globant', () => {
  it('smoke_type coincide con RICH_PROFILE_SMOKE_TYPE env var', () => {
    const config = resolveWriteSmokeConfig(GLOBANT_ENV);
    const batchMeta = {
      smoke_test: true,
      smoke_type: config.smokeType,
      qa_only: true,
      do_not_use_for_sales: true,
      do_not_convert: true,
      created_by_script: config.scriptName,
      cleanup_mode: 'logical_only',
    };

    assert.equal(batchMeta.smoke_type, 'rich_profile_flow_globant_v1_16h_e');
    assert.equal(batchMeta.created_by_script, 'v1_16h_e_globant_rich_profile_write_smoke');
    assert.equal(batchMeta.smoke_test, true);
    assert.equal(batchMeta.qa_only, true);
    assert.equal(batchMeta.do_not_use_for_sales, true);
    assert.equal(batchMeta.do_not_convert, true);
    assert.equal(batchMeta.cleanup_mode, 'logical_only');
  });
});

// ─── W6 — city=null → requires_human_review=true, missing_fields incluye city ─

describe('W6 — candidate mock city=null → requires_human_review=true, missing_fields incluye city', () => {
  it('merge con city=null → notes.requires_human_review=true y missing_fields incluye city', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Globant',
      website: 'https://www.globant.com',
      domain: 'globant.com',
      country: 'Argentina',
      countryCode: 'AR',
      industry: 'Tecnología',
    });

    const merged = mergeRichProfileEnrichmentResult(
      profile,
      {
        status: 'partial',
        city: null,
        size_range: '10001+',
        hq_country: null,
        evidence_url: 'https://www.globant.com/about',
        description: 'Globant was founded by Martin Migoya...',
        confidence: 60,
        warnings: ['size_without_city'],
      },
      { externalCallUsed: true, estimatedCostUsd: 0.008 },
    );

    assert.equal(merged.location.city, null, 'city debe permanecer null');
    assert.equal(
      merged.notes.requires_human_review,
      true,
      'requires_human_review debe ser true cuando city es null',
    );
    assert.ok(
      merged.notes.missing_fields?.includes('city'),
      `missing_fields debe incluir "city", got: ${JSON.stringify(merged.notes.missing_fields)}`,
    );
  });

  it('merge con city=null no inventa city aunque hq_country pueda venir de classification', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Globant',
      website: 'https://www.globant.com',
      domain: 'globant.com',
      country: 'Argentina',
      countryCode: 'AR',
      industry: 'Tecnología',
    });

    const merged = mergeRichProfileEnrichmentResult(
      profile,
      { status: 'partial', city: null, size_range: '10001+', confidence: 60 },
      { externalCallUsed: true, estimatedCostUsd: 0.008 },
    );

    assert.equal(merged.location.city, null, 'city debe permanecer null (no inventado)');
    // hq_country puede ser llenado desde la clasificación del candidato — eso es comportamiento válido
    assert.equal(merged.notes.requires_human_review, true, 'requires_human_review debe ser true');
  });
});

// ─── W7 — size_range=10001+ post-merge ───────────────────────────────────────

describe('W7 — size_range=10001+ → size.estimated_range correcto post-merge', () => {
  it('merge con size_range=10001+ → size.estimated_range=10001+, status=estimated', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Globant',
      website: 'https://www.globant.com',
      domain: 'globant.com',
      country: 'Argentina',
      countryCode: 'AR',
      industry: 'Tecnología',
    });

    const merged = mergeRichProfileEnrichmentResult(
      profile,
      {
        status: 'partial',
        city: null,
        size_range: '10001+',
        confidence: 60,
        evidence_url: 'https://www.globant.com/about',
      },
      { externalCallUsed: true, estimatedCostUsd: 0.008 },
    );

    assert.equal(merged.size.estimated_range, '10001+');
    assert.equal(merged.size.status, 'estimated');
    assert.equal(merged.provenance.enrichment_level, 'controlled');
    assert.equal(merged.provenance.external_calls_used, true);
    assert.ok(merged.provenance.cost_usd >= 0.008);
  });

  it('evidence.primary_url apunta a globant.com/about', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Globant',
      website: 'https://www.globant.com',
      domain: 'globant.com',
      country: 'Argentina',
      countryCode: 'AR',
      industry: 'Tecnología',
    });

    const merged = mergeRichProfileEnrichmentResult(
      profile,
      {
        status: 'partial',
        city: null,
        size_range: '10001+',
        confidence: 60,
        evidence_url: 'https://www.globant.com/about',
      },
      { externalCallUsed: true, estimatedCostUsd: 0.008 },
    );

    assert.ok(
      merged.evidence.primary_url?.includes('globant.com'),
      `evidence.primary_url debe apuntar a globant.com, got: ${merged.evidence.primary_url}`,
    );
  });
});

// ─── W8 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG no alterado ─────────────────

describe('W8 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled=false no alterado', () => {
  it('resolveWriteSmokeConfig con Globant no activa el config global', () => {
    resolveWriteSmokeConfig(GLOBANT_ENV);
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled, false);
  });
});

// ─── W9 — DEFAULT_LINKEDIN_SEARCH_CONFIG no alterado ─────────────────────────

describe('W9 — DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled=false no alterado', () => {
  it('enabled sigue false', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
  });
});
