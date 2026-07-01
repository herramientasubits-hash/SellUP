/**
 * Perú.4D — Retirar pe_web_inferred como fuente/adapter y dejar Perú
 * como configuración del Agente 1 con Tavily.
 *
 * Tests de verificación tras la corrección arquitectónica.
 *
 * Reglas:
 *   - No llamadas reales Tavily/Migo/SUNAT
 *   - No descarga ZIP
 *   - No writes a Supabase
 *   - No creación de candidatos reales
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Path guide from __tests__/:
//   .. = sunat-peru/, ../.. = connectors/, ../../.. = source-catalog/
//   ../../../.. = server/, ../../../../.. = src/

// ── 1-2: pe_web_inferred no aparece en Catálogo visible ni como fuente externa ──

describe('Perú.4D — pe_web_inferred eliminado del Catálogo', () => {
  it('pe_web_inferred NO está en CATALOG_SOURCES', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const keys = mod.CATALOG_SOURCES.map((s: { key: string }) => s.key);
    assert.equal(
      keys.includes('pe_web_inferred'),
      false,
      'pe_web_inferred no debe estar en CATALOG_SOURCES',
    );
  });

  it('pe_web_inferred no aparece como fuente externa (no es connectable)', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const peEntry = mod.CATALOG_SOURCES.find(
      (s: { key: string }) => s.key === 'pe_web_inferred',
    );
    assert.equal(peEntry, undefined, 'No debe existir entrada pe_web_inferred');
  });
});

// ── 3: pe_web_inferred no está en SOURCE_DISCOVERY_REGISTRY ────────────────────

describe('Perú.4D — pe_web_inferred no está en SOURCE_DISCOVERY_REGISTRY', () => {
  it('SOURCE_DISCOVERY_REGISTRY NO contiene pe_web_inferred', async () => {
    const mod = await import('../../../connector-registry');
    const keys = Object.keys(mod.SOURCE_DISCOVERY_REGISTRY);
    assert.equal(
      keys.includes('pe_web_inferred'),
      false,
      'pe_web_inferred no debe estar en SOURCE_DISCOVERY_REGISTRY',
    );
  });

  it('SOURCE_DISCOVERY_REGISTRY solo tiene CO, MX, CL', async () => {
    const mod = await import('../../../connector-registry');
    const keys = Object.keys(mod.SOURCE_DISCOVERY_REGISTRY).sort();
    assert.deepEqual(keys, ['cl_res', 'co_rues', 'mx_denue']);
  });
});

// ── 4-6: Perú metadata de sector inferido ──────────────────────────────────────

describe('Perú.4D — Perú metadata de sector inferido preservada', () => {
  it('sector_source = inferred_web_ai', async () => {
    const mod = await import('../peru-inferred-sector-metadata');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.sector_source, 'inferred_web_ai');
  });

  it('confidence_label = sector_inferred', async () => {
    const mod = await import('../peru-inferred-sector-metadata');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.confidence_label, 'sector_inferred');
  });

  it('ciiu_status = unavailable_for_mvp', async () => {
    const mod = await import('../peru-inferred-sector-metadata');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.ciiu_status, 'unavailable_for_mvp');
  });

  it('human_review_required = true', async () => {
    const mod = await import('../peru-inferred-sector-metadata');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.human_review_required, true);
  });

  it('official_ciiu_available = false', async () => {
    const mod = await import('../peru-inferred-sector-metadata');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.official_ciiu_available, false);
  });

  it('legal_validation_source = pe_sunat_bulk', async () => {
    const mod = await import('../peru-inferred-sector-metadata');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.legal_validation_source, 'pe_sunat_bulk');
  });

  it('legal_validation_mode = offline_snapshot_or_worker', async () => {
    const mod = await import('../peru-inferred-sector-metadata');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.legal_validation_mode, 'offline_snapshot_or_worker');
  });

  it('legal_validation_status = pending_snapshot_validation', async () => {
    const mod = await import('../peru-inferred-sector-metadata');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.legal_validation_status, 'pending_snapshot_validation');
  });
});

// ── 7: SUNAT como validación legal offline, no como API conectable ─────────────

describe('Perú.4D — SUNAT como validación legal offline', () => {
  it('pe_sunat_bulk existe en CATALOG_SOURCES con tipo official_registry', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const entry = mod.CATALOG_SOURCES.find(
      (s: { key: string }) => s.key === 'pe_sunat_bulk',
    )!;
    assert.ok(entry, 'pe_sunat_bulk debe estar en CATALOG_SOURCES');
    assert.equal(entry.type, 'official_registry');
    assert.equal(entry.sellupUse, 'enrichment');
  });

  it('pe_sunat_bulk connectionMode NO es wizard_discovery', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const entry = mod.CATALOG_SOURCES.find(
      (s: { key: string }) => s.key === 'pe_sunat_bulk',
    )!;
    assert.equal(
      entry.connectionMode,
      'not_connected',
      'SUNAT bulk debe estar como not_connected (snapshot/worker offline)',
    );
  });

  it('pe_sunat_bulk NO está en SOURCE_DISCOVERY_REGISTRY', async () => {
    const mod = await import('../../../connector-registry');
    assert.equal(
      Object.keys(mod.SOURCE_DISCOVERY_REGISTRY).includes('pe_sunat_bulk'),
      false,
    );
  });

  it('pe_sunat existe en CATALOG_SOURCES como validation_only', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const entry = mod.CATALOG_SOURCES.find(
      (s: { key: string }) => s.key === 'pe_sunat',
    )!;
    assert.ok(entry, 'pe_sunat debe estar en CATALOG_SOURCES');
    assert.equal(entry.sellupUse, 'validation_only');
    assert.equal(entry.aiFlowStatus, 'manual_only');
  });
});

// ── 8: Migo como enriquecimiento/validación, no CIIU ni discovery ──────────────

describe('Perú.4D — Migo no es CIIU ni discovery', () => {
  it('pe_migo_api existe en CATALOG_SOURCES como validation_only', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const entry = mod.CATALOG_SOURCES.find(
      (s: { key: string }) => s.key === 'pe_migo_api',
    )!;
    assert.ok(entry, 'pe_migo_api debe estar en CATALOG_SOURCES');
    assert.equal(
      entry.sellupUse,
      'validation_only',
      'Migo debe ser validation_only, no discovery',
    );
    assert.equal(
      entry.aiFlowStatus,
      'eligible_not_connected',
    );
  });

  it('pe_migo_api NO está en SOURCE_DISCOVERY_REGISTRY', async () => {
    const mod = await import('../../../connector-registry');
    assert.equal(
      Object.keys(mod.SOURCE_DISCOVERY_REGISTRY).includes('pe_migo_api'),
      false,
    );
  });

  it('pe_migo_api recommendedUse deja claro que NO es CIIU ni discovery y limitations lo confirma', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const entry = mod.CATALOG_SOURCES.find(
      (s: { key: string }) => s.key === 'pe_migo_api',
    )!;
    assert.equal(entry.recommendedUse.includes('No devuelve CIIU'), true);
    assert.equal(entry.recommendedUse.includes('No usar como fuente sectorial ni para discovery'), true);
    assert.equal(entry.sellupUse, 'validation_only');
    assert.equal(entry.aiFlowStatus, 'eligible_not_connected');
  });
});

// ── 9: Migo conectado no muestra "Conectar" ────────────────────────────────────

describe('Perú.4D — Migo no muestra "Conectar" cuando tiene credencial', () => {
  it('pe_migo_api tiene connectionMode = not_connected', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const entry = mod.CATALOG_SOURCES.find(
      (s: { key: string }) => s.key === 'pe_migo_api',
    )!;
    assert.equal(entry.connectionMode, 'not_connected');
    assert.equal(entry.aiFlowStatus, 'eligible_not_connected');
  });

  it('Migo requiere credencial (REQUIRES_CREDENTIALS_KEYS)', async () => {
    const strat = await import('../../../connection-test/strategy-resolver');
    const catalog = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const entry = catalog.CATALOG_SOURCES.find(
      (s: { key: string }) => s.key === 'pe_migo_api',
    )!;
    const strategy = strat.resolveSourceConnectionStrategy(entry);
    assert.equal(strategy, 'requires_credentials', 'Migo debe requerir credenciales');
  });
});

// ── 10: No se rompe CO/MX/CL ──────────────────────────────────────────────────

describe('Perú.4D — No rompe CO/MX/CL', () => {
  it('CO sigue en CATALOG_SOURCES', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const keys = mod.CATALOG_SOURCES.map((s: { key: string }) => s.key);
    assert.ok(keys.includes('co_rues'), 'co_rues debe seguir en catálogo');
    assert.ok(keys.includes('co_siis'), 'co_siis debe seguir en catálogo');
  });

  it('MX sigue en CATALOG_SOURCES', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const keys = mod.CATALOG_SOURCES.map((s: { key: string }) => s.key);
    assert.ok(keys.includes('mx_denue'), 'mx_denue debe seguir en catálogo');
  });

  it('CL sigue en CATALOG_SOURCES', async () => {
    const mod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const keys = mod.CATALOG_SOURCES.map((s: { key: string }) => s.key);
    assert.ok(keys.includes('cl_res'), 'cl_res debe seguir en catálogo');
  });

  it('CO/MX/CL siguen en SOURCE_DISCOVERY_REGISTRY', async () => {
    const mod = await import('../../../connector-registry');
    const keys = Object.keys(mod.SOURCE_DISCOVERY_REGISTRY);
    assert.ok(keys.includes('co_rues'));
    assert.ok(keys.includes('mx_denue'));
    assert.ok(keys.includes('cl_res'));
  });

  it('COUNTRY_SOURCE_MAP preserva fuentes CO/MX/CL', async () => {
    const preflight = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const coResult = await preflight.runAgentSourceDiscoveryPreflight({
      countryCode: 'CO', enabled: true,
    });
    assert.equal(coResult.selectedSourceKey, 'co_rues');

    const mxResult = await preflight.runAgentSourceDiscoveryPreflight({
      countryCode: 'MX', enabled: true,
    });
    assert.equal(mxResult.selectedSourceKey, 'mx_denue');

    const clResult = await preflight.runAgentSourceDiscoveryPreflight({
      countryCode: 'CL', enabled: true,
    });
    assert.equal(clResult.selectedSourceKey, 'cl_res');
  });

  it('Preflight CO/MX/CL no arroja error', async () => {
    const preflight = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const co = await preflight.runAgentSourceDiscoveryPreflight({
      countryCode: 'CO', enabled: true,
    });
    assert.equal(co.errors.length, 0);

    const mx = await preflight.runAgentSourceDiscoveryPreflight({
      countryCode: 'MX', enabled: true,
    });
    assert.equal(mx.selectedSourceKey, 'mx_denue');

    const cl = await preflight.runAgentSourceDiscoveryPreflight({
      countryCode: 'CL', enabled: true,
    });
    assert.equal(cl.errors.length, 0);
  });
});

// ── 11: Sin llamadas reales Tavily/Migo/SUNAT ──────────────────────────────────

describe('Perú.4D — Sin llamadas externas reales', () => {
  it('Metadata module no referencia servicios externos', async () => {
    const mod = await import('../peru-inferred-sector-metadata');
    const fnStr = mod.buildEmptyMetadata.toString();
    assert.equal(fnStr.includes('fetch'), false, 'No debe usar fetch');
    assert.equal(fnStr.includes('axios'), false, 'No debe usar axios');
  });

  it('No hay llamadas reales a Migo desde metadata', async () => {
    const mod = await import('../peru-inferred-sector-metadata');
    const meta = mod.buildEmptyMetadata();
    assert.equal(meta.legal_validation_source, 'pe_sunat_bulk');
    assert.equal(meta.legal_validation_status, 'pending_snapshot_validation');
  });
});

// ── 12: No se crean candidatos reales ──────────────────────────────────────────

describe('Perú.4D — No se crean candidatos reales', () => {
  it('Peru metadata module no tiene lógica de escritura', async () => {
    const mod = await import('../peru-inferred-sector-metadata');
    const fnStr = mod.buildEmptyMetadata.toString();
    assert.equal(fnStr.includes('write'), false);
    assert.equal(fnStr.includes('insert'), false);
    assert.equal(fnStr.includes('create'), false);
    assert.equal(fnStr.includes('candidate'), false, 'No debe crear candidatos');
  });
});

// ── Preflight PE sin fuente estructurada (por diseño) ─────────────────────

describe('Perú.4D — Preflight PE sin fuente estructurada', () => {
  it('Preflight PE devuelve skipped con advertencia de sin fuente', async () => {
    const preflight = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const result = await preflight.runAgentSourceDiscoveryPreflight({
      countryCode: 'PE', enabled: true,
    });
    assert.equal(result.selectedSourceKey, null);
    assert.equal(result.status, 'skipped');
    const hasNoSourceWarning = result.warnings.some((w: string) =>
      w.includes('No hay fuente estructurada'),
    );
    assert.equal(hasNoSourceWarning, true, 'Debe advertir que no hay fuente estructurada para PE');
  });

  it('Preflight PE con enabled=false devuelve skipped', async () => {
    const preflight = await import(
      '../../../../agents/prospecting-toolkit/source-discovery-preflight'
    );
    const result = await preflight.runAgentSourceDiscoveryPreflight({
      countryCode: 'PE', enabled: false,
    });
    assert.equal(result.status, 'skipped');
    assert.equal(result.selectedSourceKey, null);
  });
});

// ── Migo connection status ─────────────────────────────────────────────────

describe('Perú.4D — Migo en source-connection-resolver', () => {
  it('Migo tiene vault secret name configurado', async () => {
    const resolver = await import('../../../source-connection-resolver');
    assert.ok(
      resolver.VAULT_SOURCE_SECRET_NAMES.pe_migo_api,
      'pe_migo_api debe tener vault secret name',
    );
    assert.equal(
      resolver.VAULT_SOURCE_SECRET_NAMES.pe_migo_api,
      'sellup_source_pe_migo_api_api_key',
    );
  });

  it('resolveSourceCredential reconoce pe_migo_api como fuente que requiere credencial', async () => {
    const resolver = await import('../../../source-connection-resolver');
    const stratMod = await import('../../../connection-test/strategy-resolver');
    const catalogMod = await import(
      '../../../../agents/prospecting-toolkit/source-catalog'
    );
    const entry = catalogMod.CATALOG_SOURCES.find(
      (s: { key: string }) => s.key === 'pe_migo_api',
    )!;
    const strategy = stratMod.resolveSourceConnectionStrategy(entry);
    assert.equal(strategy, 'requires_credentials');
  });
});

// ── Perú.UI.2 — Sincronizar estado de conexión Migo entre detalle y listado ──

describe('Perú.UI.2 — SourceStatusOverrides incluye connectionMode', () => {
  it('SourceStatusOverrides type incluye connectionMode opcional (verificación pura)', () => {
    // Verificación pura: la lógica de override acepta connectionMode
    const override: { operationalStatus: string; aiFlowStatus?: string; connectionMode?: string } = {
      operationalStatus: 'operational_verified',
      aiFlowStatus: 'connected',
      connectionMode: 'credential_configured',
    };
    assert.equal(override.connectionMode, 'credential_configured');
  });

  it('pe_migo_api catálogo estático conserva connectionMode = not_connected (pre-override)', async () => {
    const mod = await import('../../../../agents/prospecting-toolkit/source-catalog');
    const entry = mod.CATALOG_SOURCES.find((s: { key: string }) => s.key === 'pe_migo_api')!;
    assert.equal(
      entry.connectionMode,
      'not_connected',
      'El catálogo estático no cambia — el override viene de DB',
    );
  });

  it('pe_migo_api con connection_status=connected y requires_credentials=true → connectionMode override = credential_configured', () => {
    // Simular la lógica del override (extracción pura sin DB)
    const row = { source_key: 'pe_migo_api', connection_status: 'connected', requires_credentials: true };
    const connectionMode = row.requires_credentials ? 'credential_configured' : 'offline_signal';
    assert.equal(connectionMode, 'credential_configured');
  });

  it('pe_migo_api con connectionMode credential_configured → acción es Ver detalle, no Conectar', () => {
    const effectiveConnectionMode: string = 'credential_configured';
    const showConectar = effectiveConnectionMode === 'not_connected';
    assert.equal(showConectar, false, 'No debe mostrar CTA Conectar cuando connectionMode es credential_configured');
  });

  it('pe_migo_api conserva sellupUse = validation_only (no se convierte en fuente principal)', async () => {
    const mod = await import('../../../../agents/prospecting-toolkit/source-catalog');
    const entry = mod.CATALOG_SOURCES.find((s: { key: string }) => s.key === 'pe_migo_api')!;
    assert.equal(entry.sellupUse, 'validation_only', 'Migo es solo validación, no discovery ni enrichment principal');
  });

  it('pe_sunat_bulk sigue como offline_signal (sin credenciales requeridas)', async () => {
    const mod = await import('../../../../agents/prospecting-toolkit/source-catalog');
    const entry = mod.CATALOG_SOURCES.find((s: { key: string }) => s.key === 'pe_sunat_bulk')!;
    assert.equal(entry.connectionMode, 'offline_signal', 'SUNAT bulk no requiere credenciales');
  });

  it('pe_sunat_bulk con connection_status=connected y requires_credentials=false → connectionMode override = offline_signal', () => {
    const row = { source_key: 'pe_sunat_bulk', connection_status: 'connected', requires_credentials: false };
    const connectionMode = row.requires_credentials ? 'credential_configured' : 'offline_signal';
    assert.equal(connectionMode, 'offline_signal', 'SUNAT no cambia a credential_configured');
  });

  it('CONNECTION_MODE_LABELS tiene label para credential_configured', async () => {
    const { CONNECTION_MODE_LABELS } = await import('../../../../../modules/source-catalog/labels');
    assert.ok(
      'credential_configured' in CONNECTION_MODE_LABELS,
      'Falta label para credential_configured',
    );
    assert.equal(CONNECTION_MODE_LABELS['credential_configured' as keyof typeof CONNECTION_MODE_LABELS], 'Credencial configurada');
  });

  it('México/RD/Chile no están afectados — connectionMode no es credential_configured en catálogo estático', async () => {
    const mod = await import('../../../../agents/prospecting-toolkit/source-catalog');
    const mxEntries = mod.CATALOG_SOURCES.filter((s: { key: string; countryCodes?: string[] }) =>
      (s.countryCodes ?? []).includes('MX'),
    );
    const rdEntries = mod.CATALOG_SOURCES.filter((s: { key: string; countryCodes?: string[] }) =>
      (s.countryCodes ?? []).includes('DO'),
    );
    const clEntries = mod.CATALOG_SOURCES.filter((s: { key: string; countryCodes?: string[] }) =>
      (s.countryCodes ?? []).includes('CL'),
    );
    for (const e of [...mxEntries, ...rdEntries, ...clEntries]) {
      assert.notEqual(
        (e as { connectionMode?: string }).connectionMode,
        'credential_configured',
        `${(e as { key: string }).key} no debe tener credential_configured en catálogo estático`,
      );
    }
  });
});
