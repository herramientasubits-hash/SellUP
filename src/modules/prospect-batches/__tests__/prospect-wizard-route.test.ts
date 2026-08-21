/**
 * Q3F-5BB.10C3-FIX-1 (P1-3) — resolveProspectWizardRoute dry-route matrix.
 *
 * Pure resolver: no I/O, no env, no network.
 *
 * Invariant proved here (10C3, unchanged): a run whose EFFECTIVE provider is Lusha
 * never touches Apollo or Tavily.
 *
 * AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — the complementary row changed: a
 * Lusha-eligible intent with the flag OFF used to resolve to `wouldCallAction:
 * null`, i.e. nothing runnable at all. That is what left «Empresas por criterios»
 * with no executable path in all 20 supported countries for every industry mapping
 * to a Lusha sector. Lusha is a HIDDEN provider the user never selects, so with the
 * flag OFF the search now takes the ordinary Agent 1 discovery route — the same one
 * every non-Lusha-eligible search already took.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type { WizardLushaCriteriaState } from '@/modules/prospect-batches/wizard-lusha-criteria';
import { resolveProspectWizardRoute } from '@/modules/prospect-batches/prospect-wizard-route';

const CATALOG: ActiveIndustryCatalog = {
  version: '2.0.0',
  industries: [
    // AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 § 1 — catálogo Macro-v2: la ruta se
    // resuelve por el `slug` publicado, no por coincidencia difusa con el nombre
    // visible. `ind-mining` conserva un slug legacy a propósito: es la fila que NO
    // es una macro canónica y que por tanto no tiene ruta Lusha.
    {
      id: 'ind-health',
      name: 'Salud & Farmacéuticos',
      slug: 'health-pharma',
      description: null,
      sortOrder: 1,
    },
    { id: 'ind-mining', name: 'Minería', slug: 'mineria', description: null, sortOrder: 2 },
  ],
  subindustries: [
    {
      id: 'sub-hosp',
      industryId: 'ind-health',
      name: 'Hospitales',
      slug: 'hospitales',
      description: null,
      applicableCountries: null,
      sortOrder: 1,
    },
  ],
};

/** Lusha-eligible: CO + Salud maps to a Lusha sector. */
const ELIGIBLE: WizardLushaCriteriaState = {
  countryCode: 'CO',
  industryId: 'ind-health',
  subindustryIds: [],
  additionalCriteriaRaw: null,
};

/** Not Lusha-eligible: Minería does not map to a Lusha sector. */
const NOT_ELIGIBLE: WizardLushaCriteriaState = {
  countryCode: 'CO',
  industryId: 'ind-mining',
  subindustryIds: [],
  additionalCriteriaRaw: null,
};

function route(
  criteria: WizardLushaCriteriaState,
  lushaPreviewEnabled: boolean,
  executionEnabled: boolean,
) {
  return resolveProspectWizardRoute({ criteria, catalog: CATALOG, lushaPreviewEnabled, executionEnabled });
}

describe('resolveProspectWizardRoute — dry-route matrix', () => {
  it('eligible + flag on → lusha, Lusha pending-review action, no Apollo', () => {
    const r = route(ELIGIBLE, true, false);
    assert.equal(r.intendedProvider, 'lusha');
    assert.equal(r.effectiveProvider, 'lusha');
    assert.equal(r.blockedReason, null);
    assert.equal(r.wouldCallAction, 'generateLushaPendingReviewBatchAction');
    assert.equal(r.wouldUseApollo, false);
  });

  it('eligible + flag off → Lusha fuera, Agent 1 discovery disponible', () => {
    const r = route(ELIGIBLE, false, true);
    assert.equal(r.intendedProvider, 'lusha');
    assert.equal(r.effectiveProvider, 'blocked_lusha_disabled');
    // El motivo sigue siendo observable: explica por qué Lusha no participa.
    assert.equal(r.blockedReason, 'lusha_preview_disabled');
    // Y la búsqueda sí tiene camino: el discovery ordinario de Agente 1.
    assert.equal(r.wouldCallAction, 'executeProspectWizardGenerationAction');
    assert.equal(r.wouldUseApollo, true);
  });

  it('eligible + flag off + ejecución apagada → nada runnable (por el flag de ejecución)', () => {
    const r = route(ELIGIBLE, false, false);
    assert.equal(r.effectiveProvider, 'blocked_lusha_disabled');
    assert.equal(r.wouldCallAction, null);
    assert.equal(r.wouldUseApollo, false);
  });

  it('not eligible + execution on → default_ai, Agent 1 action, Apollo-capable', () => {
    const r = route(NOT_ELIGIBLE, false, true);
    assert.equal(r.intendedProvider, 'default_ai');
    assert.equal(r.effectiveProvider, 'default_ai');
    assert.equal(r.blockedReason, null);
    assert.equal(r.wouldCallAction, 'executeProspectWizardGenerationAction');
    assert.equal(r.wouldUseApollo, true);
  });

  it('not eligible + execution off → default_ai, no runnable action, no Apollo', () => {
    const r = route(NOT_ELIGIBLE, false, false);
    assert.equal(r.intendedProvider, 'default_ai');
    assert.equal(r.effectiveProvider, 'default_ai');
    assert.equal(r.wouldCallAction, null);
    assert.equal(r.wouldUseApollo, false);
  });

  it('INVARIANT: una corrida cuyo proveedor EFECTIVO es Lusha nunca usa Apollo', () => {
    // Barrido de la rejilla completa flag x ejecución para los criterios elegibles.
    for (const lushaPreviewEnabled of [true, false]) {
      for (const executionEnabled of [true, false]) {
        const r = route(ELIGIBLE, lushaPreviewEnabled, executionEnabled);
        assert.equal(r.intendedProvider, 'lusha');
        if (r.effectiveProvider === 'lusha') {
          assert.equal(
            r.wouldUseApollo,
            false,
            `una corrida Lusha alcanzó Apollo (flag=${lushaPreviewEnabled}, exec=${executionEnabled})`,
          );
          assert.equal(r.wouldCallAction, 'generateLushaPendingReviewBatchAction');
        }
      }
    }
  });

  it('INVARIANT: con el flag apagado ninguna ruta resuelve a Lusha', () => {
    for (const criteria of [ELIGIBLE, NOT_ELIGIBLE]) {
      for (const executionEnabled of [true, false]) {
        const r = route(criteria, false, executionEnabled);
        assert.notEqual(r.effectiveProvider, 'lusha');
        assert.notEqual(r.wouldCallAction, 'generateLushaPendingReviewBatchAction');
      }
    }
  });
});
