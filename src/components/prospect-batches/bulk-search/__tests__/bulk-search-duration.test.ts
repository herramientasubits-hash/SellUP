/** Cómo se dice cuánto puede tardar una búsqueda masiva. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBulkDuration } from '../bulk-search-launch';

describe('formatBulkDuration', () => {
  it('en minutos mientras no llega a una hora', () => {
    assert.equal(formatBulkDuration({ min: 6, max: 25 }), '≈ 6–25 min');
  });

  it('pasa a horas cuando cruza la hora', () => {
    assert.equal(formatBulkDuration({ min: 40, max: 200 }), '≈ 40 min–3,3 h');
    assert.equal(formatBulkDuration({ min: 60, max: 120 }), '≈ 1–2 h');
  });
});
