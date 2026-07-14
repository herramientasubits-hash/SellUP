/**
 * Tests — getLushaEmptyStateCopy (Hito 17B.4X.7C.3D)
 *
 * Pure unit tests. No network, no DOM.
 *
 * Cases:
 *   A — Lusha returned 0 raw profiles (no_results)
 *   B — Lusha returned profiles but all filtered (all_filtered) — the
 *       reproduced SITECO scenario (raw_results=4, candidates=0)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLushaEmptyStateCopy } from '../contact-enrichment-empty-state-copy';

describe('getLushaEmptyStateCopy', () => {
  describe('Case A — no raw results from Lusha', () => {
    it('returns case no_results when rawResultsCount is 0', () => {
      const copy = getLushaEmptyStateCopy({ rawResultsCount: 0, creditsUsed: 0 });
      assert.equal(copy.case, 'no_results');
    });

    it('headline mentions Lusha did not return profiles', () => {
      const copy = getLushaEmptyStateCopy({ rawResultsCount: 0, creditsUsed: 0 });
      assert.match(copy.headline, /Lusha no devolvió/i);
    });
  });

  describe('Case B — profiles found but all filtered (SITECO reproduction)', () => {
    it('returns case all_filtered when rawResultsCount > 0', () => {
      const copy = getLushaEmptyStateCopy({ rawResultsCount: 4, creditsUsed: 1 });
      assert.equal(copy.case, 'all_filtered');
    });

    it('headline says Lusha found no relevant contacts — never "no credentials"', () => {
      const copy = getLushaEmptyStateCopy({ rawResultsCount: 4, creditsUsed: 1 });
      assert.match(copy.headline, /no encontró contactos relevantes/i);
      assert.doesNotMatch(copy.headline, /credencial/i);
      assert.doesNotMatch(copy.headline, /no está disponible/i);
    });

    it('detail states the search executed correctly and filters rejected the profiles', () => {
      const copy = getLushaEmptyStateCopy({ rawResultsCount: 4, creditsUsed: 1 });
      assert.match(copy.detail, /ejecutó la búsqueda correctamente/i);
      assert.match(copy.detail, /filtros de relevancia o consistencia/i);
    });

    it('notAnError confirms no candidates, no HubSpot sync, no phone reveal', () => {
      const copy = getLushaEmptyStateCopy({ rawResultsCount: 4, creditsUsed: 1 });
      assert.match(copy.notAnError, /no se crearon candidatos/i);
      assert.match(copy.notAnError, /HubSpot/i);
      assert.match(copy.notAnError, /no se revelaron teléfonos/i);
    });
  });
});
