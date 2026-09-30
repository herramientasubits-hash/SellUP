/**
 * AGENT1-TAVILY-V2-1 — `isTechSector` compara por palabra completa.
 *
 * Antes comparaba por substring y `'tic'` está dentro de «Logística» y
 * «Farmacéuticos»: esas industrias recibían consultas de software.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCleanMultiQueryDiscoveryQueries,
  buildExpandedMultiQueryDiscoveryQueries,
  getSourceGuidedQueryMeta,
} from '../query-builder';

const SOFTWARE_DRIFT = /\b(software|saas|erp|crm|ciberseguridad|TI)\b/i;

describe('isTechSector por palabra completa (vía los builders públicos)', () => {
  for (const industry of [
    'Transporte & Logística',
    'Logística y Transporte',
    'Salud & Farmacéuticos',
    'Farmacéutica',
    'Gas / Petróleo / Energía / Minería / Medio Ambiente',
    'Cosmética y cuidado personal',
  ]) {
    it(`«${industry}» no recibe consultas de software`, () => {
      const queries = [
        ...buildCleanMultiQueryDiscoveryQueries(industry, 'Perú'),
        ...buildExpandedMultiQueryDiscoveryQueries(industry, 'Perú'),
      ];
      for (const q of queries) assert.doesNotMatch(q, SOFTWARE_DRIFT, `«${q}»`);
    });
  }

  for (const industry of ['Tecnología', 'Technology', 'TIC', 'Software empresarial', 'E-commerce', 'Fintech']) {
    it(`«${industry}» sigue siendo tecnología`, () => {
      assert.equal(getSourceGuidedQueryMeta('Colombia', industry).enabled, true);
    });
  }

  it('Logística en Colombia no activa las fuentes guiadas de Tecnología', () => {
    assert.equal(getSourceGuidedQueryMeta('Colombia', 'Transporte & Logística').enabled, false);
  });
});
