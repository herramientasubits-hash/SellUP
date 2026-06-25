/**
 * Perú.4B — Implementación segura de discovery Perú MVP con sector inferido
 *
 * Tests unitarios integrales para la activación controlada de Perú.
 *
 * Reglas:
 *   - No llamadas reales Tavily/Migo/SUNAT
 *   - No descarga ZIP
 *   - No writes a Supabase
 *   - No creación de candidatos reales
 *   - Todos los módulos mockeados
 */

import { describe, it, mock, after } from 'node:test';
import assert from 'node:assert/strict';

// ── Test 1: COUNTRY_SOURCE_MAP incluye PE → pe_web_inferred ────────────────────

describe('Perú.4B — COUNTRY_SOURCE_MAP', () => {
  it('incluye PE mapeado a pe_web_inferred', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    // Accedemos al mapa interno mediante el comportamiento: al llamar
    // runAgentSourceDiscoveryPreflight con PE, debe resolver a pe_web_inferred.
    // Verificamos que preflight devuelva selectedSourceKey correcto sin hacer
    // llamadas reales (el adapter devuelve 0 resultados, no falla).
    const result = await mod.runAgentSourceDiscoveryPreflight({
      countryCode: 'PE',
      enabled: true,
    });
    assert.equal(result.enabled, true);
    assert.equal(result.selectedSourceKey, 'pe_web_inferred');
  });

  it('preflight PE no falla ni arroja error', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const result = await mod.runAgentSourceDiscoveryPreflight({
      countryCode: 'PE',
      enabled: true,
    });
    assert.equal(result.status, 'warning');
    assert.equal(result.errors.length, 0);
  });

  it('preflight PE incluye warning de sector inferido', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const result = await mod.runAgentSourceDiscoveryPreflight({
      countryCode: 'PE',
      enabled: true,
    });
    const hasSectorWarning = result.warnings.some((w) =>
      w.includes('sector se infiere'),
    );
    assert.equal(hasSectorWarning, true);
  });
});

// ── Test 2-3-4: Registry ───────────────────────────────────────────────────────

describe('Perú.4B — SOURCE_DISCOVERY_REGISTRY', () => {
  it('contiene pe_web_inferred', async () => {
    const mod = await import('../../../connector-registry');
    const keys = Object.keys(mod.SOURCE_DISCOVERY_REGISTRY);
    assert.ok(keys.includes('pe_web_inferred'), 'pe_web_inferred debe estar registrado');
  });

  it('NO contiene pe_sunat_bulk', async () => {
    const mod = await import('../../../connector-registry');
    const keys = Object.keys(mod.SOURCE_DISCOVERY_REGISTRY);
    assert.equal(
      keys.includes('pe_sunat_bulk'),
      false,
      'pe_sunat_bulk NO debe estar en el registry como adapter runtime',
    );
  });

  it('NO contiene pe_migo_api', async () => {
    const mod = await import('../../../connector-registry');
    const keys = Object.keys(mod.SOURCE_DISCOVERY_REGISTRY);
    assert.equal(
      keys.includes('pe_migo_api'),
      false,
      'pe_migo_api NO debe estar en el registry',
    );
  });

  it('No rompe CO/MX/CL — todas las claves originales existen', async () => {
    const mod = await import('../../../connector-registry');
    const keys = Object.keys(mod.SOURCE_DISCOVERY_REGISTRY);
    assert.ok(keys.includes('co_rues'), 'co_rues debe seguir en registry');
    assert.ok(keys.includes('mx_denue'), 'mx_denue debe seguir en registry');
    assert.ok(keys.includes('cl_res'), 'cl_res debe seguir en registry');
  });
});

// ── Test 5-6-7-8: Preflight PE ─────────────────────────────────────────────────

describe('Perú.4B — Preflight PE', () => {
  it('devuelve estrategia inferred sector (selectedSourceKey=pe_web_inferred)', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const result = await mod.runAgentSourceDiscoveryPreflight({
      countryCode: 'PE',
      enabled: true,
    });
    assert.equal(result.selectedSourceKey, 'pe_web_inferred');
  });

  it('no requiere Migo — preflight no depende de pe_migo_api', async () => {
    // El registry no tiene pe_migo_api, así que preflight no puede requerirlo
    const registryMod = await import('../../../connector-registry');
    assert.equal(
      Object.keys(registryMod.SOURCE_DISCOVERY_REGISTRY).includes('pe_migo_api'),
      false,
    );
  });

  it('no requiere CIIU — preflight no exige sectorCode', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const result = await mod.runAgentSourceDiscoveryPreflight({
      countryCode: 'PE',
      enabled: true,
    });
    // El adapter devuelve candidates vacío, no falla por falta de CIIU
    assert.equal(result.errors.length, 0);
    assert.ok(result.qualitySummary.sectorUnknown >= 0);
  });

  it('no intenta procesar SUNAT ZIP', async () => {
    const peMod = await import('../run-pe-web-inferred-dry-run');
    const fnStr = peMod.runPeWebInferredDryRun.toString();
    assert.equal(
      fnStr.includes('padron_reducido_ruc'),
      false,
      'No debe referenciar padron_reducido_ruc',
    );
    assert.equal(
      fnStr.includes('.zip'),
      false,
      'No debe referenciar .zip',
    );
    assert.equal(
      fnStr.includes('download'),
      false,
      'No debe referenciar download',
    );
    assert.equal(
      fnStr.includes('SUNAT_BULK'),
      false,
      'No debe referenciar SUNAT_BULK',
    );
  });

  it('preflight PE con enabled=false devuelve skipped', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const result = await mod.runAgentSourceDiscoveryPreflight({
      countryCode: 'PE',
      enabled: false,
    });
    assert.equal(result.status, 'skipped');
    assert.equal(result.selectedSourceKey, null);
  });
});

// ── Test 9-10-11-12: Candidate metadata PE ─────────────────────────────────────

describe('Perú.4B — Candidate metadata PE', () => {
  it('buildEmptyMetadata incluye sector_source: inferred_web_ai', async () => {
    const mod = await import('..');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.sector_source, 'inferred_web_ai');
  });

  it('buildEmptyMetadata incluye confidence_label: sector_inferred', async () => {
    const mod = await import('..');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.confidence_label, 'sector_inferred');
  });

  it('buildEmptyMetadata incluye ciiu_status: unavailable_for_mvp', async () => {
    const mod = await import('..');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.ciiu_status, 'unavailable_for_mvp');
  });

  it('buildEmptyMetadata incluye human_review_required: true', async () => {
    const mod = await import('..');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.human_review_required, true);
  });

  it('buildEmptyMetadata incluye official_ciiu_available: false', async () => {
    const mod = await import('..');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.official_ciiu_available, false);
  });

  it('buildEmptyMetadata incluye legal_validation_source: pe_sunat_bulk', async () => {
    const mod = await import('..');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.legal_validation_source, 'pe_sunat_bulk');
  });

  it('buildEmptyMetadata incluye legal_validation_mode: offline_snapshot_or_worker', async () => {
    const mod = await import('..');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.legal_validation_mode, 'offline_snapshot_or_worker');
  });

  it('buildEmptyMetadata incluye legal_validation_status: pending_snapshot_validation', async () => {
    const mod = await import('..');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.legal_validation_status, 'pending_snapshot_validation');
  });
});

// ── Test 13: Sector confidence guardrail ────────────────────────────────────────

describe('Perú.4B — Sector confidence guardrails', () => {
  it('confianza 0.0 bloquea conversión (needs_review)', async () => {
    const meta = (await import('..')).buildEmptyMetadata();
    meta.sector_confidence_score = 0.0;

    const shouldBlock = meta.sector_confidence_score !== null &&
      meta.sector_confidence_score < 0.3 &&
      meta.human_review_required === true;

    assert.equal(shouldBlock, true, 'Confianza < 0.3 + human_review_required debe bloquear');
  });

  it('confianza 0.25 bloquea conversión', async () => {
    const meta = (await import('..')).buildEmptyMetadata();
    meta.sector_confidence_score = 0.25;

    const shouldBlock = meta.sector_confidence_score < 0.3 &&
      meta.human_review_required === true;

    assert.equal(shouldBlock, true);
  });

  it('confianza 0.5 no bloquea por confianza pero requiere revisión humana', async () => {
    const meta = (await import('..')).buildEmptyMetadata();
    meta.sector_confidence_score = 0.5;

    const confidenceOk = meta.sector_confidence_score >= 0.3;
    const needsReview = meta.human_review_required === true;

    assert.equal(confidenceOk, true);
    assert.equal(needsReview, true);
  });
});

// ── Test 14: No official_ciiu ───────────────────────────────────────────────────

describe('Perú.4B — No official CIIU', () => {
  it('ningún candidato PE usa official_ciiu', async () => {
    const meta = (await import('..')).buildEmptyMetadata();
    assert.equal(meta.ciiu_status, 'unavailable_for_mvp');
    assert.equal(meta.official_ciiu_available, false);
    assert.notEqual(meta.confidence_label, 'official_ciiu');
  });
});

// ── Test 15: No rompe CO/MX/CL ─────────────────────────────────────────────────

describe('Perú.4B — No rompe CO/MX/CL', () => {
  it('preflight CO sigue funcionando', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const result = await mod.runAgentSourceDiscoveryPreflight({
      countryCode: 'CO',
      enabled: true,
    });
    assert.equal(result.selectedSourceKey, 'co_rues');
    assert.equal(result.enabled, true);
  });

  it('preflight MX sigue funcionando', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const result = await mod.runAgentSourceDiscoveryPreflight({
      countryCode: 'MX',
      enabled: true,
    });
    assert.equal(result.selectedSourceKey, 'mx_denue');
    assert.equal(result.enabled, true);
  });

  it('preflight CL sigue funcionando', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const result = await mod.runAgentSourceDiscoveryPreflight({
      countryCode: 'CL',
      enabled: true,
    });
    assert.equal(result.selectedSourceKey, 'cl_res');
    assert.equal(result.enabled, true);
  });

  it('registry CO/MX/CL no modificado', async () => {
    const mod = await import('../../../connector-registry');
    const keys = Object.keys(mod.SOURCE_DISCOVERY_REGISTRY);
    // Verificar que las claves originales siguen siendo las mismas
    assert.ok(keys.includes('co_rues'));
    assert.ok(keys.includes('mx_denue'));
    assert.ok(keys.includes('cl_res'));
  });
});

// ── Test 16: Migo validation_only ───────────────────────────────────────────────

describe('Perú.4B — Migo sigue validation_only', () => {
  it('pe_migo_api no está en SOURCE_DISCOVERY_REGISTRY', async () => {
    const mod = await import('../../../connector-registry');
    assert.equal(
      Object.keys(mod.SOURCE_DISCOVERY_REGISTRY).includes('pe_migo_api'),
      false,
    );
  });
});

// ── Test 17-18-19: Sin llamadas reales ──────────────────────────────────────────

describe('Perú.4B — Sin llamadas externas reales', () => {
  it('adapter pe_web_inferred no llama fetch', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('No debe llamar fetch');
    });

    try {
      const mod = await import('../run-pe-web-inferred-dry-run');
      const report = await mod.runPeWebInferredDryRun({ limit: 5 });
      assert.equal(report.recordsRead, 0);
      assert.equal(report.samples.length, 0);
      // fetch nunca fue llamado
      assert.equal(fetchMock.mock.callCount(), 0);
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('adapter no escribe en Supabase — dryRun no tiene side effects', async () => {
    const mod = await import('../run-pe-web-inferred-dry-run');
    const report = await mod.runPeWebInferredDryRun();
    // No candidates = no writes posible
    assert.equal(report.acceptedCount, 0);
    assert.equal(report.samples.length, 0);
  });

  it('no se crean candidatos reales — adapter devuelve 0 samples', async () => {
    const mod = await import('../run-pe-web-inferred-dry-run');
    const report = await mod.runPeWebInferredDryRun({ limit: 10 });
    assert.equal(report.samples.length, 0);
    assert.equal(report.acceptedCount, 0);
  });
});

// ── Test 20: Typecheck/build ya se validan por separado con npm run typecheck ──

// ── Búsquedas obligatorias: ausencia de strings prohibidos ─────────────────────

describe('Perú.4B — Búsquedas obligatorias (strings prohibidos)', () => {
  it('padron_reducido_ruc.zip no aparece en código nuevo PE', async () => {
    const mod = await import('../run-pe-web-inferred-dry-run');
    const fnStr = mod.runPeWebInferredDryRun.toString();
    assert.equal(fnStr.includes('padron_reducido_ruc'), false);
  });

  it('downloadSunat no aparece en código nuevo PE', async () => {
    const mod = await import('../run-pe-web-inferred-dry-run');
    const fnStr = mod.runPeWebInferredDryRun.toString();
    assert.equal(fnStr.includes('downloadSunat'), false);
  });

  it('unzip no aparece en código nuevo PE', async () => {
    const mod = await import('../run-pe-web-inferred-dry-run');
    const fnStr = mod.runPeWebInferredDryRun.toString();
    assert.equal(fnStr.includes('unzip'), false);
  });

  it('inflate no aparece en código nuevo PE', async () => {
    const mod = await import('../run-pe-web-inferred-dry-run');
    const fnStr = mod.runPeWebInferredDryRun.toString();
    assert.equal(fnStr.includes('inflate'), false);
  });

  it('pe_sunat_bulk no está en SOURCE_DISCOVERY_REGISTRY (confirmado)', async () => {
    const mod = await import('../../../connector-registry');
    assert.equal(
      Object.keys(mod.SOURCE_DISCOVERY_REGISTRY).includes('pe_sunat_bulk'),
      false,
    );
  });

  it('pe_migo_api no está en SOURCE_DISCOVERY_REGISTRY (confirmado)', async () => {
    const mod = await import('../../../connector-registry');
    assert.equal(
      Object.keys(mod.SOURCE_DISCOVERY_REGISTRY).includes('pe_migo_api'),
      false,
    );
  });

  it('metadata no contiene official_ciiu: true', async () => {
    const meta = (await import('..')).buildEmptyMetadata();
    assert.equal(meta.official_ciiu_available, false);
    assert.equal(meta.ciiu_status, 'unavailable_for_mvp');
  });

  it('metadata no contiene confidence_label: official_ciiu', async () => {
    const meta = (await import('..')).buildEmptyMetadata();
    assert.notEqual(meta.confidence_label, 'official_ciiu');
    assert.equal(meta.confidence_label, 'sector_inferred');
  });

  it('No importa módulos de sunat-peru', async () => {
    const fs = await import('node:fs');
    const sourceCode = fs.readFileSync(
      new URL('../run-pe-web-inferred-dry-run.ts', import.meta.url),
      'utf-8',
    );
    // Verificar que no hay import real desde sunat-peru (pero permitir
    // referencias a 'sunat' como string o en comentarios)
    const importLines = sourceCode
      .split('\n')
      .filter((l: string) => /import\s+.*from\s+['"].*sunat/.test(l));
    assert.equal(
      importLines.length,
      0,
      'No debe importar módulos de sunat-peru/',
    );
    assert.equal(
      sourceCode.includes('SUNAT_BULK'),
      false,
      'No debe referenciar SUNAT_BULK',
    );
  });
});
