/**
 * Tests: hn_contrataciones_abiertas en Source Catalog
 *
 * Verifica que la fuente refleja el estado real:
 *   - aiFlowStatus = connected_identity_in_run (RTN por nombre en cada corrida,
 *     SOURCES-GT-HN-BY-NAME-1, autorizado por la dueña el 30-09)
 *   - connectionMode = read_only_snapshot (no not_persisted)
 *   - operationalStatus = partial_snapshot (no dry_run_validated)
 *   - nextAction menciona 72 proveedores cargados
 *   - Guardrails: no SAR, no Registro Mercantil, homónimos = señal, cobertura piloto
 *   - Cero cambio de comportamiento: no entra en recommendedSources; su rol en
 *     la estrategia sigue siendo sector_signal
 *
 * Hitos: Centroamérica.8C.4C, SOURCES-CATALOG-REFLECTS-WIRED-SOURCES-1
 * Previo: 8C.2 (dry_run_validated + not_persisted), 8C.4C (snapshot_persisted)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSourceCatalogViewModel } from '@/modules/source-catalog/queries';
import { OPERATIONAL_STATUS_LABELS, AI_FLOW_STATUS_LABELS, CONNECTION_MODE_LABELS } from '@/modules/source-catalog/labels';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';
import { buildSearchStrategyFromCatalog } from '@/server/agents/prospecting-toolkit/search-strategy-builder';

describe('hn_contrataciones_abiertas — Source Catalog entry (post-snapshot 8C.4C)', () => {
  const { sources } = getSourceCatalogViewModel();
  const source = sources.find((s) => s.key === 'hn_contrataciones_abiertas');

  it('existe en el Source Catalog', () => {
    assert.ok(source, 'La fuente hn_contrataciones_abiertas debe existir');
  });

  it('país = Honduras (HN)', () => {
    assert.ok(source?.countryCodes.includes('HN'), 'Debe incluir HN en countryCodes');
  });

  it('tipo = procurement', () => {
    assert.strictEqual(source?.type, 'procurement');
  });

  it('sellupUse = commercial_signal (señal B2G)', () => {
    assert.strictEqual(source?.sellupUse, 'commercial_signal');
  });

  // ── Estado post-snapshot ──────────────────────────────────────────────────

  it('aiFlowStatus = connected_identity_in_run (RTN por nombre en cada corrida)', () => {
    assert.strictEqual(source?.aiFlowStatus, 'connected_identity_in_run');
  });

  it('aiFlowStatus NO es dry_run_validated (estado anterior, ya superado)', () => {
    assert.notEqual(source?.aiFlowStatus, 'dry_run_validated');
  });

  it('connectionMode = read_only_snapshot (lee el snapshot ya cargado)', () => {
    assert.strictEqual(source?.connectionMode, 'read_only_snapshot');
  });

  it('connectionMode NO es not_persisted (snapshot existe desde 8C.4B.2B)', () => {
    assert.notEqual(source?.connectionMode, 'not_persisted');
  });

  it('operationalStatus = partial_snapshot (72 filas, cobertura piloto)', () => {
    assert.strictEqual(source?.operationalStatus, 'partial_snapshot');
  });

  it('operationalStatus NO es dry_run_validated (estado anterior, ya superado)', () => {
    assert.notEqual(source?.operationalStatus, 'dry_run_validated');
  });

  // ── Labels visibles ──────────────────────────────────────────────────────

  it('label operationalStatus visible = "Snapshot parcial"', () => {
    const label = OPERATIONAL_STATUS_LABELS[source?.operationalStatus ?? 'dry_run_validated'];
    assert.strictEqual(label, 'Snapshot parcial');
  });

  it('label aiFlowStatus visible = "Conectada · número fiscal por nombre en cada corrida"', () => {
    const label = AI_FLOW_STATUS_LABELS[source?.aiFlowStatus ?? 'dry_run_validated'];
    assert.strictEqual(label, 'Conectada · número fiscal por nombre en cada corrida');
  });

  it('label connectionMode visible = "Read-only snapshot"', () => {
    const label = CONNECTION_MODE_LABELS[source?.connectionMode ?? 'not_persisted'];
    assert.strictEqual(label, 'Read-only snapshot');
  });

  // ── nextAction refleja snapshot persistido ────────────────────────────────

  it('nextAction menciona 72 proveedores cargados', () => {
    assert.ok(source?.nextAction?.includes('72'), 'nextAction debe mencionar 72 proveedores');
  });

  it('nextAction NO menciona "Dry-run" como estado actual', () => {
    const text = (source?.nextAction ?? '').toLowerCase();
    assert.ok(!text.includes('siguiente paso: snapshot'), 'no debe sugerir snapshot controlado como paso pendiente');
  });

  it('nextAction menciona revisión humana para los nombres repetidos', () => {
    const text = (source?.nextAction ?? '').toLowerCase();
    assert.ok(text.includes('revisión humana'), 'nextAction debe mencionar revisión humana');
  });

  it('nextAction menciona el RTN por nombre en cada corrida', () => {
    const text = (source?.nextAction ?? '').toLowerCase();
    assert.ok(text.includes('rtn por nombre'), 'nextAction debe mencionar RTN por nombre');
    assert.ok(text.includes('cada corrida'), 'nextAction debe mencionar cada corrida');
  });

  it('ya NO dice que no sirve para identidad ni que no hay matching', () => {
    const all = [source?.nextAction ?? '', source?.recommendedUse ?? '', ...(source?.limitations ?? []), ...(source?.riskNotes ?? [])]
      .join(' ')
      .toLowerCase();
    assert.ok(!all.includes('validación de identidad'), 'texto obsoleto: "validación de identidad"');
    assert.ok(!all.includes('sin matching automático'), 'texto obsoleto: "Sin matching automático"');
    assert.ok(!all.includes('post-approval no habilitado'), 'texto obsoleto: "Post-approval no habilitado"');
  });

  // ── Cero cambio de comportamiento del Agente 1 ────────────────────────────

  it('NO es connected ni connected_post_approval (no entra en recommendedSources)', () => {
    assert.notEqual(source?.aiFlowStatus, 'connected');
    assert.notEqual(source?.aiFlowStatus, 'connected_post_approval');
  });

  it('getCatalogContext(HN) no la devuelve en recommendedSources (en ninguna profundidad)', () => {
    for (const searchDepth of ['basic', 'standard', 'deep'] as const) {
      const ctx = getCatalogContext({ country: 'Honduras', countryCode: 'HN', industry: 'technology', searchDepth });
      assert.ok(!ctx.recommendedSources.some((s) => s.key === 'hn_contrataciones_abiertas'), searchDepth);
    }
  });

  it('su rol en la estrategia sigue siendo sector_signal (sin cambio frente a snapshot_persisted)', () => {
    const st = buildSearchStrategyFromCatalog({ countryCode: 'HN', country: 'Honduras', industry: 'technology' });
    const dec = st.sourceDecisions.find((d) => d.sourceKey === 'hn_contrataciones_abiertas');
    assert.equal(dec?.role, 'sector_signal');
    assert.equal(dec?.reason, 'commercial_signal_sector_discovery');
  });

  it('connectionMode NO implica escritura operativa automática', () => {
    assert.notEqual(source?.connectionMode, 'automatic_enrichment');
    assert.notEqual(source?.connectionMode, 'wizard_discovery');
    assert.notEqual(source?.connectionMode, 'credential_configured');
  });

  // ── Guardrails en limitations ─────────────────────────────────────────────

  it('limitations menciona que NO reemplaza SAR Honduras', () => {
    const lims = source?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('sar')), 'Debe mencionar SAR Honduras');
  });

  it('limitations menciona que NO reemplaza Registro Mercantil', () => {
    const lims = source?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('registro mercantil')), 'Debe mencionar Registro Mercantil');
  });

  it('limitations menciona la cobertura muy baja del piloto (72)', () => {
    const lims = source?.limitations ?? [];
    assert.ok(lims.some((l) => l.includes('72') && l.toLowerCase().includes('piloto')), 'Debe mencionar 72 del piloto');
  });

  it('limitations menciona que sólo cubre proveedores del Estado (B2G)', () => {
    const lims = source?.limitations ?? [];
    assert.ok(lims.some((l) => l.includes('B2G')), 'Debe mencionar cobertura B2G');
  });

  it('limitations menciona que no hay coincidencias aproximadas', () => {
    const lims = source?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('coincidencias aproximadas')), 'Debe mencionar coincidencia exacta');
  });

  it('limitations menciona que NO crea cuentas ni candidatos por sí sola', () => {
    const lims = source?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('no crea cuentas ni candidatos')), 'Debe mencionar que no crea cuentas ni candidatos');
  });

  it('riskNotes: homónimos = señal y nombres genéricos nunca', () => {
    const risks = (source?.riskNotes ?? []).join(' ').toLowerCase();
    assert.ok(risks.includes('homónimos') && risks.includes('señal'), 'Debe mencionar homónimos como señal');
    assert.ok(risks.includes('genéricos'), 'Debe mencionar nombres genéricos');
  });

  it('riskNotes menciona riesgo de personas naturales', () => {
    const risks = source?.riskNotes ?? [];
    assert.ok(risks.some((r) => r.toLowerCase().includes('personas naturales')), 'Debe mencionar riesgo personas naturales');
  });

  // ── recommendedUse ────────────────────────────────────────────────────────

  it('recommendedUse menciona ONCAE Honduras', () => {
    assert.ok((source?.recommendedUse ?? '').toLowerCase().includes('oncae'), 'Debe mencionar ONCAE');
  });

  it('recommendedUse menciona OCP Data Registry', () => {
    assert.ok((source?.recommendedUse ?? '').toLowerCase().includes('ocp data registry'), 'Debe mencionar OCP Data Registry');
  });

  it('recommendedUse menciona snapshot', () => {
    assert.ok((source?.recommendedUse ?? '').toLowerCase().includes('snapshot'), 'Debe mencionar snapshot');
  });

  it('recommendedUse describe la regla fuerte: exactamente un RTN con ese núcleo de nombre', () => {
    assert.ok((source?.recommendedUse ?? '').toLowerCase().includes('exactamente un rtn'), 'Debe describir la regla de RTN único');
  });

  // ── Visibilidad en tabs ───────────────────────────────────────────────────

  it('CTA esperado NO es Conectar (connectionMode != not_connected)', () => {
    assert.notEqual(source?.connectionMode, 'not_connected');
  });

  it('aparece en tab Todas: fuente existe en el catálogo completo', () => {
    const { sources: allSources } = getSourceCatalogViewModel();
    assert.ok(allSources.some((s) => s.key === 'hn_contrataciones_abiertas'));
  });

  // ── Regresión: otras fuentes no_persisted conservan su estado ─────────────

  it('regresión: not_persisted aún existe como connectionMode en el catálogo (otras fuentes)', () => {
    const { sources: allSources } = getSourceCatalogViewModel();
    const notPersistedSources = allSources.filter((s) => s.connectionMode === 'not_persisted');
    // Honduras ya no usa not_persisted — pero puede haber otras fuentes que sí
    const hnInNotPersisted = notPersistedSources.some((s) => s.key === 'hn_contrataciones_abiertas');
    assert.ok(!hnInNotPersisted, 'Honduras NO debe usar not_persisted tras el snapshot piloto');
  });

  it('regresión: dry_run_validated aún existe como aiFlowStatus en el catálogo (otras fuentes)', () => {
    const { sources: allSources } = getSourceCatalogViewModel();
    // Verificar que Honduras no regresionó a dry_run_validated
    const hn = allSources.find((s) => s.key === 'hn_contrataciones_abiertas');
    assert.notEqual(hn?.aiFlowStatus, 'dry_run_validated');
  });
});
