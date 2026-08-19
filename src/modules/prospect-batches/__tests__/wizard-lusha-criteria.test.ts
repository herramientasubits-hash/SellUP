/**
 * Q3F-5BB.3E — Pure bridge: wizard collected criteria → hidden Lusha decision.
 *
 * `resolveWizardLushaCriteria` classifies the conversational wizard's collected
 * criteria and builds the read-only Lusha input. It NEVER runs Lusha. These
 * tests cover the flag gate, the industria→macro resolution, country support, and
 * the forced guardrail defaults (size band, null sub-industry).
 *
 * AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 §§ 1/5 — el catálogo de estas pruebas
 * pasa a ser Macro-v2 porque la resolución cambió de raíz: antes se hacía por
 * COINCIDENCIA DIFUSA DE ALIAS contra el nombre visible («Salud» → alias `salud` →
 * sector `healthcare`), y ahora se hace por el `slug` publicado del catálogo
 * (`health-pharma` → `health_pharma`). Un catálogo con slugs legacy ya no produce
 * ruta, y eso es exactamente la propiedad que la última prueba de este fichero
 * comprueba.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import { resolveWizardLushaCriteria } from '../wizard-lusha-criteria';

/**
 * Catálogo Macro-v2, con los `slug` que las migraciones 118/119 sembraron.
 *
 * `ind-unmapped` NO es una macro del catálogo canónico: representa una fila cuyo
 * slug no corresponde a ninguna de las 12, que es lo que ocurre bajo la taxonomía
 * v1 y lo que debe degradar a `default_ai`.
 */
const CATALOG: ActiveIndustryCatalog = {
  version: '2.0.0',
  industries: [
    {
      id: 'ind-health',
      name: 'Salud & Farmacéuticos',
      slug: 'health-pharma',
      description: null,
      sortOrder: 1,
    },
    {
      id: 'ind-energy',
      name: 'Gas / Petróleo / Energía / Minería / Medio Ambiente',
      slug: 'energy-mining-environment',
      description: null,
      sortOrder: 2,
    },
    {
      id: 'ind-unmapped',
      name: 'Minería',
      slug: 'mineria',
      description: null,
      sortOrder: 3,
    },
  ],
  subindustries: [],
};

/** Catálogo legacy v1: nombres y slugs que NO son macro industrias canónicas. */
const LEGACY_CATALOG: ActiveIndustryCatalog = {
  version: '1.0.0',
  industries: [
    { id: 'ind-health', name: 'Salud', slug: 'salud', description: null, sortOrder: 1 },
    { id: 'ind-edu', name: 'Educación', slug: 'educacion', description: null, sortOrder: 2 },
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

describe('resolveWizardLushaCriteria', () => {
  it('BLOCKS (blocked_lusha_disabled, input null) when eligible but the flag is off', () => {
    // Q3F-5BB.10C3-FIX-1 STRICT-ALL — an eligible search with the flag off must
    // surface as blocked, NOT collapse into default_ai (which the UI would treat
    // as a genuine Agent 1 / Apollo generation).
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'CO', industryId: 'ind-health', subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
      false,
    );
    assert.equal(decision.provider, 'blocked_lusha_disabled');
    assert.equal(decision.reason, 'lusha_preview_disabled');
    assert.equal(decision.input, null);
  });

  it('resolves lusha with the macro industry + forced guardrail defaults when compatible', () => {
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'CO', industryId: 'ind-health', subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
      true,
    );
    assert.equal(decision.provider, 'lusha');
    assert.ok(decision.input);
    assert.equal(decision.input?.countryCode, 'CO');
    assert.equal(decision.input?.macroIndustryKey, 'health_pharma');
    // No reliable catalog→Lusha sub-industry mapping — never invented.
    assert.equal(decision.input?.subIndustryId, null);
    assert.equal(decision.input?.sizeBandKey, '201-5000');
    assert.equal(decision.input?.searchText, null);
  });

  it('forwards a non-empty additional criterion as trimmed searchText', () => {
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'CO', industryId: 'ind-health', subindustryIds: [], additionalCriteriaRaw: '  telemedicina  ' },
      CATALOG,
      true,
    );
    assert.equal(decision.provider, 'lusha');
    assert.equal(decision.input?.searchText, 'telemedicina');
  });

  it('una macro COMPUESTA también enruta (no sólo las de una rama)', () => {
    // § 11 — antes esta industria no tenía alias legacy y degradaba a `default_ai`
    // aunque su plan Lusha (3 ramas) existiera.
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'CO', industryId: 'ind-energy', subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
      true,
    );
    assert.equal(decision.provider, 'lusha');
    assert.equal(decision.input?.macroIndustryKey, 'energy_mining_environment');
  });

  it('falls back to default_ai when the industria is not a routable macro', () => {
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'CO', industryId: 'ind-unmapped', subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
      true,
    );
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.input, null);
  });

  it('🔴 un catálogo legacy v1 no produce NINGUNA ruta — Educación incluida', () => {
    // § 4 — bajo el mapeo difuso anterior, «Educación» activaba el sector legacy
    // `education` (main 6 de Lusha) y la búsqueda se iba a Lusha. Educación NO es
    // una de las 12 macro de SellUp, así que ahora no tiene ruta.
    for (const industryId of ['ind-health', 'ind-edu']) {
      const decision = resolveWizardLushaCriteria(
        { countryCode: 'CO', industryId, subindustryIds: [], additionalCriteriaRaw: null },
        LEGACY_CATALOG,
        true,
      );
      assert.equal(decision.provider, 'default_ai');
      assert.equal(decision.reason, 'sector_not_mapped');
      assert.equal(decision.input, null);
    }
  });

  it('falls back to default_ai for an unsupported country', () => {
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'ZZ', industryId: 'ind-health', subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
      true,
    );
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.input, null);
  });

  it('falls back to default_ai when no industria is selected yet', () => {
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'CO', industryId: null, subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
      true,
    );
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.input, null);
  });
});
