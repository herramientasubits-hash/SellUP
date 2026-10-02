/**
 * Tests: gt_rgae_proveedores en Source Catalog
 *
 * Verifica que la fuente RGAE Guatemala se registra correctamente y refleja
 * el estado real (GT.1/GT.2A + SOURCES-GT-HN-BY-NAME-1, autorizado 30-09):
 *   - existe en CATALOG_SOURCES con countryCodes GT
 *   - aiFlowStatus = connected_identity_in_run (NIT por nombre en cada corrida),
 *     connectionMode = read_only_snapshot
 *   - operationalStatus = partial_snapshot (snapshot de un solo año)
 *   - describe las reglas conservadoras (homónimos = señal, genéricos nunca)
 *   - cero cambio de comportamiento: no entra en recommendedSources y su rol
 *     en la estrategia sigue siendo sector_signal (sellupUse commercial_signal)
 *   - gt_camara_comercio permanece manual (fix de fallback pending_classification)
 *
 * Hitos: Catálogo.GT.2B, SOURCES-CATALOG-REFLECTS-WIRED-SOURCES-1
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_SOURCES } from '../source-catalog';
import { getCatalogContext } from '../catalog-context-retriever';
import { buildSearchStrategyFromCatalog } from '../search-strategy-builder';
import { resolveOperationalClassification } from '../../../../modules/source-catalog/operational-classification';
import { isManualSignalOnly, shouldSkipGenericConnectionPanels } from '../../../../modules/source-catalog/connection-panel-guards';
import { OPERATIONAL_STATUS_LABELS, AI_FLOW_STATUS_LABELS, CONNECTION_MODE_LABELS } from '../../../../modules/source-catalog/labels';

const gtRgae = CATALOG_SOURCES.find((s) => s.key === 'gt_rgae_proveedores');
const gtCamara = CATALOG_SOURCES.find((s) => s.key === 'gt_camara_comercio');

describe('gt_rgae_proveedores — Source Catalog entry (GT.2B)', () => {
  it('existe en el Source Catalog', () => {
    assert.ok(gtRgae, 'La fuente gt_rgae_proveedores debe existir');
  });

  it('país = Guatemala (GT)', () => {
    assert.ok(gtRgae?.countryCodes.includes('GT'), 'Debe incluir GT en countryCodes');
  });

  it('nombre menciona RGAE y Guatemala', () => {
    assert.ok(gtRgae?.name.includes('RGAE'), 'name debe mencionar RGAE');
    assert.ok(gtRgae?.name.toLowerCase().includes('guatemala'), 'name debe mencionar Guatemala');
  });

  it('tipo = procurement (literal permitido más cercano a government_supplier_registry)', () => {
    assert.strictEqual(gtRgae?.type, 'procurement');
  });

  it('sellupUse = commercial_signal (señal oficial de proveedor estatal)', () => {
    assert.strictEqual(gtRgae?.sellupUse, 'commercial_signal');
  });

  // ── Estado: NIT por nombre en cada corrida ────────────────────────────────

  it('aiFlowStatus = connected_identity_in_run (NIT por nombre en cada corrida)', () => {
    assert.strictEqual(gtRgae?.aiFlowStatus, 'connected_identity_in_run');
  });

  it('connectionMode = read_only_snapshot (lee el snapshot ya cargado)', () => {
    assert.strictEqual(gtRgae?.connectionMode, 'read_only_snapshot');
  });

  it('operationalStatus = partial_snapshot (literal permitido; no existe complete_snapshot en el contrato)', () => {
    assert.strictEqual(gtRgae?.operationalStatus, 'partial_snapshot');
  });

  // ── Labels visibles ──────────────────────────────────────────────────────

  it('label operationalStatus visible = "Snapshot parcial"', () => {
    const label = OPERATIONAL_STATUS_LABELS[gtRgae?.operationalStatus ?? 'dry_run_validated'];
    assert.strictEqual(label, 'Snapshot parcial');
  });

  it('label aiFlowStatus visible = "Conectada · número fiscal por nombre en cada corrida"', () => {
    const label = AI_FLOW_STATUS_LABELS[gtRgae?.aiFlowStatus ?? 'dry_run_validated'];
    assert.strictEqual(label, 'Conectada · número fiscal por nombre en cada corrida');
  });

  it('label connectionMode visible = "Read-only snapshot"', () => {
    const label = CONNECTION_MODE_LABELS[gtRgae?.connectionMode ?? 'not_persisted'];
    assert.strictEqual(label, 'Read-only snapshot');
  });

  // ── nextAction refleja el uso en cada corrida ─────────────────────────────

  it('nextAction menciona 6.245 Sociedades cargadas', () => {
    assert.ok(gtRgae?.nextAction?.includes('6.245'), 'nextAction debe mencionar 6.245');
  });

  it('nextAction menciona el NIT por nombre en cada corrida', () => {
    const text = (gtRgae?.nextAction ?? '').toLowerCase();
    assert.ok(text.includes('nit por nombre'), 'nextAction debe mencionar NIT por nombre');
    assert.ok(text.includes('cada corrida'), 'nextAction debe mencionar cada corrida');
  });

  it('nextAction menciona revisión humana para los nombres repetidos', () => {
    const text = (gtRgae?.nextAction ?? '').toLowerCase();
    assert.ok(text.includes('revisión humana'), 'nextAction debe mencionar revisión humana');
  });

  it('ya NO dice que no hay consumer de runtime ni que no sirve para identidad', () => {
    const all = [gtRgae?.nextAction ?? '', gtRgae?.recommendedUse ?? '', ...(gtRgae?.limitations ?? []), ...(gtRgae?.riskNotes ?? [])]
      .join(' ')
      .toLowerCase();
    assert.ok(!all.includes('no hay lookup'), 'texto obsoleto: "no hay lookup"');
    assert.ok(!all.includes('validación de identidad'), 'texto obsoleto: "validación de identidad"');
    assert.ok(!all.includes('sin matching automático'), 'texto obsoleto: "Sin matching automático"');
    assert.ok(!all.includes('post-approval no habilitado'), 'texto obsoleto: "Post-approval no habilitado"');
  });

  // ── Cero cambio de comportamiento del Agente 1 ────────────────────────────

  it('NO es connected ni connected_post_approval (no entra en recommendedSources)', () => {
    assert.notEqual(gtRgae?.aiFlowStatus, 'connected');
    assert.notEqual(gtRgae?.aiFlowStatus, 'connected_post_approval');
  });

  it('getCatalogContext(GT) no la devuelve en recommendedSources (en ninguna profundidad)', () => {
    for (const searchDepth of ['basic', 'standard', 'deep'] as const) {
      const ctx = getCatalogContext({ country: 'Guatemala', countryCode: 'GT', industry: 'technology', searchDepth });
      assert.ok(!ctx.recommendedSources.some((s) => s.key === 'gt_rgae_proveedores'), searchDepth);
    }
  });

  it('su rol en la estrategia sigue siendo sector_signal (sin cambio frente a snapshot_persisted)', () => {
    const st = buildSearchStrategyFromCatalog({ countryCode: 'GT', country: 'Guatemala', industry: 'technology' });
    const dec = st.sourceDecisions.find((d) => d.sourceKey === 'gt_rgae_proveedores');
    assert.equal(dec?.role, 'sector_signal');
    assert.equal(dec?.reason, 'commercial_signal_sector_discovery');
  });

  it('connectionMode NO implica escritura operativa automática', () => {
    assert.notEqual(gtRgae?.connectionMode, 'automatic_enrichment');
    assert.notEqual(gtRgae?.connectionMode, 'wizard_discovery');
    assert.notEqual(gtRgae?.connectionMode, 'credential_configured');
  });

  it('resolveOperationalClassification no cae en fallback pending_classification', () => {
    if (!gtRgae) return;
    const c = resolveOperationalClassification(gtRgae);
    assert.notEqual(c.sellupUse, 'pending_classification');
    assert.notEqual(c.aiFlowStatus, 'pending_classification');
  });

  it('shouldSkipGenericConnectionPanels = true (snapshot ya cargado, como hn_contrataciones_abiertas)', () => {
    if (!gtRgae) return;
    assert.ok(shouldSkipGenericConnectionPanels(gtRgae));
  });

  // ── Guardrails en limitations ─────────────────────────────────────────────

  it('limitations menciona que NO reemplaza SAT', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('sat')), 'Debe mencionar SAT');
  });

  it('limitations menciona que NO reemplaza Registro Mercantil', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('registro mercantil')), 'Debe mencionar Registro Mercantil');
  });

  it('limitations menciona que sólo cubre proveedores del Estado (B2G)', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.includes('B2G')), 'Debe mencionar cobertura B2G');
  });

  it('limitations menciona que no hay coincidencias aproximadas', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('coincidencias aproximadas')), 'Debe mencionar coincidencia exacta');
  });

  it('limitations menciona que NO crea cuentas ni candidatos por sí sola', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('no crea cuentas ni candidatos')), 'Debe mencionar que no crea cuentas ni candidatos');
  });

  it('limitations menciona snapshot de un solo año', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('un solo año')), 'Debe mencionar snapshot de un año');
  });

  it('riskNotes: homónimos = señal y nombres genéricos nunca', () => {
    const risks = (gtRgae?.riskNotes ?? []).join(' ').toLowerCase();
    assert.ok(risks.includes('homónimos') && risks.includes('señal'), 'Debe mencionar homónimos como señal');
    assert.ok(risks.includes('genéricos'), 'Debe mencionar nombres genéricos');
  });

  it('limitations menciona ingesta manual desde XLSX (sin API)', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('xlsx')), 'Debe mencionar ingesta manual XLSX');
  });

  // ── recommendedUse ────────────────────────────────────────────────────────

  it('recommendedUse menciona RGAE y MINFIN', () => {
    const text = (gtRgae?.recommendedUse ?? '').toLowerCase();
    assert.ok(text.includes('rgae'), 'Debe mencionar RGAE');
    assert.ok(text.includes('minfin'), 'Debe mencionar MINFIN');
  });

  it('recommendedUse menciona snapshot 2025', () => {
    assert.ok((gtRgae?.recommendedUse ?? '').includes('2025'), 'Debe mencionar 2025');
  });

  it('recommendedUse describe la regla fuerte: exactamente un NIT con ese núcleo de nombre', () => {
    const text = (gtRgae?.recommendedUse ?? '').toLowerCase();
    assert.ok(text.includes('exactamente un nit'), 'Debe describir la regla de NIT único');
  });
});

// ── gt_camara_comercio — fix de clasificación (no debe quedar como operativa) ──

describe('gt_camara_comercio — permanece manual tras GT.2B', () => {
  it('existe en el catálogo', () => {
    assert.ok(gtCamara, 'gt_camara_comercio no encontrado en CATALOG_SOURCES');
  });

  it('operationalStatus = manual_signal_only (sin cambios)', () => {
    assert.equal(gtCamara?.operationalStatus, 'manual_signal_only');
  });

  it('sellupUse = manual_reference (no pending_classification)', () => {
    assert.equal(gtCamara?.sellupUse, 'manual_reference');
    assert.notEqual(gtCamara?.sellupUse, 'pending_classification');
  });

  it('aiFlowStatus = manual_only (no pending_classification)', () => {
    assert.equal(gtCamara?.aiFlowStatus, 'manual_only');
    assert.notEqual(gtCamara?.aiFlowStatus, 'pending_classification');
  });

  it('connectionMode = not_applicable (no not_connected)', () => {
    assert.equal(gtCamara?.connectionMode, 'not_applicable');
    assert.notEqual(gtCamara?.connectionMode, 'not_connected');
  });

  it('resolveOperationalClassification no cae en fallback pending_classification', () => {
    if (!gtCamara) return;
    const c = resolveOperationalClassification(gtCamara);
    assert.notEqual(c.sellupUse, 'pending_classification');
    assert.notEqual(c.aiFlowStatus, 'pending_classification');
  });

  it('isManualSignalOnly = true (manual_signal_only + not_applicable)', () => {
    if (!gtCamara) return;
    assert.ok(isManualSignalOnly(gtCamara));
  });

  it('shouldSkipGenericConnectionPanels = true (no TestConnectionPanel ni historial)', () => {
    if (!gtCamara) return;
    assert.ok(shouldSkipGenericConnectionPanels(gtCamara));
  });

  it('name/url/recommendedUse/limitations/priority no cambiaron', () => {
    assert.equal(gtCamara?.name, 'Cámara de Comercio de Guatemala');
    assert.equal(gtCamara?.url, 'https://www.camaracomercio.com.gt/');
    assert.equal(
      gtCamara?.recommendedUse,
      'Directorio de empresas afiliadas a la Cámara. Identificar empresas activas en Guatemala.',
    );
    assert.deepEqual(gtCamara?.limitations, ['Solo empresas afiliadas', 'Sin API — consulta manual o directorio web']);
    assert.equal(gtCamara?.priority, 'P1');
  });
});
